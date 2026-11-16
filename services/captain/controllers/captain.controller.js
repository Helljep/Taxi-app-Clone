const captainModel = require('../models/captain.model');
const captainService = require('../services/captain.service');
const blackListTokenModel = require('../models/blacklistToken.model');
const { validationResult } = require('express-validator');


module.exports.registerCaptain = async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { fullname, email, password, vehicle } = req.body;

    const isCaptainAlreadyExist = await captainModel.findOne({ email });

    if (isCaptainAlreadyExist) {
        return res.status(400).json({ message: 'Captain already exist' });
    }


    const hashedPassword = await captainModel.hashPassword(password);

    let captain;
    try {
        captain = await captainService.createCaptain({
            firstname: fullname.firstname,
            lastname: fullname.lastname,
            email,
            password: hashedPassword,
            color: vehicle.color,
            plate: vehicle.plate,
            capacity: vehicle.capacity,
            vehicleType: vehicle.vehicleType
        });
    } catch (err) {
        // mongoose validation errors (eg. lastname too short) land here
        return res.status(400).json({ message: err.message });
    }

    const token = captain.generateAuthToken();

    res.status(201).json({ token, captain });

}

module.exports.loginCaptain = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const captain = await captainModel.findOne({ email }).select('+password');

    if (!captain) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await captain.comparePassword(password);

    if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = captain.generateAuthToken();

    res.cookie('token', token);

    res.status(200).json({ token, captain });
}

module.exports.getCaptainProfile = async (req, res, next) => {
    res.status(200).json({ captain: req.captain });
}

module.exports.logoutCaptain = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    await blackListTokenModel.create({ token });

    res.clearCookie('token');

    res.status(200).json({ message: 'Logout successfully' });
}

// the online / offline switch in the captain app
module.exports.updateStatus = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const captain = await captainService.setStatus(req.captain._id, req.body.status);
        res.status(200).json({ captain });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

// internal: the ride service reports a rider's rating of this captain
module.exports.addRating = async (req, res) => {
    const { captainId, rating } = req.body;

    if (!captainId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ message: 'captainId and a rating from 1 to 5 are required' });
    }

    try {
        const captain = await captainService.addRating(captainId, rating);
        res.status(200).json({ rating: captain.rating });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

// internal: the ride service credits the captain when a ride is paid
module.exports.addEarnings = async (req, res) => {
    const { captainId, amount } = req.body;

    if (!captainId || !(amount >= 0)) {
        return res.status(400).json({ message: 'captainId and amount are required' });
    }

    try {
        await captainService.addEarnings(captainId, amount);
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

// internal endpoint: the ride service asks "which captains are near this pickup?"
module.exports.getNearbyCaptains = async (req, res) => {
    const { ltd, lng, radius, vehicleType } = req.query;

    if (!ltd || !lng) {
        return res.status(400).json({ message: 'ltd and lng are required' });
    }

    try {
        const captains = await captainService.getCaptainsInTheRadius(
            Number(ltd), Number(lng), Number(radius) || 2, vehicleType
        );
        res.status(200).json(captains);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}
