// A mistake by the caller (wrong OTP, ride already taken...). The controllers turn
// it into a 4xx answer instead of a 500, which is reserved for real server faults.
class RideError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

module.exports = { RideError };
