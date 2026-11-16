const mapService = require('../services/maps.service');
const { validationResult } = require('express-validator');


module.exports.getCoordinates = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }


    const { address } = req.query;

    try {
        const coordinates = await mapService.getAddressCoordinate(address);
        res.status(200).json(coordinates);
    } catch (error) {
        res.status(404).json({ message: 'Coordinates not found' });
    }
}

module.exports.getDistanceTime = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { origin, destination } = req.query;

        const distanceTime = await mapService.getDistanceTime(origin, destination);

        res.status(200).json(distanceTime);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports.getRoute = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        res.status(200).json(await mapService.getRoute(req.query.origin, req.query.destination));
    } catch (err) {
        console.error(err.message);
        res.status(404).json({ message: 'Route not found' });
    }
}

module.exports.getEtas = async (req, res) => {
    const { from, to } = req.body;

    const valid = (p) => p && Number.isFinite(p.ltd) && Number.isFinite(p.lng);
    if (!Array.isArray(from) || from.length === 0 || from.length > 50 || !from.every(valid) || !valid(to)) {
        return res.status(400).json({ message: 'from (1 to 50 points) and to are required' });
    }

    try {
        res.status(200).json(await mapService.getEtas(from, to));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

module.exports.getAutoCompleteSuggestions = async (req, res, next) => {

    try {

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { input } = req.query;

        const suggestions = await mapService.getAutoCompleteSuggestions(input);

        res.status(200).json(suggestions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
}