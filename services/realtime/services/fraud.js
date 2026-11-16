// Cheap rule-based GPS sanity check (a real system would add machine learning on top).
// A captain whose position "teleports" faster than any road vehicle is spoofing
// their location (or has a broken phone), so we ignore that ping.

const MAX_SPEED_KMH = 200;

function distanceKm(a, b) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.ltd - a.ltd);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.ltd)) * Math.cos(toRad(b.ltd)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// previous: { ltd, lng, time } or undefined,  next: { ltd, lng, time }
function isImpossibleJump(previous, next) {
    if (!previous) return false;

    const hours = (next.time - previous.time) / 3600000;
    if (hours <= 0) return false;

    // ignore tiny GPS noise: under 100 m is never a jump
    const km = distanceKm(previous, next);
    if (km < 0.1) return false;

    return km / hours > MAX_SPEED_KMH;
}

module.exports = { isImpossibleJump, distanceKm, MAX_SPEED_KMH };
