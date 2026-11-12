const axios = require('axios');

// Free alternatives to Google Maps:
//  - Nominatim (OpenStreetMap) turns addresses into coordinates
//  - OSRM gives the driving distance and time between two points
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

// Nominatim's usage policy: identify your app and don't hammer it
const headers = { 'User-Agent': 'uber-clone-learning-project/1.0' };

// small in-memory cache so repeated searches don't hit Nominatim again
const cache = new Map();
const CACHE_TIME = 10 * 60 * 1000; // 10 minutes

async function searchPlaces(text, limit) {
    const key = `${text.toLowerCase()}|${limit}`;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.time < CACHE_TIME) {
        return cached.data;
    }

    const params = { q: text, format: 'json', limit };
    if (process.env.SEARCH_COUNTRY) {
        params.countrycodes = process.env.SEARCH_COUNTRY;
    }

    const response = await axios.get(NOMINATIM_URL, { params, headers });

    cache.set(key, { time: Date.now(), data: response.data });
    return response.data;
}

module.exports.getAddressCoordinate = async (address) => {
    try {
        const places = await searchPlaces(address, 1);

        if (!places.length) {
            throw new Error('Unable to fetch coordinates');
        }

        return {
            ltd: Number(places[ 0 ].lat),
            lng: Number(places[ 0 ].lon)
        };
    } catch (error) {
        console.error(error.message);
        throw error;
    }
}

module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    try {
        const from = await module.exports.getAddressCoordinate(origin);
        const to = await module.exports.getAddressCoordinate(destination);

        // OSRM wants longitude first, then latitude
        const url = `${OSRM_URL}/${from.lng},${from.ltd};${to.lng},${to.ltd}`;
        const response = await axios.get(url, { params: { overview: 'false' }, headers });

        if (response.data.code !== 'Ok' || !response.data.routes.length) {
            throw new Error('No routes found');
        }

        const route = response.data.routes[ 0 ];

        // same shape the Google Distance Matrix returned, so the fare code stays simple
        return {
            distance: { value: route.distance },   // meters
            duration: { value: route.duration }    // seconds
        };
    } catch (err) {
        console.error(err.message);
        throw err;
    }
}

module.exports.getAutoCompleteSuggestions = async (input) => {
    if (!input) {
        throw new Error('query is required');
    }

    try {
        const places = await searchPlaces(input, 5);
        return places.map(place => place.display_name).filter(value => value);
    } catch (err) {
        console.error(err.message);
        throw err;
    }
}
