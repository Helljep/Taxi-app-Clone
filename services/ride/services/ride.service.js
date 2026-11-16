const rideModel = require('../models/ride.model');
const mapService = require('./maps.client');
const heatmapClient = require('./heatmap.client');
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


async function getFare(pickup, destination, token) {

    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination, token);
    const pickupCoordinates = await mapService.getAddressCoordinate(pickup, token);
    const surge = await heatmapClient.getSurge(pickupCoordinates.ltd, pickupCoordinates.lng);

    return {
        ...applySurge(calculateFare(distanceTime), surge.multiplier),
        surge: { multiplier: surge.multiplier, drivers: surge.drivers, demand: surge.demand }
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

    return data;
}


module.exports.createRide = async ({
    user, pickup, destination, vehicleType, token, pickupCoordinates
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination, token);
    const surge = await heatmapClient.getSurge(pickupCoordinates.ltd, pickupCoordinates.lng);
    const fare = applySurge(calculateFare(distanceTime), surge.multiplier);

    const ride = await rideModel.create({
        user: user._id,
        userInfo: { fullname: user.fullname },
        pickup,
        destination,
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

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id
    });

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'ongoing') {
        throw new Error('Ride not ongoing');
    }

    ride.status = 'completed';
    await ride.save();

    return ride;
}
