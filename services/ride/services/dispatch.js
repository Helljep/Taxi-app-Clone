const crypto = require('crypto');
const rideModel = require('../models/ride.model');
const redis = require('./redis');
const index = require('./driverIndex');
const stats = require('./stats');
const rideService = require('./ride.service');
const heatmapClient = require('./heatmap.client');
const { publishEvent } = require('./events');
const { hungarian } = require('./hungarian');
const { driveMinutes } = require('./geo');

// ---------------------------------------------------------------------------------
// BATCH DISPATCH ENGINE
//
// Rides do not get matched one by one. They wait in a Redis queue, and every few
// hundred milliseconds the engine takes a batch and matches the WHOLE batch at once:
//
//   1. pop a batch of ready rides from the queue             (atomic Lua, safe with many copies)
//   2. for each ride, GEOSEARCH the nearest drivers           (Redis GEO, one pipeline)
//   3. drop drivers who are gone, on a ride, or hold an offer (one more pipeline)
//   4. build a cost matrix  ride x driver = pickup minutes
//   5. Hungarian algorithm -> the pairing with the smallest TOTAL pickup time
//   6. claim each driver with SET NX (a driver gets one offer at a time, even across copies)
//   7. save the offer, send it to the driver, start a 15 s deadline
//
// A missed deadline, a decline, a crash or a full "no driver nearby" all end the same
// way: the ride goes back into the queue. A ride is only given up after MAX_WAIT.
// Redis holds the working set; MongoDB is the truth, and reconcile() rebuilds Redis from it.
// ---------------------------------------------------------------------------------

const PENDING = 'dispatch:pending';      // zset: rideId -> time it may be tried (ms)
const DEADLINES = 'dispatch:deadlines';  // zset: rideId -> time its open offer expires (ms)

const OFFER_TIMEOUT = Number(process.env.OFFER_TIMEOUT_MS) || 15000;
const RADIUS_KM = Number(process.env.SEARCH_RADIUS_KM) || 3;
const MAX_OFFERS = Number(process.env.MAX_OFFERS) || 6;       // drivers tried before giving up
const MAX_WAIT = Number(process.env.MAX_WAIT_MS) || 60000;     // longest a rider waits for a driver
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 100;
const BATCH_WINDOW = Number(process.env.BATCH_WINDOW_MS) || 300;
const SEARCH_COUNT = 40;       // drivers fetched per ride from GEO
const KEEP_PER_RIDE = 10;      // free drivers kept per ride as candidates
const RETRY_MS = 1500;         // a ride with nobody nearby is tried again after this
const BIG = 1e6;               // cost of a pairing that is not allowed
const UNMATCHED = 1000;        // cost of leaving a ride unmatched (grows with its waiting time)

const instanceId = crypto.randomBytes(4).toString('hex');
const jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.3);
const idOf = (value) => String(value);


function enqueue(rideId, delayMs = 0) {
    return redis.zadd(PENDING, Date.now() + delayMs, idOf(rideId));
}

// a new ride enters the queue; the engine loop picks it up within one batch window
module.exports.startDispatch = async (rideId) => {
    await enqueue(rideId);
}


function closeOfferPopup(captainId, rideId) {
    if (!captainId) return;
    publishEvent('ride-offer-expired', [ `captain:${captainId}` ], { rideId: idOf(rideId) })
        .catch(err => console.log('Could not close offer:', err.message));
}


async function giveUp(rideId) {
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, status: 'pending' },
        { status: 'cancelled', cancelledBy: 'system', $unset: { currentOffer: 1 } },
        { new: true }
    );

    await redis.pipeline().zrem(PENDING, idOf(rideId)).zrem(DEADLINES, idOf(rideId)).exec();
    if (!ride) return;

    stats.incr('givenUp');
    heatmapClient.removeDemand(ride.pickupCoordinates.ltd, ride.pickupCoordinates.lng, ride._id);

    await publishEvent('ride-cancelled', [ `user:${ride.user}` ], {
        ...rideService.toClientShape(ride),
        reason: 'No captains available nearby'
    });
}


// the offer could not be delivered: take it back and let the ride try again
async function undoOffer(rideId, driverId) {
    await rideModel.updateOne({ _id: rideId, status: 'pending', currentOffer: driverId }, { $unset: { currentOffer: 1 } });
    await index.releaseOffer(rideId, driverId);
    await redis.zrem(DEADLINES, idOf(rideId));
    await enqueue(rideId, RETRY_MS);
}


// ---- offers that ran out of time ----
async function expireOffers(now) {
    const due = await redis.zrangebyscore(DEADLINES, '-inf', now, 'LIMIT', 0, 200);

    await Promise.all(due.map(async (rideId) => {
        // whichever copy of the service removes it first handles it
        if (await redis.zrem(DEADLINES, rideId) !== 1) return;

        const ride = await rideModel.findOneAndUpdate(
            { _id: rideId, status: 'pending', currentOffer: { $exists: true } },
            { $unset: { currentOffer: 1 } },
            { new: false }
        );
        if (!ride) return;

        await index.releaseOffer(rideId, ride.currentOffer);
        closeOfferPopup(ride.currentOffer, rideId);
        stats.incr('expired');
        await enqueue(rideId);
    }));
}


