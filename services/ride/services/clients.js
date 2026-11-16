const axios = require('axios');

// Small helpers for the ride service to call the other services.
// Calls that must not hang the ride flow have a timeout.


// ---- maps ---------------------------------------------------------------------

// driving time in seconds from each captain position to the pickup, in the same order
module.exports.getEtas = async (from, to, token) => {
    const response = await axios.post(`${process.env.MAPS_SERVICE_URL}/get-etas`, { from, to }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 6000
    });
    return response.data.durations;
}


// ---- user service -------------------------------------------------------------

// returns the new wallet balance, or null if the wallet did not have enough money
module.exports.chargeWallet = async (userId, amount) => {
    try {
        const response = await axios.post(`${process.env.USER_SERVICE_URL}/internal/charge`,
            { userId, amount }, { headers: { 'x-internal-key': process.env.INTERNAL_KEY }, timeout: 4000 });
        return response.data.wallet;
    } catch (err) {
        if (err.response?.status === 402) return null;
        throw err;
    }
}


// ---- captain service ----------------------------------------------------------

module.exports.addCaptainEarnings = async (captainId, amount) => {
    await axios.post(`${process.env.CAPTAIN_SERVICE_URL}/internal/earnings`,
        { captainId: String(captainId), amount }, { headers: { 'x-internal-key': process.env.INTERNAL_KEY }, timeout: 4000 });
}

module.exports.addCaptainRating = async (captainId, rating) => {
    await axios.post(`${process.env.CAPTAIN_SERVICE_URL}/internal/rating`,
        { captainId: String(captainId), rating }, { headers: { 'x-internal-key': process.env.INTERNAL_KEY }, timeout: 4000 });
}
