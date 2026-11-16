const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cells = require('./services/cells');

const app = express();
app.use(express.json());
app.use(cookieParser());


// any logged-in user or captain may look at the map
function authAny(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ message: 'Unauthorized' });
    }
}

// only the ride service knows this key
function internalOnly(req, res, next) {
    if (req.headers[ 'x-internal-key' ] !== process.env.INTERNAL_KEY) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    next();
}

const isCoordinate = (ltd, lng) =>
    Number.isFinite(ltd) && Number.isFinite(lng) && Math.abs(ltd) <= 90 && Math.abs(lng) <= 180;


// the gateway strips "/heatmap", so routes here start from "/"

// all active cells, drawn by the frontend as hexagons
app.get('/', authAny, async (req, res) => {
    try {
        res.json({ cells: await cells.getSnapshot() });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// price multiplier at one point (called by the ride service)
app.get('/surge', internalOnly, async (req, res) => {
    const ltd = Number(req.query.ltd), lng = Number(req.query.lng);
    if (!isCoordinate(ltd, lng)) return res.status(400).json({ message: 'ltd and lng are required' });

    try {
        res.json(await cells.getSurgeAt(ltd, lng));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// "someone just asked for a ride here" (called by the ride service)
app.post('/demand', internalOnly, async (req, res) => {
    const ltd = Number(req.body.ltd), lng = Number(req.body.lng);
    if (!isCoordinate(ltd, lng) || !req.body.rideId) {
        return res.status(400).json({ message: 'ltd, lng and rideId are required' });
    }

    try {
        await cells.addDemand(ltd, lng, req.body.rideId);
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = app;
