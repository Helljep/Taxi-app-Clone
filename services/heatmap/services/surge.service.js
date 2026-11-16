const MIN_SURGE = 1;
const MAX_SURGE = 3;

// More ride requests than free captains pushes the price up, never below 1x or above 3x.
module.exports.surgeMultiplier = (demand, supply) => {
    const ratio = demand / Math.max(supply, 1);
    const clamped = Math.min(MAX_SURGE, Math.max(MIN_SURGE, ratio));
    return Math.round(clamped * 10) / 10;
}
