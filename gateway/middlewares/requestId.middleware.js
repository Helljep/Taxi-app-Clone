const crypto = require('crypto');

// Every request gets an id that is passed on to the service behind the gateway,
// so one user action can be followed through the logs of several services.
module.exports = (req, res, next) => {
    req.id = req.headers[ 'x-request-id' ] || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
}
