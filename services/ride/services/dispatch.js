const rideModel = require('../models/ride.model');
const captainClient = require('./captain.client');
const mapService = require('./maps.client');
const rideService = require('./ride.service');
const heatmapClient = require('./heatmap.client');
const { publishEvent } = require('./events');

// Dispatch offers a ride to ONE captain at a time, best match first:
//   1. find free captains of the right vehicle type near the pickup
//   2. rank them by driving time to the pickup
//   3. offer the ride to the best one, with a countdown
//   4. if they decline or time runs out, offer it to the next one
//   5. if nobody is left, cancel the ride and tell the rider

const OFFER_TIMEOUT = Number(process.env.OFFER_TIMEOUT_MS) || 15000; // ms a captain has to answer
const SEARCH_RADIUS_KM = 3;
const MAX_OFFERS = 5;
const PUBLISH_RETRIES = 6;     // if the queue is down, try to send the offer this many times
const PUBLISH_RETRY_MS = 5000;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// rideId -> { timer, captainId } for the offer that is open right now
// (kept in memory, so this service runs as a single copy)
const openOffers = new Map();


const toPoint = (captain) => ({
    ltd: captain.location.coordinates[ 1 ],
    lng: captain.location.coordinates[ 0 ]
});

const toMinutes = (seconds) => seconds === null ? null : Math.max(1, Math.ceil(seconds / 60));

const hasLocation = (captain) => captain.location?.coordinates?.length === 2;


// Captains with the shortest ETA come first, captains without an ETA come last.
function rankByEta(captains, etas) {
    return captains
        .map((captain, i) => ({ captain, etaSeconds: etas?.[ i ] ?? null }))
        .sort((a, b) => {
            if (a.etaSeconds === null) return b.etaSeconds === null ? 0 : 1;
            if (b.etaSeconds === null) return -1;
            return a.etaSeconds - b.etaSeconds;
        });
}


// captains who are already driving someone are not free
async function findBusyCaptainIds(captains) {
    const ids = captains.map(captain => captain._id);

    const busy = await rideModel
        .find({ captain: { $in: ids }, status: { $in: [ 'accepted', 'ongoing' ] } })
        .distinct('captain');

    return busy.map(String);
}


async function findCandidates(ride, token) {
    const { ltd, lng } = ride.pickupCoordinates;

    const nearby = (await captainClient.getCaptainsInTheRadius(ltd, lng, SEARCH_RADIUS_KM, ride.vehicleType))
        .filter(hasLocation);

    const busy = await findBusyCaptainIds(nearby);
    const alreadyOffered = ride.offeredTo.map(String);

    const free = nearby.filter(captain =>
        !busy.includes(String(captain._id)) && !alreadyOffered.includes(String(captain._id)));

    if (free.length === 0) return [];

    let etas = null;
    try {
        etas = await mapService.getEtas(free.map(toPoint), { ltd, lng }, token);
    } catch (err) {
        console.log('Could not get ETAs:', err.message);
    }

    return rankByEta(free, etas);
}


function clearOffer(rideId) {
    const offer = openOffers.get(String(rideId));

    if (offer) {
        clearTimeout(offer.timer);
        openOffers.delete(String(rideId));
    }
    return offer;
}


async function giveUp(rideId) {
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, status: 'pending' },
        { status: 'cancelled', cancelledBy: 'system', $unset: { currentOffer: 1 } },
        { new: true }
    );

    if (!ride) return;

    heatmapClient.removeDemand(ride.pickupCoordinates.ltd, ride.pickupCoordinates.lng, ride._id);

    await publishEvent('ride-cancelled', [ `user:${ride.user}` ], {
        ...rideService.toClientShape(ride),
        reason: 'No captains available nearby'
    });
}


// closes the ride pop-up on the screen of the captain who held the offer
function closeOfferPopup(captainId, rideId) {
    publishEvent('ride-offer-expired', [ `captain:${captainId}` ], { rideId: String(rideId) })
        .catch(err => console.log('Could not close offer:', err.message));
}


