const { redis } = require('./state');

// The live map of free drivers, kept in Redis for the ride service to search.
//
//   drivers:geo   GEO set  driverId -> last position
//   driver:<id>   hash     vehicleType; expires after 30 s, so a driver whose phone went
//                          silent simply disappears from matching on its own
//
// A GPS ping is two O(log n) Redis writes in one round trip, which is why it can be done
// on EVERY ping (every ~2 s per driver) instead of every 5 s through MongoDB.

const ALIVE_MS = 30000;

module.exports.touch = (driverId, vehicleType, ltd, lng) => redis.pipeline()
    .geoadd('drivers:geo', lng, ltd, driverId)
    .hset(`driver:${driverId}`, 'vehicleType', vehicleType || 'any')
    .pexpire(`driver:${driverId}`, ALIVE_MS)
    .exec();

module.exports.remove = (driverId) => redis.pipeline()
    .zrem('drivers:geo', driverId)
    .del(`driver:${driverId}`)
    .exec();
