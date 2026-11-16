const redis = require('./redis');

// Which drivers are free, and where are they? All of it in Redis, nothing in MongoDB.
//
//   drivers:geo          GEO set   driverId -> position (written by the realtime service on every GPS ping)
//   driver:<id>          hash      vehicleType, expires after 30 s without a ping (= driver is gone)
//   drivers:onride       set       drivers carrying a rider (written here)
//   offer:driver:<id>    string    the ride this driver is currently being offered (one at a time)
//   offer:ride:<id>      string    the driver this ride is currently offered to

const GEO = 'drivers:geo';
const ONRIDE = 'drivers:onride';

const offerDriverKey = (driverId) => `offer:driver:${driverId}`;
const offerRideKey = (rideId) => `offer:ride:${rideId}`;


// nearest drivers around a point: [ { id, km } ], closest first
module.exports.nearbyPipeline = (pipeline, ltd, lng, radiusKm, count) => {
    pipeline.call('GEOSEARCH', GEO, 'FROMLONLAT', lng, ltd, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', count, 'WITHDIST');
}

module.exports.parseNearby = (reply) => (reply || []).map(([ id, km ]) => ({ id, km: Number(km) }));


module.exports.nearby = async (ltd, lng, radiusKm, count) => {
    const reply = await redis.call('GEOSEARCH', GEO, 'FROMLONLAT', lng, ltd, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', count, 'WITHDIST');
    return module.exports.parseNearby(reply);
}


// For a list of driver ids: are they alive, what vehicle, on a ride, already holding an offer?
module.exports.describe = async (ids) => {
    if (ids.length === 0) return new Map();

    const pipeline = redis.pipeline();
    for (const id of ids) {
        pipeline.hget(`driver:${id}`, 'vehicleType');
        pipeline.sismember(ONRIDE, id);
        pipeline.exists(offerDriverKey(id));
    }
    const results = await pipeline.exec();

    const info = new Map();
    ids.forEach((id, i) => {
        const vehicleType = results[ i * 3 ][ 1 ];
        info.set(id, {
            alive: vehicleType !== null,
            vehicleType,
            onRide: results[ i * 3 + 1 ][ 1 ] === 1,
            hasOffer: results[ i * 3 + 2 ][ 1 ] === 1
        });
    });
    return info;
}


// ---- offers: a driver can hold only ONE offer at a time (SET NX is the lock) ----

module.exports.claimDriver = async (driverId, rideId, ttlMs) => {
    const got = await redis.set(offerDriverKey(driverId), String(rideId), 'PX', ttlMs, 'NX');
    if (!got) return false;
    await redis.set(offerRideKey(rideId), String(driverId), 'PX', ttlMs);
    return true;
}

module.exports.releaseOffer = async (rideId, driverId) => {
    const pipeline = redis.pipeline();
    pipeline.del(offerRideKey(rideId));
    if (driverId) pipeline.del(offerDriverKey(driverId));
    await pipeline.exec();
}

module.exports.offeredDriverOf = (rideId) => redis.get(offerRideKey(rideId));


// ---- ride state ----

// the driver accepted: they leave the free pool immediately
module.exports.markOnRide = async (driverId, rideId) => {
    await redis.multi()
        .sadd(ONRIDE, String(driverId))
        .zrem(GEO, String(driverId))
        .del(offerDriverKey(driverId))
        .del(offerRideKey(rideId))
        .exec();
}

// the ride ended or was cancelled: the driver's next GPS ping puts them back on the map
module.exports.markFree = (driverId) => redis.srem(ONRIDE, String(driverId));

// self-healing: rebuild the "on a ride" set from the database, the source of truth
module.exports.rebuildOnRide = async (driverIds) => {
    const pipeline = redis.multi().del(ONRIDE);
    if (driverIds.length) pipeline.sadd(ONRIDE, ...driverIds.map(String));
    await pipeline.exec();
}

module.exports.GEO = GEO;
