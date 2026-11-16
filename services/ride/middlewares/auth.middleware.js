const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
const redis = require('../services/redis');

// The ride service has no user/captain database of its own.
// So it checks the token, then asks the owning service "who is this?"
//
// That answer is cached for a minute. Without it every ride request, accept and
// location call would also hit the user/captain service: one request becomes two,
// and a traffic spike lands on the login database as well. Trade-off: a token that
// was logged out can still work for up to a minute here.

const PROFILE_TTL = 60; // seconds

function getToken(req) {
    return req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];
}

async function lookup(kind, url, token) {
    const key = `auth:${kind}:${crypto.createHash('sha1').update(token).digest('hex')}`;

    try {
        const hit = await redis.get(key);
        if (hit) return JSON.parse(hit);
    } catch (err) { /* cache is optional */ }

    const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 });
    redis.set(key, JSON.stringify(response.data), 'EX', PROFILE_TTL).catch(() => {});
    return response.data;
}


module.exports.authUser = async (req, res, next) => {
    const token = getToken(req);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        req.user = await lookup('user', `${process.env.USER_SERVICE_URL}/profile`, token);
        req.token = token;

        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}


module.exports.authCaptain = async (req, res, next) => {
    const token = getToken(req);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        req.captain = (await lookup('captain', `${process.env.CAPTAIN_SERVICE_URL}/profile`, token)).captain;
        req.token = token;

        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}
