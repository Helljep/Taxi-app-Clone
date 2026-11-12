const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.client');
const captainService = require('../services/captain.client');
const { publishToQueue } = require('../services/rabbit');


// Instead of talking to sockets directly, the ride service drops a message
// on the "ride-events" queue. The realtime service picks it up and
// pushes it to the right browsers.
function publishEvent(event, rooms, data) {
    return publishToQueue('ride-events', JSON.stringify({ event, rooms, data }));
}


module.exports.createRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { pickup, destination, vehicleType } = req.body;

    let ride;

    try {
        ride = await rideService.createRide({ user: req.user, pickup, destination, vehicleType, token: req.token });
        res.status(201).json(rideService.toClientShape(ride));
    } catch (err) {
        console.log(err.message);
        return res.status(500).json({ message: err.message });
    }

    // the user already has their answer, now find captains and notify them
    try {
        const pickupCoordinates = await mapService.getAddressCoordinate(pickup, req.token);

        const captainsInRadius = await captainService.getCaptainsInTheRadius(
            pickupCoordinates.ltd, pickupCoordinates.lng, 2, vehicleType
        );

        // captains must not see the otp, only the user does
        const { otp, ...rideForCaptains } = rideService.toClientShape(ride);

        const rooms = captainsInRadius.map(captain => `captain:${captain._id}`);

        await publishEvent('new-ride', rooms, rideForCaptains);
    } catch (err) {
        console.log('Could not notify captains:', err.message);
    }
};

module.exports.getFare = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { pickup, destination } = req.query;

    try {
        const fare = await rideService.getFare(pickup, destination, req.token);
        return res.status(200).json(fare);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.confirmRide({ rideId, captain: req.captain });
        const rideData = rideService.toClientShape(ride);

        await publishEvent('ride-confirmed', [ `user:${rideData.user._id}` ], rideData);

        return res.status(200).json(rideData);
    } catch (err) {

        console.log(err.message);
        return res.status(500).json({ message: err.message });
    }
}

module.exports.startRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, otp } = req.query;

    try {
        const ride = await rideService.startRide({ rideId, otp, captain: req.captain });
        const rideData = rideService.toClientShape(ride);

        await publishEvent('ride-started', [ `user:${rideData.user._id}` ], rideData);

        return res.status(200).json(rideData);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.endRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.endRide({ rideId, captain: req.captain });
        const rideData = rideService.toClientShape(ride);

        await publishEvent('ride-ended', [ `user:${rideData.user._id}` ], rideData);

        return res.status(200).json(rideData);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}
