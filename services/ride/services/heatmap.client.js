const axios = require('axios');

const headers = { 'x-internal-key': process.env.INTERNAL_KEY };
const NO_SURGE = { multiplier: 1, drivers: 0, demand: 0 };

// How busy is it around this pickup? If the heatmap service is down the
// normal fare is charged, so a booking never fails because of it.
// Surge barely changes from second to second, so one answer is reused for ~1 km and 2 s.
// A thousand requests from one neighbourhood become one call to the heatmap service.
const surgeCache = new Map();
const SURGE_TTL = 2000;

module.exports.getSurge = async (ltd, lng) => {
    const key = `${Number(ltd).toFixed(2)},${Number(lng).toFixed(2)}`;
    const hit = surgeCache.get(key);
    if (hit && Date.now() - hit.at < SURGE_TTL) return hit.value;

    try {
        const response = await axios.get(`${process.env.HEATMAP_SERVICE_URL}/surge`, {
            params: { ltd, lng },
            headers,
            timeout: 2000
        });
        surgeCache.set(key, { at: Date.now(), value: response.data });
        if (surgeCache.size > 5000) surgeCache.clear();
        return response.data;
    } catch (err) {
        console.log('Could not get surge, using the normal fare:', err.message);
        return NO_SURGE;
    }
}

// every ride request counts as demand for its pickup area
module.exports.recordDemand = async (ltd, lng, rideId) => {
    try {
        await axios.post(`${process.env.HEATMAP_SERVICE_URL}/demand`,
            { ltd, lng, rideId: String(rideId) },
            { headers, timeout: 2000 });
    } catch (err) {
        console.log('Could not record demand:', err.message);
    }
}

// a ride that was cancelled is no longer demand
module.exports.removeDemand = async (ltd, lng, rideId) => {
    try {
        await axios.post(`${process.env.HEATMAP_SERVICE_URL}/demand/remove`,
            { ltd, lng, rideId: String(rideId) },
            { headers, timeout: 2000 });
    } catch (err) {
        console.log('Could not remove demand:', err.message);
    }
}
