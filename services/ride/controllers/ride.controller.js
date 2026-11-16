const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.client');
const heatmapClient = require('../services/heatmap.client');
const dispatch = require('../services/dispatch');
const { publishEvent } = require('../services/events');


const sendValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return true;
    }
    return false;
}


module.exports.createRide = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    const { pickup, destination, vehicleType, paymentMethod } = req.body;

    let ride, pickupCoordinates;

    try {
        // the pickup point decides the surge price and who is nearby, so look it up first
        pickupCoordinates = await mapService.getAddressCoordinate(pickup, req.token);

        ride = await rideService.createRide({
            user: req.user, pickup, destination, vehicleType, token: req.token, pickupCoordinates, paymentMethod
        });
        res.status(201).json(rideService.toClientShape(ride));
    } catch (err) {
        console.log(err.message);
        return res.status(err.status || 500).json({ message: err.message });
    }

    // this request is "demand" for the heatmap (fire and forget, never blocks the ride)
    heatmapClient.recordDemand(pickupCoordinates.ltd, pickupCoordinates.lng, ride._id);

    // the user already has their answer, now offer the ride to the best captain
    dispatch.startDispatch(ride._id, req.token)
        .catch(err => console.log('Could not dispatch ride:', err.message));
};

module.exports.getFare = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    const { pickup, destination } = req.query;

    try {
        const { pickupCoordinates, ...fare } = await rideService.getFare(pickup, destination, req.token);

        // "N mins away" per vehicle type, never allowed to break the fare itself
        let eta = { car: null, moto: null, auto: null };
        try {
            eta = await dispatch.etaByVehicleType(pickupCoordinates.ltd, pickupCoordinates.lng, req.token);
        } catch (err) {
            console.log('Could not get ETAs:', err.message);
        }

        return res.status(200).json({ ...fare, eta });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmRide = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    const { rideId } = req.body;

    try {
        const ride = await rideService.confirmRide({ rideId, captain: req.captain });
        const rideData = rideService.toClientShape(ride);

        dispatch.stopDispatch(rideId);

        await publishEvent('ride-confirmed', [ `user:${rideData.user._id}` ], rideData);

        return res.status(200).json(rideData);
    } catch (err) {

        console.log(err.message);
        return res.status(err.status || 500).json({ message: err.message });
    }
}

// the captain pressed "Ignore": offer the ride to the next captain straight away
module.exports.declineRide = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    try {
        const declined = await dispatch.declineOffer(req.body.rideId, req.captain._id, req.token);
        return res.status(200).json({ declined });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

module.exports.startRide = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    const { rideId, otp } = req.query;

    try {
        const ride = await rideService.startRide({ rideId, otp, captain: req.captain });
        const rideData = rideService.toClientShape(ride);

        await publishEvent('ride-started', [ `user:${rideData.user._id}` ], rideData);

        return res.status(200).json(rideData);
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

module.exports.endRide = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    const { rideId } = req.body;

    try {
        const ride = await rideService.endRide({ rideId, captain: req.captain });
        const rideData = rideService.toClientShape(ride);

        await publishEvent('ride-ended', [ `user:${rideData.user._id}` ], rideData);

        return res.status(200).json(rideData);
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}


// Cancelling tells the OTHER side: a rider cancelling informs the captain, and the
// other way round. If the ride was still being offered, the open pop-up is closed too.
async function cancel(req, res, by) {
    if (sendValidationErrors(req, res)) return;

    try {
        const ride = await rideService.cancelRide({
            rideId: req.body.rideId,
            by,
            userId: req.user?._id,
            captainId: req.captain?._id
        });
        const rideData = rideService.toClientShape(ride);

        dispatch.stopDispatch(ride._id, { notifyCaptain: true });
        heatmapClient.removeDemand(ride.pickupCoordinates.ltd, ride.pickupCoordinates.lng, ride._id);

        const rooms = by === 'user'
            ? (rideData.captain?._id ? [ `captain:${rideData.captain._id}` ] : [])
            : [ `user:${rideData.user._id}` ];

        // the event is also what tells the realtime service to stop live tracking
        await publishEvent('ride-cancelled', rooms, rideData);

        return res.status(200).json(rideData);
    } catch (err) {
        return res.status(err.status || 400).json({ message: err.message });
    }
}

module.exports.cancelRide = (req, res) => cancel(req, res, 'user');

module.exports.cancelRideByCaptain = (req, res) => cancel(req, res, 'captain');


module.exports.getUserHistory = async (req, res) => {
    try {
        const rides = await rideService.getHistory({ userId: req.user._id });
        return res.status(200).json(rides.map(rideService.toClientShape));
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.getCaptainHistory = async (req, res) => {
    try {
        const rides = await rideService.getHistory({ captainId: req.captain._id });
        return res.status(200).json(rides.map(rideService.toClientShape));
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}


module.exports.rateRide = async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    try {
        const ride = await rideService.rateRide({
            rideId: req.body.rideId,
            userId: req.user._id,
            score: req.body.rating,
            comment: req.body.comment
        });
        return res.status(200).json(rideService.toClientShape(ride));
    } catch (err) {
        return res.status(err.status || 400).json({ message: err.message });
    }
}
