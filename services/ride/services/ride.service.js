const rideModel = require('../models/ride.model');
const mapService = require('./maps.client');
const heatmapClient = require('./heatmap.client');
const userClient = require('./user.client');
const captainClient = require('./captain.client');
const crypto = require('crypto');
const { RideError } = require('./errors');
const driverIndex = require('./driverIndex');
const { estimateRoute } = require('./geo');

// a rider who cancels this many rides in this window is blocked for a while
const MAX_CANCELS = 3;
const CANCEL_WINDOW = 30 * 60 * 1000; // ms


function calculateFare(distanceTime) {

    const baseFare = {
        auto: 30,
        car: 50,
        moto: 20
    };

    const perKmRate = {
        auto: 10,
        car: 15,
        moto: 8
    };

    const perMinuteRate = {
        auto: 2,
        car: 3,
        moto: 1.5
    };

    const km = distanceTime.distance.value / 1000;
    const minutes = distanceTime.duration.value / 60;

    const fare = {
        auto: Math.round(baseFare.auto + (km * perKmRate.auto) + (minutes * perMinuteRate.auto)),
        car: Math.round(baseFare.car + (km * perKmRate.car) + (minutes * perMinuteRate.car)),
        moto: Math.round(baseFare.moto + (km * perKmRate.moto) + (minutes * perMinuteRate.moto))
    };

    return fare;
}


// when there are more requests than free captains nearby, every fare goes up
function applySurge(fare, multiplier) {
    const surged = {};
    for (const type of Object.keys(fare)) {
        surged[ type ] = Math.round(fare[ type ] * multiplier);
    }
    return surged;
}


// Distance and time of the trip. Normally from the routing server. If that is down (the
// circuit breaker is open), too slow, or ROUTING=estimate is set (load tests), we fall
// back to straight-line maths so a booking never fails just because a map server did.
async function getRoute(pickup, destination, token, pickupCoordinates, destinationCoordinates) {
    if (process.env.ROUTING !== 'estimate') {
        try {
            return await mapService.getDistanceTime(pickup, destination, token);
        } catch (err) {
            console.log('Routing unavailable, estimating the route:', err.message);
        }
    }

    let to = destinationCoordinates;
    if (!to) {
        try { to = await mapService.getAddressCoordinate(destination, token); } catch (err) { /* handled below */ }
    }
    if (!pickupCoordinates || !to) {
        throw new RideError('Maps are temporarily unavailable, please try again shortly', 503);
    }
    return estimateRoute(pickupCoordinates, to);
}

module.exports.getRoute = getRoute;


// Also returns the pickup coordinates, so the controller can look up
// nearby captains without geocoding the address a second time.
async function getFare(pickup, destination, token) {

    if (!pickup || !destination) {
        throw new RideError('Pickup and destination are required');
    }

    const pickupCoordinates = await mapService.getAddressCoordinate(pickup, token);
    const distanceTime = await getRoute(pickup, destination, token, pickupCoordinates);
    const surge = await heatmapClient.getSurge(pickupCoordinates.ltd, pickupCoordinates.lng);

    return {
        ...applySurge(calculateFare(distanceTime), surge.multiplier),
        surge: { multiplier: surge.multiplier, drivers: surge.drivers, demand: surge.demand },
        pickupCoordinates
    };
}

module.exports.getFare = getFare;


function getOtp(num) {
    return crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
}


// The screens expect ride.user.fullname and ride.captain.vehicle.plate,
// so we rebuild that shape from the copies stored on the ride.
module.exports.toClientShape = (ride) => {
    const data = ride.toObject();

    data.user = { _id: data.user, ...data.userInfo };

    if (data.captain) {
        data.captain = { _id: data.captain, ...data.captainInfo };
    }

    delete data.userInfo;
    delete data.captainInfo;
    delete data.offeredTo;

    return data;
}


module.exports.createRide = async ({
    user, pickup, destination, vehicleType, token, pickupCoordinates, destinationCoordinates, paymentMethod = 'cash'
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new RideError('All fields are required');
    }

    const recentCancels = await rideModel.countDocuments({
        user: user._id,
        status: 'cancelled',
        cancelledBy: 'user',
        updatedAt: { $gt: new Date(Date.now() - CANCEL_WINDOW) }
    });

    if (recentCancels >= MAX_CANCELS) {
        throw new RideError('Too many cancelled rides. Please try again in a few minutes.', 429);
    }

    const openRide = await rideModel.findOne({ user: user._id, status: { $in: [ 'pending', 'accepted', 'ongoing' ] } });

    if (openRide) {
        throw new RideError('You already have a ride in progress.', 409);
    }

    const distanceTime = await getRoute(pickup, destination, token, pickupCoordinates, destinationCoordinates);
    const surge = await heatmapClient.getSurge(pickupCoordinates.ltd, pickupCoordinates.lng);
    const fare = applySurge(calculateFare(distanceTime), surge.multiplier);

    let ride;
    try {
        ride = await rideModel.create({
        user: user._id,
        userInfo: { fullname: user.fullname },
        pickup,
        destination,
        vehicleType,
        pickupCoordinates,
        paymentMethod,
        otp: getOtp(6),
        fare: fare[ vehicleType ],
        surgeMultiplier: surge.multiplier,
        distance: distanceTime.distance.value,
        duration: distanceTime.duration.value
        });
    } catch (err) {
        // two requests at once: the unique index let only one of them through
        if (err.code === 11000) throw new RideError('You already have a ride in progress.', 409);
        throw err;
    }

    return ride;
}

