const axios = require('axios');

// asks the captain service which captains are close to a pickup point
module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, vehicleType) => {
    const response = await axios.get(`${process.env.CAPTAIN_SERVICE_URL}/nearby`, {
        params: { ltd, lng, radius, vehicleType },
        headers: { 'x-internal-key': process.env.INTERNAL_KEY }
    });
    return response.data;
}
