const axios = require('axios');

const headers = { 'x-internal-key': process.env.INTERNAL_KEY };

// asks the captain service which free captains are close to a pickup point
module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, vehicleType) => {
    const response = await axios.get(`${process.env.CAPTAIN_SERVICE_URL}/nearby`, {
        params: { ltd, lng, radius, vehicleType },
        headers
    });
    return response.data;
}

module.exports.addEarnings = async (captainId, amount) => {
    await axios.post(`${process.env.CAPTAIN_SERVICE_URL}/internal/earnings`,
        { captainId: String(captainId), amount },
        { headers, timeout: 4000 });
}

module.exports.addRating = async (captainId, rating) => {
    await axios.post(`${process.env.CAPTAIN_SERVICE_URL}/internal/rating`,
        { captainId: String(captainId), rating },
        { headers, timeout: 4000 });
}