module.exports.confirmRide = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new RideError('Ride id is required');
    }

    // Accepting twice is safe: if this captain already holds this ride (their first answer was
    // lost in a network blip or a restart), return it again instead of an error.
    const mine = await rideModel.findOne({ _id: rideId, captain: captain._id, status: 'accepted' }).select('+otp');
    if (mine) return mine;

    const busy = await rideModel.findOne({ captain: captain._id, status: { $in: [ 'accepted', 'ongoing' ] } });

    if (busy) {
        throw new RideError('You already have a ride in progress');
    }

    // Only the captain who holds the offer can accept, and only while it is pending,
    // so two captains can't take the same ride.
    let ride;
    try {
        ride = await rideModel.findOneAndUpdate({
        _id: rideId,
        status: 'pending',
        currentOffer: captain._id
    }, {
        status: 'accepted',
        $unset: { currentOffer: 1 },
        captain: captain._id,
        captainInfo: {
            fullname: captain.fullname,
            vehicle: captain.vehicle
        }
    }, { new: true }).select('+otp');
    } catch (err) {
        if (err.code === 11000) throw new RideError('You already have a ride in progress', 409);
        throw err;
    }

    if (!ride) {
        throw new RideError('This ride is not offered to you or was already taken', 409);
    }

    // the captain leaves the pool of free drivers at once, no more offers for them
    await driverIndex.markOnRide(captain._id, ride._id).catch(err => console.log('Could not mark on ride:', err.message));

    return ride;
}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new RideError('Ride id and OTP are required');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).select('+otp');

    if (!ride) {
        throw new RideError('Ride not found');
    }

    if (ride.status !== 'accepted') {
        throw new RideError('Ride not accepted');
    }

    if (String(ride.captain) !== String(captain._id)) {
        throw new RideError('This ride belongs to another captain');
    }

    if (ride.otp !== otp) {
        throw new RideError('Invalid OTP');
    }

    ride.status = 'ongoing';
    await ride.save();

    return ride;
}


// Wallet rides are charged here. If the wallet is short, the rider pays the captain in cash.
async function settlePayment(ride) {
    if (ride.paymentMethod !== 'wallet') {
        return 'paid';
    }

    try {
        const balance = await userClient.chargeWallet(ride.user, ride.fare);
        return balance === null ? 'cash-due' : 'paid';
    } catch (err) {
        console.log('Wallet charge failed:', err.message);
        return 'cash-due';
    }
}

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new RideError('Ride id is required');
    }

    // Moving ongoing -> completed is one atomic step, so a double tap on "Finish"
    // can never charge the rider or pay the captain twice.
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, captain: captain._id, status: 'ongoing' },
        { status: 'completed' },
        { new: true }
    );

    if (!ride) {
        throw new RideError('Ride not found or not ongoing');
    }

    driverIndex.markFree(captain._id).catch(() => {});

    ride.paymentStatus = await settlePayment(ride);
    await rideModel.updateOne({ _id: ride._id }, { paymentStatus: ride.paymentStatus });

    try {
        await captainClient.addEarnings(captain._id, ride.fare);
    } catch (err) {
        console.log('Could not credit captain earnings:', err.message);
    }

    return ride;
}


// A rider can cancel until the trip starts, a captain only after accepting.
module.exports.cancelRide = async ({ rideId, by, userId, captainId }) => {
    if (!rideId) {
        throw new RideError('Ride id is required');
    }

    const filter = { _id: rideId };

    if (by === 'user') {
        filter.user = userId;
        filter.status = { $in: [ 'pending', 'accepted' ] };
    } else {
        filter.captain = captainId;
        filter.status = 'accepted';
    }

    const ride = await rideModel.findOneAndUpdate(filter,
        { status: 'cancelled', cancelledBy: by, $unset: { currentOffer: 1 } }, { new: true });

    if (!ride) {
        throw new RideError('This ride cannot be cancelled');
    }

    if (ride.captain) driverIndex.markFree(ride.captain).catch(() => {});

    return ride;
}


module.exports.getHistory = async ({ userId, captainId }) => {
    const filter = userId ? { user: userId } : { captain: captainId };
    filter.status = { $in: [ 'completed', 'cancelled' ] };

    return await rideModel.find(filter).sort({ createdAt: -1 }).limit(50);
}


module.exports.rateRide = async ({ rideId, userId, score, comment }) => {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new RideError('Rating must be a whole number from 1 to 5');
    }

    // only a ride with no rating yet matches, so a ride can be rated once
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, user: userId, status: 'completed', 'rating.score': { $exists: false } },
        { rating: { score, comment: String(comment || '').slice(0, 300) } },
        { new: true }
    );

    if (!ride) {
        throw new RideError('Ride not found, not finished, or already rated');
    }

    try {
        await captainClient.addRating(ride.captain, score);
    } catch (err) {
        console.log('Could not save captain rating:', err.message);
    }

    return ride;
}
