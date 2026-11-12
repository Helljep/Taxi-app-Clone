const jwt = require('jsonwebtoken');

// the maps service has no database, it only needs to know the token is genuine
module.exports.authUser = (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}
