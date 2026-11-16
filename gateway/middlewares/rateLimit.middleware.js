const rateLimit = require('express-rate-limit');

// Protects the services from one noisy client or a brute-force login attempt.
// The counts live in this gateway's memory.
const limit = (perMinute, message) => rateLimit({
    windowMs: 60 * 1000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message }
});

module.exports.general = limit(
    Number(process.env.RATE_LIMIT_PER_MIN) || 600,
    'Too many requests, slow down'
);

module.exports.login = limit(
    Number(process.env.AUTH_RATE_LIMIT_PER_MIN) || 20,
    'Too many login attempts, try again in a minute'
);

module.exports.createRide = limit(
    Number(process.env.RIDE_RATE_LIMIT_PER_MIN) || 15,
    'Too many ride requests, try again in a minute'
);
