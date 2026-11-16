// A captain whose position "teleports" faster than any road vehicle is spoofing
// their location (or has a broken phone), so that ping is ignored.

const MAX_SPEED_KMH = 200;
const MIN_JUMP_KM = 0.1; // smaller moves are normal GPS noise


function distanceKm(a, b) {
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(b.ltd - a.ltd);
    const dLng = toRad(b.lng - a.lng);

    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.ltd)) * Math.cos(toRad(b.ltd)) * Math.sin(dLng / 2) ** 2;

    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// previous and next are { ltd, lng, time }, previous is undefined for the first ping
module.exports.isImpossibleJump = (previous, next) => {
    if (!previous) return false;

    const hours = (next.time - previous.time) / 3600000;
    if (hours <= 0) return false;

    const km = distanceKm(previous, next);
    if (km < MIN_JUMP_KM) return false;

    return km / hours > MAX_SPEED_KMH;
}
