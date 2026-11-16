// Pure surge maths, no Redis here so it is easy to test.

const MIN_SURGE = 1.0;
const MAX_SURGE = 3.0;

// demand = ride requests seen near here recently
// supply = free captains near here right now
// More requests than captains pushes the price up, capped at 3x.
function surgeMultiplier(demand, supply) {
    const ratio = demand / Math.max(supply, 1);
    const clamped = Math.min(MAX_SURGE, Math.max(MIN_SURGE, ratio));
    return Math.round(clamped * 10) / 10;
}

module.exports = { surgeMultiplier, MIN_SURGE, MAX_SURGE };
