const Redis = require('ioredis');

// Shared by the whole ride service. Everything that must survive a restart or be
// visible to every copy of this service (queue, offers, free-driver state) lives here.
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 2
});

redis.on('error', (err) => console.log('Redis error:', err.message));

// Atomically takes up to ARGV[2] ride ids whose "ready at" time has passed.
// Two ride-service copies can never take the same ride.
redis.defineCommand('popReady', {
    numberOfKeys: 1,
    lua: `
        local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
        if #ids > 0 then redis.call('ZREM', KEYS[1], unpack(ids)) end
        return ids
    `
});

module.exports = redis;
