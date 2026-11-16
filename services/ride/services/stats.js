const redis = require('./redis');
const { states } = require('./breaker');

// Counters and latency samples live in Redis, so every copy of the ride service
// adds to the same numbers and the dashboard sees the whole system.

const COUNTERS = 'engine:counters';
const LATENCY = 'engine:latency:offer'; // ms from "ride requested" to "first offer sent"
const KEEP = 1000;

const safe = (promise) => promise.catch(() => {});

module.exports.incr = (name, by = 1) => safe(redis.hincrby(COUNTERS, name, by));

module.exports.recordOfferLatency = (ms) => safe(
    redis.multi().lpush(LATENCY, Math.round(ms)).ltrim(LATENCY, 0, KEEP - 1).exec()
);

const percentile = (sorted, p) => sorted.length ? sorted[ Math.min(sorted.length - 1, Math.floor(sorted.length * p)) ] : 0;

module.exports.snapshot = async (extra = {}) => {
    const [ counters, samples, queue, openOffers, driversIndexed, driversOnRide ] = await Promise.all([
        redis.hgetall(COUNTERS),
        redis.lrange(LATENCY, 0, KEEP - 1),
        redis.zcard('dispatch:pending'),
        redis.zcard('dispatch:deadlines'),
        redis.zcard('drivers:geo'),
        redis.scard('drivers:onride')
    ]);

    const sorted = samples.map(Number).sort((a, b) => a - b);
    const numbers = Object.fromEntries(Object.entries(counters).map(([ k, v ]) => [ k, Number(v) ]));

    return {
        time: Date.now(),
        queueDepth: queue,
        openOffers,
        driversIndexed,
        driversOnRide,
        counters: numbers,
        offerLatencyMs: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), samples: sorted.length },
        breakers: states(),
        ...extra
    };
}

module.exports.reset = () => redis.del(COUNTERS, LATENCY);
