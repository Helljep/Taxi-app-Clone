const axios = require('axios');

// Takes the fare from the rider's wallet.
// Returns the new balance, or null when the wallet does not have enough money.
module.exports.chargeWallet = async (userId, amount) => {
    try {
        const response = await axios.post(`${process.env.USER_SERVICE_URL}/internal/charge`,
            { userId, amount },
            { headers: { 'x-internal-key': process.env.INTERNAL_KEY }, timeout: 4000 });
        return response.data.wallet;
    } catch (err) {
        if (err.response?.status === 402) return null;
        throw err;
    }
}
