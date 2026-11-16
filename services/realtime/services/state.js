const Redis = require('ioredis');

// "Which captain is on a ride with which rider" is kept in Redis instead of
// this server's memory, so any realtime server can answer it.

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => console.log('Redis error:', err.message));

const ACTIVE_RIDES = 'active-rides'; // hash: captainId -> userId

module.exports.redis = redis;
module.exports.trackRide = (captainId, userId) => redis.hset(ACTIVE_RIDES, String(captainId), String(userId));
module.exports.stopTrackingRide = (captainId) => redis.hdel(ACTIVE_RIDES, String(captainId));
module.exports.getRider = (captainId) => redis.hget(ACTIVE_RIDES, String(captainId));
