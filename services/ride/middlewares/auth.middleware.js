const jwt = require('jsonwebtoken');
const axios = require('axios');

// The ride service has no user/captain database of its own.
// So it checks the token, then asks the owning service "who is this?"

function getToken(req) {
    return req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];
}


module.exports.authUser = async (req, res, next) => {
    const token = getToken(req);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        const response = await axios.get(`${process.env.USER_SERVICE_URL}/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        req.user = response.data;
        req.token = token;

        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}


module.exports.authCaptain = async (req, res, next) => {
    const token = getToken(req);

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);

        const response = await axios.get(`${process.env.CAPTAIN_SERVICE_URL}/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        req.captain = response.data.captain;
        req.token = token;

        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}