// The Hungarian cost matrix. Rows = rides, columns = candidate drivers + one "unmatched"
// column per ride. Not-allowed pairs cost BIG. Leaving a ride unmatched costs UNMATCHED
// plus its waiting time, so when drivers are scarce the rides that waited longest win.
function matchBatch(rides, candidates, now) {
    const drivers = [ ...new Set(candidates.flatMap(list => list.map(c => c.id))) ];
    const column = new Map(drivers.map((id, j) => [ id, j ]));
    const m = drivers.length;
    const n = rides.length;

    const cost = rides.map((ride, i) => {
        const row = new Array(m + n).fill(BIG);
        for (const c of candidates[ i ]) row[ column.get(c.id) ] = driveMinutes(c.km);
        const waitedSeconds = (now - ride.createdAt.getTime()) / 1000;
        for (let k = 0; k < n; k++) row[ m + k ] = UNMATCHED + waitedSeconds;
        return row;
    });

    return hungarian(cost).map((col, i) => {
        if (col < 0 || col >= m) return null;
        const driver = candidates[ i ].find(c => c.id === drivers[ col ]);
        return driver || null;
    });
}


// one batch. Returns how many rides were taken from the queue.
async function tick() {
    const now = Date.now();
    await expireOffers(now);

    const ids = await redis.popReady(PENDING, now, BATCH_SIZE);
    if (ids.length === 0) return 0;

    const rides = await rideModel.find({ _id: { $in: ids }, status: 'pending', currentOffer: { $exists: false } });
    if (rides.length === 0) return ids.length;

    const started = Date.now();

    // rides that have waited too long, or tried too many drivers, stop here
    const live = [];
    for (const ride of rides) {
        if (now - ride.createdAt.getTime() > MAX_WAIT || ride.offeredTo.length >= MAX_OFFERS) {
            giveUp(ride._id).catch(err => console.log('Give up failed:', err.message));
        } else {
            live.push(ride);
        }
    }
    if (live.length === 0) return ids.length;

    // 2. nearest drivers for every ride, one round trip
    const search = redis.pipeline();
    for (const ride of live) {
        index.nearbyPipeline(search, ride.pickupCoordinates.ltd, ride.pickupCoordinates.lng, RADIUS_KM, SEARCH_COUNT);
    }
    const found = (await search.exec()).map(([ err, reply ]) => err ? [] : index.parseNearby(reply));

    // 3. who is really free? (each driver checked once, even if near many rides)
    const info = await index.describe([ ...new Set(found.flat().map(c => c.id)) ]);

    const candidates = live.map((ride, i) => {
        const offered = new Set(ride.offeredTo.map(idOf));
        return found[ i ].filter(c => {
            const d = info.get(c.id);
            return d && d.alive && !d.onRide && !d.hasOffer && !offered.has(c.id) &&
                (d.vehicleType === ride.vehicleType || d.vehicleType === 'any');
        }).slice(0, KEEP_PER_RIDE);
    });

    // 4-5. best pairing for the whole batch
    const pairs = matchBatch(live, candidates, now);

    // 6-7. claim, save, send
    let offered = 0;
    await Promise.all(live.map(async (ride, i) => {
        const pick = pairs[ i ];

        if (!pick) {
            await enqueue(ride._id, jitter(RETRY_MS));
            stats.incr('noDriver');
            return;
        }

        const claimed = await index.claimDriver(pick.id, ride._id, OFFER_TIMEOUT + 3000);
        if (!claimed) {                                 // another copy took this driver a moment ago
            await enqueue(ride._id);
            stats.incr('claimLost');
            return;
        }

        const saved = await rideModel.updateOne(
            { _id: ride._id, status: 'pending', currentOffer: { $exists: false } },
            { $addToSet: { offeredTo: pick.id }, $set: { currentOffer: pick.id } }
        );
        if (saved.modifiedCount !== 1) {                // cancelled or offered elsewhere meanwhile
            await index.releaseOffer(ride._id, pick.id);
            return;
        }

        // captains must not see the otp, only the rider does
        const { otp, ...rideForCaptain } = rideService.toClientShape(ride);

        try {
            await publishEvent('new-ride', [ `captain:${pick.id}` ], {
                ...rideForCaptain,
                pickupEtaMinutes: Math.max(1, Math.ceil(driveMinutes(pick.km))),
                offerSeconds: Math.round(OFFER_TIMEOUT / 1000)
            });
        } catch (err) {
            console.log('Could not send the offer:', err.message);
            return undoOffer(ride._id, pick.id);
        }

        await redis.zadd(DEADLINES, Date.now() + OFFER_TIMEOUT, idOf(ride._id));
        offered++;
        stats.incr('offers');
        if (ride.offeredTo.length === 0) stats.recordOfferLatency(Date.now() - ride.createdAt.getTime());
    }));

    stats.incr('batches');
    stats.incr('batchRides', live.length);
    stats.incr('batchMs', Date.now() - started);
    return ids.length;
}


