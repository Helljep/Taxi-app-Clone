const jwt = require('jsonwebtoken');

// Any logged-in user or captain may look at the map.
// The heatmap service has no database, it only checks the token is genuine.
module.exports.authAny = (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ message: 'Unauthorized' });
    }
}

// Only other services (the ride service) know this key, the browser never does.
module.exports.internalOnly = (req, res, next) => {
    if (req.headers[ 'x-internal-key' ] !== process.env.INTERNAL_KEY) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    next();
}
