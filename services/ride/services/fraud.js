// Simple abuse rules (a real system adds machine learning and device checks on top).

const CANCEL_WINDOW_MS = 30 * 60 * 1000; // look at the last 30 minutes
const MAX_CANCELS = 3;

// true when a rider cancelled too many rides recently
function isCancellationAbuse(recentCancels) {
    return recentCancels >= MAX_CANCELS;
}

module.exports = { isCancellationAbuse, CANCEL_WINDOW_MS, MAX_CANCELS };
