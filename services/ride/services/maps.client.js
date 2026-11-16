const axios = require('axios');
const redis = require('./redis');
const { Breaker } = require('./breaker');

// Talks to the maps service (which talks to the free OpenStreetMap servers).
// Two protections, because those servers are the slowest and weakest link:
//   - a cache: the same address or route is only looked up once
//   - a circuit breaker: if they keep failing we stop calling and use our own estimate
// The user's own token is forwarded because the maps service checks it too.

const breaker = new Breaker('maps', { threshold: 5, openMs: 10000 });

async function cached(key, ttlSeconds, load) {
    try {
        const hit = await redis.get(key);
        if (hit) return JSON.parse(hit);
    } catch (err) { /* cache is optional */ }

    const value = await breaker.run(load);

    redis.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
    return value;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });


module.exports.getDistanceTime = (origin, destination, token) =>
    cached(`route:${origin.toLowerCase()}|${destination.toLowerCase()}`, 600, async () => {
        const response = await axios.get(`${process.env.MAPS_SERVICE_URL}/get-distance-time`, {
            params: { origin, destination }, headers: auth(token), timeout: 4000
        });
        return response.data;
    });


module.exports.getAddressCoordinate = (address, token) =>
    cached(`geocode:${address.toLowerCase()}`, 86400, async () => {
        const response = await axios.get(`${process.env.MAPS_SERVICE_URL}/get-coordinates`, {
            params: { address }, headers: auth(token), timeout: 4000
        });
        return response.data;
    });


// driving time in seconds from each point in `from` to the point `to`, in the same order
module.exports.getEtas = async (from, to, token) => {
    const response = await axios.post(`${process.env.MAPS_SERVICE_URL}/get-etas`, { from, to }, {
        headers: auth(token),
        timeout: 6000
    });
    return response.data.durations;
}