// If RabbitMQ is down the offer can't be delivered. Keep trying for a while instead of
// leaving the ride pending with nobody looking at it; after that the ride is cancelled.
async function sendOffer(rideId, captainId, offer) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await publishEvent('new-ride', [ `captain:${captainId}` ], offer);
        } catch (err) {
            console.log(`Could not send the offer (attempt ${attempt}): ${err.message}`);
            if (attempt >= PUBLISH_RETRIES) {
                await giveUp(rideId);
                throw err;
            }
            await wait(PUBLISH_RETRY_MS);
        }
    }
}


async function offerToNext(rideId, token) {
    const previousOffer = clearOffer(rideId);

    if (previousOffer) {
        closeOfferPopup(previousOffer.captainId, rideId);
    }

    const ride = await rideModel.findById(rideId);
    if (!ride || ride.status !== 'pending') return;

    if (ride.offeredTo.length >= MAX_OFFERS) return giveUp(rideId);

    const candidates = await findCandidates(ride, token);
    if (candidates.length === 0) return giveUp(rideId);

    const { captain, etaSeconds } = candidates[ 0 ];

    // currentOffer is what lets this captain, and nobody else, accept the ride
    await rideModel.updateOne({ _id: rideId }, {
        $addToSet: { offeredTo: captain._id },
        currentOffer: captain._id
    });

    // captains must not see the otp, only the rider does
    const { otp, ...rideForCaptain } = rideService.toClientShape(ride);

    await sendOffer(rideId, captain._id, {
        ...rideForCaptain,
        pickupEtaMinutes: toMinutes(etaSeconds),
        offerSeconds: Math.round(OFFER_TIMEOUT / 1000)
    });

    const timer = setTimeout(() => {
        offerToNext(rideId, token).catch(err => console.log('Dispatch error:', err.message));
    }, OFFER_TIMEOUT);

    openOffers.set(String(rideId), { timer, captainId: String(captain._id) });
}


module.exports.startDispatch = (rideId, token) => offerToNext(rideId, token);

// the captain who holds the offer pressed "Ignore"
module.exports.declineOffer = async (rideId, captainId, token) => {
    const offer = openOffers.get(String(rideId));

    if (!offer || offer.captainId !== String(captainId)) return false;

    await offerToNext(rideId, token);
    return true;
}

// the ride was accepted or cancelled, so the countdown is no longer needed
module.exports.stopDispatch = (rideId, { notifyCaptain = false } = {}) => {
    const offer = clearOffer(rideId);

    if (offer && notifyCaptain) {
        closeOfferPopup(offer.captainId, rideId);
    }
}

// the "N mins away" label for each vehicle type
module.exports.etaByVehicleType = async (ltd, lng, token) => {
    const result = { car: null, moto: null, auto: null };

    const nearby = (await captainClient.getCaptainsInTheRadius(ltd, lng, SEARCH_RADIUS_KM)).filter(hasLocation);
    const busy = await findBusyCaptainIds(nearby);
    const free = nearby.filter(captain => !busy.includes(String(captain._id)));

    if (free.length === 0) return result;

    const etas = await mapService.getEtas(free.map(toPoint), { ltd, lng }, token);

    free.forEach((captain, i) => {
        const type = captain.vehicle.vehicleType;
        const minutes = toMinutes(etas[ i ] ?? null);

        if (minutes !== null && (result[ type ] === null || minutes < result[ type ])) {
            result[ type ] = minutes;
        }
    });
    return result;
}

// After a restart the countdowns are gone, so rides still "pending" would wait forever.
module.exports.closeStaleRides = async () => {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);

    await rideModel.updateMany(
        { status: 'pending', createdAt: { $lt: cutoff } },
        { status: 'cancelled', cancelledBy: 'system', $unset: { currentOffer: 1 } }
    );
}
