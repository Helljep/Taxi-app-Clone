// Straight-line maths used when we can't (or don't want to) ask a routing server.

const AVG_SPEED_KMH = 25;   // typical city speed
const DETOUR = 1.4;         // roads are longer than a straight line

// Haversine: great-circle distance between two points on the Earth, in km.
function distanceKm(a, b) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.ltd - a.ltd);
    const dLng = toRad(b.lng - a.lng);

    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.ltd)) * Math.cos(toRad(b.ltd)) * Math.sin(dLng / 2) ** 2;

    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// straight-line km -> estimated driving minutes (not rounded, used as a matching cost)
const driveMinutes = (km) => (km * DETOUR / AVG_SPEED_KMH) * 60;

// same shape the maps service returns, so fare code doesn't care where it came from
function estimateRoute(from, to) {
    const meters = distanceKm(from, to) * DETOUR * 1000;
    return {
        distance: { value: Math.round(meters) },
        duration: { value: Math.round(meters / 1000 / AVG_SPEED_KMH * 3600) }
    };
}

module.exports = { distanceKm, driveMinutes, estimateRoute };
