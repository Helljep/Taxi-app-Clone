const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const mapController = require('../controllers/map.controller');
const { query } = require('express-validator');

router.get('/get-coordinates',
    authMiddleware.authUser,
    query('address').isString().isLength({ min: 3 }),
    mapController.getCoordinates
);

router.get('/get-distance-time',
    authMiddleware.authUser,
    query('origin').isString().isLength({ min: 3 }),
    query('destination').isString().isLength({ min: 3 }),
    mapController.getDistanceTime
)

router.get('/get-route',
    authMiddleware.authUser,
    query('origin').isString().isLength({ min: 3 }),
    query('destination').isString().isLength({ min: 3 }),
    mapController.getRoute
)

// driving time from many points to one point (used by dispatch and the "X mins away" labels)
router.post('/get-etas',
    authMiddleware.authUser,
    mapController.getEtas
)

router.get('/get-suggestions',
    authMiddleware.authUser,
    query('input').isString().isLength({ min: 3 }),
    mapController.getAutoCompleteSuggestions
)



module.exports = router;
