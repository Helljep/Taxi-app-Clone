const Redis = require('ioredis');

// "Which captain is on a ride with which user" used to live in this server's memory.
// With several realtime servers behind a load balancer, the server that receives a
// captain's GPS ping is often not the one that handled the ride, so the state must be
// shared. Redis is that shared place.

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => console.log('Redis error:', err.message));

const KEY = 'active-rides'; // hash: captainId -> userId

module.exports.redis = redis;
module.exports.trackRide = (captainId, userId) => redis.hset(KEY, String(captainId), String(userId));
module.exports.stopTrackingRide = (captainId) => redis.hdel(KEY, String(captainId));
module.exports.getRider = (captainId) => redis.hget(KEY, String(captainId));
