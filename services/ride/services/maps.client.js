const axios = require('axios');

// small helper so the ride service can talk to the maps service.
// The user's own token is forwarded because the maps service checks it too.

module.exports.getDistanceTime = async (origin, destination, token) => {
    const response = await axios.get(`${process.env.MAPS_SERVICE_URL}/get-distance-time`, {
        params: { origin, destination },
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

module.exports.getAddressCoordinate = async (address, token) => {
    const response = await axios.get(`${process.env.MAPS_SERVICE_URL}/get-coordinates`, {
        params: { address },
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}
