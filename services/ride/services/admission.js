const redis = require('./redis');
const stats = require('./stats');

// ADMISSION CONTROL. A flood of requests must not be allowed to bury the service.
// Before a ride request does any work, two cheap checks decide if there is room:
//
//   1. in-flight cap : how many requests THIS copy is handling right now
//   2. queue cap     : how many rides are already waiting for a driver (system wide)
//
// When either is full the request is turned away at once with 503 + Retry-After.
// That is "load shedding": a fast, honest "try again in N seconds" is better than
// accepting everything and then timing out for everybody. Clients retry with a
// random delay (jitter) so they don't all come back at the same moment.

const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT) || 300;
const MAX_QUEUE = Number(process.env.MAX_QUEUE) || 2000;
const DRAIN_PER_SECOND = 300; // rough speed the engine empties the queue, used for Retry-After

let inflight = 0;
let cached = { at: 0, depth: 0 };

async function queueDepth() {
    if (Date.now() - cached.at < 200) return cached.depth;   // at most 5 Redis reads a second
    cached = { at: Date.now(), depth: await redis.zcard('dispatch:pending') };
    return cached.depth;
}

function shed(res, reason, depth) {
    stats.incr('shed');
    const retryAfter = Math.min(30, 2 + Math.floor(depth / DRAIN_PER_SECOND));
    res.set('Retry-After', String(retryAfter));
    return res.status(503).json({
        message: 'We are very busy right now. Please try again in a moment.',
        reason,
        retryAfter
    });
}

module.exports.guard = async (req, res, next) => {
    let depth = 0;
    try {
        depth = await queueDepth();
    } catch (err) {
        // if Redis is down we let the request through rather than refuse everyone
    }

    if (inflight >= MAX_INFLIGHT) return shed(res, 'in-flight limit', depth);
    if (depth >= MAX_QUEUE) return shed(res, 'queue full', depth);

    inflight++;
    res.once('close', () => { inflight--; });
    next();
}

module.exports.inflight = () => inflight;
