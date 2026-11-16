const axios = require('axios');

const headers = { 'x-internal-key': process.env.INTERNAL_KEY };
const NO_SURGE = { multiplier: 1, drivers: 0, demand: 0 };

// How busy is it around this pickup? If the heatmap service is down the
// normal fare is charged, so a booking never fails because of it.
module.exports.getSurge = async (ltd, lng) => {
    try {
        const response = await axios.get(`${process.env.HEATMAP_SERVICE_URL}/surge`, {
            params: { ltd, lng },
            headers,
            timeout: 2000
        });
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