// the captain who holds the offer pressed "Ignore"
module.exports.declineOffer = async (rideId, captainId) => {
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, status: 'pending', currentOffer: captainId },
        { $unset: { currentOffer: 1 } },
        { new: false }
    );
    if (!ride) return false;

    await index.releaseOffer(rideId, captainId);
    await redis.zrem(DEADLINES, idOf(rideId));
    stats.incr('declined');
    await enqueue(rideId);
    return true;
}


// the ride was accepted or cancelled, so it leaves the queue and its offer is closed
module.exports.stopDispatch = async (rideId, { notifyCaptain = false } = {}) => {
    try {
        const driverId = await index.offeredDriverOf(rideId);
        await redis.pipeline().zrem(PENDING, idOf(rideId)).zrem(DEADLINES, idOf(rideId)).exec();
        await index.releaseOffer(rideId, driverId);
        if (driverId && notifyCaptain) closeOfferPopup(driverId, rideId);
    } catch (err) {
        console.log('Could not stop dispatch:', err.message);
    }
}


// the "N mins away" label per vehicle type, straight from the Redis driver index
module.exports.etaByVehicleType = async (ltd, lng) => {
    const result = { car: null, moto: null, auto: null };

    const near = await index.nearby(ltd, lng, RADIUS_KM, SEARCH_COUNT);
    const info = await index.describe(near.map(c => c.id));

    for (const { id, km } of near) {
        const d = info.get(id);
        if (!d || !d.alive || d.onRide) continue;

        const minutes = Math.max(1, Math.ceil(driveMinutes(km)));
        for (const type of Object.keys(result)) {
            if ((d.vehicleType === type || d.vehicleType === 'any') && (result[ type ] === null || minutes < result[ type ])) {
                result[ type ] = minutes;
            }
        }
    }
    return result;
}


// ---------------------------------------------------------------------------------
// SELF-HEALING. Redis is fast but can lose state (restart, crash mid-batch). MongoDB is the
// truth, so every 15 s one copy of the service compares them and repairs the difference:
//   - pending ride that is in no queue           -> put it back
//   - open offer with no deadline                -> give it a deadline
//   - "driver is on a ride" set                  -> rebuilt from accepted/ongoing rides
// ---------------------------------------------------------------------------------
async function reconcile() {
    if (!await redis.set('dispatch:reconcile-lock', instanceId, 'PX', 12000, 'NX')) return;

    const quiet = new Date(Date.now() - 10000); // ignore rides touched in the last 10 s, they are in flight

    const waiting = await rideModel.find({ status: 'pending', currentOffer: { $exists: false }, updatedAt: { $lt: quiet } }).select('_id').limit(5000).lean();
    const offered = await rideModel.find({ status: 'pending', currentOffer: { $exists: true }, updatedAt: { $lt: quiet } }).select('_id').limit(5000).lean();

    const check = redis.pipeline();
    waiting.forEach(r => check.zscore(PENDING, idOf(r._id)));
    offered.forEach(r => check.zscore(DEADLINES, idOf(r._id)));
    const scores = (await check.exec()).map(([ , score ]) => score);

    // A ride can be missing from the queue for a moment simply because a batch is working on it
    // right now. So a ride is only "lost" if it is missing on two passes in a row: the first
    // sighting is remembered (40 s), the second one repairs it.
    const missing = [];
    waiting.forEach((r, i) => { if (scores[ i ] === null) missing.push({ id: idOf(r._id), key: PENDING }); });
    offered.forEach((r, i) => { if (scores[ waiting.length + i ] === null) missing.push({ id: idOf(r._id), key: DEADLINES }); });

    const seen = redis.pipeline();
    missing.forEach(m => seen.set(`dispatch:suspect:${m.id}`, '1', 'EX', 40, 'NX'));
    const firstSighting = (await seen.exec()).map(([ , ok ]) => ok === 'OK');

    const repair = redis.pipeline();
    let repaired = 0;
    missing.forEach((m, i) => {
        if (firstSighting[ i ]) return;
        repair.zadd(m.key, 'NX', m.key === PENDING ? Date.now() : Date.now() + OFFER_TIMEOUT, m.id);
        repaired++;
    });
    await repair.exec();
    if (repaired) { console.log(`Reconcile: restored ${repaired} ride(s) to the queue`); stats.incr('reconciled', repaired); }

    const busy = await rideModel.distinct('captain', { status: { $in: [ 'accepted', 'ongoing' ] } });
    await index.rebuildOnRide(busy);
}


// starts the loop. Safe to run in several copies of the ride service at once.
module.exports.startEngine = () => {
    const loop = async () => {
        let busy = false;
        try {
            busy = (await tick()) >= BATCH_SIZE;   // a full batch means more is waiting, go again straight away
        } catch (err) {
            console.log('Dispatch error:', err.message);
        }
        setTimeout(loop, busy ? 0 : BATCH_WINDOW);
    };

    const heal = () => reconcile().catch(err => console.log('Reconcile error:', err.message));

    loop();
    heal();
    setInterval(heal, 15000);
    console.log(`Dispatch engine ${instanceId} started (batch ${BATCH_SIZE} / ${BATCH_WINDOW} ms)`);
}
