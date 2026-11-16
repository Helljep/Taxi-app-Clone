const axios = require('axios');

// Free alternatives to Google Maps:
//  - Nominatim (OpenStreetMap) turns addresses into coordinates
//  - OSRM gives the driving distance and time between two points
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const OSRM_TABLE_URL = 'https://router.project-osrm.org/table/v1/driving';

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

// The drawn route between two addresses: a list of [lat, lng] points for the map.
module.exports.getRoute = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const from = await module.exports.getAddressCoordinate(origin);
    const to = await module.exports.getAddressCoordinate(destination);

    const url = `${OSRM_URL}/${from.lng},${from.ltd};${to.lng},${to.ltd}`;
    const response = await axios.get(url, {
        params: { overview: 'full', geometries: 'geojson' },
        headers
    });

    if (response.data.code !== 'Ok' || !response.data.routes.length) {
        throw new Error('No routes found');
    }

    const route = response.data.routes[ 0 ];

    return {
        // GeoJSON is [lng, lat], Leaflet wants [lat, lng]
        coordinates: route.geometry.coordinates.map(([ lng, ltd ]) => [ ltd, lng ]),
        distance: route.distance,
        duration: route.duration
    };
}


function straightLineKm(a, b) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.ltd - a.ltd);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.ltd)) * Math.cos(toRad(b.ltd)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Driving time in seconds from each point in `from` to the point `to`.
// One OSRM "table" request answers all of them. If OSRM is unreachable we fall back
// to straight-line distance at 30 km/h, so dispatch keeps working (with rougher ETAs).
module.exports.getEtas = async (from, to) => {
    if (!Array.isArray(from) || from.length === 0 || !to) {
        throw new Error('from (a list of points) and to are required');
    }

    try {
        const points = [ ...from, to ].map(p => `${p.lng},${p.ltd}`).join(';');
        const response = await axios.get(`${OSRM_TABLE_URL}/${points}`, {
            params: {
                sources: from.map((_, i) => i).join(';'),
                destinations: String(from.length),
                annotations: 'duration'
            },
            headers,
            timeout: 4000
        });

        if (response.data.code !== 'Ok') {
            throw new Error('OSRM table failed');
        }

        return { durations: response.data.durations.map(row => row[ 0 ]), estimated: false };
    } catch (err) {
        console.log('ETA lookup failed, using straight-line estimate:', err.message);
        return {
            durations: from.map(p => Math.round(straightLineKm(p, to) / 30 * 3600)),
            estimated: true
        };
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
