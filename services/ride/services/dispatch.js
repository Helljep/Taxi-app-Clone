const rideModel = require('../models/ride.model');
const captainClient = require('./captain.client');
const clients = require('./clients');
const { publishEvent } = require('./events');
const rideService = require('./ride.service');

// Smart dispatch: instead of shouting the ride to every captain nearby and letting
// the fastest finger win, we offer it to ONE captain at a time, best match first:
//   1. find free captains of the right vehicle type near the pickup
//   2. rank them by real driving time to the pickup (the ETA)
//   3. offer the ride to the best one, with a countdown
//   4. captain declines or the time runs out -> offer to the next best
//   5. nobody left -> the ride is cancelled and the rider is told
// Result: shorter waits for riders, and no stampede of captains for the same ride.

const OFFER_TIMEOUT = Number(process.env.OFFER_TIMEOUT_MS) || 15000; // ms a captain has to answer
const SEARCH_RADIUS_KM = 3;
const MAX_OFFERS = 5;

// rideId -> { timer, captainId } for the offer that is currently open.
// These live in this server's memory: with several ride servers you would keep
// them in Redis (or use delayed queue messages) so any server can expire an offer.
const openOffers = new Map();


// Pure ranking logic (no network), so it is easy to test.
// captains: documents with _id; etas: seconds, same order as captains (null = unknown)
function rankCandidates({ captains, etas, busyIds = [], offeredIds = [] }) {
    const skip = new Set([ ...busyIds, ...offeredIds ].map(String));

    return captains
        .map((captain, i) => ({ captain, etaSeconds: etas?.[ i ] ?? null }))
        .filter(({ captain }) => !skip.has(String(captain._id)))
        // known ETAs first (smallest to largest), unknown ones last
        .sort((a, b) => {
            if (a.etaSeconds === null && b.etaSeconds === null) return 0;
            if (a.etaSeconds === null) return 1;
            if (b.etaSeconds === null) return -1;
            return a.etaSeconds - b.etaSeconds;
        });
}

const toPoint = (captain) => ({
    ltd: captain.location.coordinates[ 1 ],
    lng: captain.location.coordinates[ 0 ]
});

const toMinutes = (seconds) => seconds === null ? null : Math.max(1, Math.ceil(seconds / 60));


// captains that already have a ride in progress are not free
async function findBusyCaptainIds(captains) {
    const ids = captains.map(c => c._id);
    return await rideModel.find({ captain: { $in: ids }, status: { $in: [ 'accepted', 'ongoing' ] } }).distinct('captain');
}


async function findCandidates(ride, token) {
    const { ltd, lng } = ride.pickupCoordinates;
    const nearby = (await captainClient.getCaptainsInTheRadius(ltd, lng, SEARCH_RADIUS_KM, ride.vehicleType))
        .filter(c => c.location?.coordinates?.length === 2);

    if (nearby.length === 0) return [];

    let etas = null;
    try {
        etas = await clients.getEtas(nearby.map(toPoint), { ltd, lng }, token);
    } catch (err) {
        console.log('Could not get ETAs, ranking is unordered:', err.message);
    }

    return rankCandidates({
        captains: nearby,
        etas,
        busyIds: await findBusyCaptainIds(nearby),
        offeredIds: ride.offeredTo
    });
}


function clearOffer(rideId) {
    const open = openOffers.get(String(rideId));
    if (open) {
        clearTimeout(open.timer);
        openOffers.delete(String(rideId));
    }
    return open;
}


async function giveUp(rideId) {
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, status: 'pending' },
        { status: 'cancelled', cancelledBy: 'system' },
        { new: true }
    );
    if (!ride) return;

    const data = { ...rideService.toClientShape(ride), reason: 'No captains available nearby' };
    await publishEvent('ride-cancelled', [ `user:${ride.user}` ], data);
}


// Offer the ride to the best captain who has not seen it yet.
async function offerToNext(rideId, token) {
    const previous = clearOffer(rideId);

    // the previous captain's pop-up should disappear
    if (previous) {
        publishEvent('ride-offer-expired', [ `captain:${previous.captainId}` ], { rideId: String(rideId) })
            .catch(() => { });
    }

    const ride = await rideModel.findById(rideId);
    if (!ride || ride.status !== 'pending') return;

    if (ride.offeredTo.length >= MAX_OFFERS) return giveUp(rideId);

    const candidates = await findCandidates(ride, token);
    if (candidates.length === 0) return giveUp(rideId);

    const { captain, etaSeconds } = candidates[ 0 ];

    await rideModel.updateOne({ _id: rideId }, { $addToSet: { offeredTo: captain._id } });

    // captains must not see the otp, only the user does
    const { otp, ...rideForCaptain } = rideService.toClientShape(ride);
    await publishEvent('new-ride', [ `captain:${captain._id}` ], {
        ...rideForCaptain,
        pickupEtaMinutes: toMinutes(etaSeconds),
        offerSeconds: Math.round(OFFER_TIMEOUT / 1000)
    });

    const timer = setTimeout(() => {
        offerToNext(rideId, token).catch(err => console.log('Dispatch error:', err.message));
    }, OFFER_TIMEOUT);

    openOffers.set(String(rideId), { timer, captainId: String(captain._id) });
}


module.exports.startDispatch = (rideId, token) => {
    return offerToNext(rideId, token);
}

// the captain who holds the offer pressed "Ignore"
module.exports.declineOffer = async (rideId, captainId, token) => {
    const open = openOffers.get(String(rideId));
    if (!open || open.captainId !== String(captainId)) return false;

    await offerToNext(rideId, token);
    return true;
}

// the ride was accepted or cancelled: stop the countdown, close the open pop-up
module.exports.stopDispatch = (rideId, { notifyCaptain = false } = {}) => {
    const open = clearOffer(rideId);

    if (open && notifyCaptain) {
        publishEvent('ride-offer-expired', [ `captain:${open.captainId}` ], { rideId: String(rideId) })
            .catch(() => { });
    }
    return open;
}

// "2 mins away" label per vehicle type for the vehicle list
module.exports.etaByVehicleType = async (ltd, lng, token) => {
    const result = { car: null, moto: null, auto: null };

    const nearby = (await captainClient.getCaptainsInTheRadius(ltd, lng, SEARCH_RADIUS_KM))
        .filter(c => c.location?.coordinates?.length === 2);
    if (nearby.length === 0) return result;

    const busy = new Set((await findBusyCaptainIds(nearby)).map(String));
    const free = nearby.filter(c => !busy.has(String(c._id)));
    if (free.length === 0) return result;

    const etas = await clients.getEtas(free.map(toPoint), { ltd, lng }, token);

    free.forEach((captain, i) => {
        const type = captain.vehicle.vehicleType;
        const minutes = toMinutes(etas[ i ] ?? null);
        if (minutes !== null && (result[ type ] === null || minutes < result[ type ])) {
            result[ type ] = minutes;
        }
    });
    return result;
}

// After a restart the in-memory countdowns are gone, so any ride still "pending"
// from before would wait forever. Close them.
module.exports.recoverStaleRides = async () => {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const result = await rideModel.updateMany(
        { status: 'pending', createdAt: { $lt: cutoff } },
        { status: 'cancelled', cancelledBy: 'system' }
    );
    if (result.modifiedCount) console.log(`Closed ${result.modifiedCount} stale pending rides`);
}

module.exports.rankCandidates = rankCandidates;
