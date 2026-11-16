const axios = require('axios');

const headers = { 'x-internal-key': process.env.INTERNAL_KEY };
const NO_SURGE = { multiplier: 1, drivers: 0, demand: 0 };

// How busy is it around this pickup point? If the heatmap service is down we
// charge the normal fare rather than failing the whole booking.
module.exports.getSurge = async (ltd, lng) => {
    try {
        const response = await axios.get(`${process.env.HEATMAP_SERVICE_URL}/surge`, {
            params: { ltd, lng },
            headers,
            timeout: 2000
        });
        return response.data;
    } catch (err) {
        console.log('Could not get surge, using normal fare:', err.message);
        return NO_SURGE;
    }
}

// each ride request counts as demand for the pickup area
module.exports.recordDemand = async (ltd, lng, rideId) => {
    try {
        await axios.post(`${process.env.HEATMAP_SERVICE_URL}/demand`,
            { ltd, lng, rideId: String(rideId) },
            { headers, timeout: 2000 });
    } catch (err) {
        console.log('Could not record demand:', err.message);
    }
}
