const rideModel = require('../models/ride.model');
const mapService = require('./maps.client');
const heatmapClient = require('./heatmap.client');
const clients = require('./clients');
const { isCancellationAbuse, CANCEL_WINDOW_MS } = require('./fraud');
const crypto = require('crypto');

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


// price rises when there are more ride requests than free captains nearby
function applySurge(fare, multiplier) {
    const surged = {};
    for (const type of Object.keys(fare)) {
        surged[ type ] = Math.round(fare[ type ] * multiplier);
    }
    return surged;
}


// Also returns the pickup coordinates so the controller can look up ETAs without geocoding twice.
async function getFare(pickup, destination, token) {

    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination, token);
    const pickupCoordinates = await mapService.getAddressCoordinate(pickup, token);
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
    user, pickup, destination, vehicleType, token, pickupCoordinates, paymentMethod = 'cash'
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    // fraud / abuse rule: someone who keeps booking and cancelling wastes captains' time
    const recentCancels = await rideModel.countDocuments({
        user: user._id,
        status: 'cancelled',
        cancelledBy: 'user',
        updatedAt: { $gt: new Date(Date.now() - CANCEL_WINDOW_MS) }
    });
    if (isCancellationAbuse(recentCancels)) {
        const err = new Error('Too many cancelled rides. Please try again in a few minutes.');
        err.status = 429;
        throw err;
    }

    // one unfinished ride at a time per rider
    const open = await rideModel.findOne({ user: user._id, status: { $in: [ 'pending', 'accepted', 'ongoing' ] } });
    if (open) {
        const err = new Error('You already have a ride in progress.');
        err.status = 409;
        throw err;
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination, token);
    const surge = await heatmapClient.getSurge(pickupCoordinates.ltd, pickupCoordinates.lng);
    const fare = applySurge(calculateFare(distanceTime), surge.multiplier);

    const ride = await rideModel.create({
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
    })

    return ride;
}

module.exports.confirmRide = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    // a captain can only drive one ride at a time
    const busy = await rideModel.findOne({ captain: captain._id, status: { $in: [ 'accepted', 'ongoing' ] } });
    if (busy) {
        throw new Error('You already have a ride in progress');
    }

    // the status check makes sure two captains can't both accept the same ride
    const ride = await rideModel.findOneAndUpdate({
        _id: rideId,
        status: 'pending'
    }, {
        status: 'accepted',
        captain: captain._id,
        captainInfo: {
            fullname: captain.fullname,
            vehicle: captain.vehicle
        }
    }, { new: true }).select('+otp');

    if (!ride) {
        throw new Error('Ride not found or already accepted');
    }

    return ride;
}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'accepted') {
        throw new Error('Ride not accepted');
    }

    if (String(ride.captain) !== String(captain._id)) {
        throw new Error('This ride belongs to another captain');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    ride.status = 'ongoing';
    await ride.save();

    return ride;
}


// Takes the fare from the rider (wallet) or marks it as cash. Called once per ride.
async function settlePayment(ride) {
    if (ride.paymentMethod === 'wallet') {
        try {
            const balance = await clients.chargeWallet(ride.user, ride.fare);
            if (balance !== null) {
                return 'paid';
            }
        } catch (err) {
            console.log('Wallet charge failed:', err.message);
        }
        // not enough money (or the user service is down): the rider pays the captain in cash
        return 'cash-due';
    }
    return 'paid'; // cash is handed to the captain
}

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    // ongoing -> completed in ONE atomic step: a double tap on "Finish" can never
    // charge the rider or pay the captain twice, because only one call wins this.
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, captain: captain._id, status: 'ongoing' },
        { status: 'completed' },
        { new: true }
    );

    if (!ride) {
        throw new Error('Ride not found or not ongoing');
    }

    ride.paymentStatus = await settlePayment(ride);
    await rideModel.updateOne({ _id: ride._id }, { paymentStatus: ride.paymentStatus });

    try {
        await clients.addCaptainEarnings(captain._id, ride.fare);
    } catch (err) {
        console.log('Could not credit captain earnings:', err.message);
    }

    return ride;
}


// who may cancel and when: the rider before the trip starts, the captain after accepting
module.exports.cancelRide = async ({ rideId, by, userId, captainId }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
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
        { status: 'cancelled', cancelledBy: by }, { new: true });

    if (!ride) {
        throw new Error('This ride cannot be cancelled');
    }

    return ride;
}


module.exports.getHistory = async ({ userId, captainId }) => {
    const filter = userId ? { user: userId } : { captain: captainId };
    filter.status = { $in: [ 'completed', 'cancelled' ] };

    return await rideModel.find(filter).sort({ createdAt: -1 }).limit(50);
}


module.exports.rateRide = async ({ rideId, userId, score, comment }) => {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new Error('Rating must be a whole number from 1 to 5');
    }

    // "rating.score does not exist yet" makes sure a ride can only be rated once
    const ride = await rideModel.findOneAndUpdate(
        { _id: rideId, user: userId, status: 'completed', 'rating.score': { $exists: false } },
        { rating: { score, comment: String(comment || '').slice(0, 300) } },
        { new: true }
    );

    if (!ride) {
        throw new Error('Ride not found, not finished, or already rated');
    }

    try {
        await clients.addCaptainRating(ride.captain, score);
    } catch (err) {
        console.log('Could not save captain rating:', err.message);
    }

    return ride;
}
