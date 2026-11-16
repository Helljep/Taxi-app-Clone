const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const rideController = require('../controllers/ride.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const admission = require('../services/admission');


router.post('/create',
    admission.guard,           // shed load first, before any work is done
    authMiddleware.authUser,
    body('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    body('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    body('vehicleType').isString().isIn([ 'auto', 'car', 'moto' ]).withMessage('Invalid vehicle type'),
    body('pickupCoordinates.ltd').optional().isFloat({ min: -90, max: 90 }),
    body('pickupCoordinates.lng').optional().isFloat({ min: -180, max: 180 }),
    body('destinationCoordinates.ltd').optional().isFloat({ min: -90, max: 90 }),
    body('destinationCoordinates.lng').optional().isFloat({ min: -180, max: 180 }),
    body('paymentMethod').optional().isIn([ 'cash', 'wallet' ]).withMessage('Invalid payment method'),
    rideController.createRide
)

router.get('/engine/stats', rideController.engineStats)
router.post('/engine/stats/reset', (req, res, next) => req.get('x-internal-key') === process.env.INTERNAL_KEY ? next() : res.status(403).end(), rideController.resetStats)

router.get('/get-fare',
    authMiddleware.authUser,
    query('pickup').isString().isLength({ min: 3 }).withMessage('Invalid pickup address'),
    query('destination').isString().isLength({ min: 3 }).withMessage('Invalid destination address'),
    rideController.getFare
)

router.post('/confirm',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.confirmRide
)

router.post('/decline',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.declineRide
)

router.get('/start-ride',
    authMiddleware.authCaptain,
    query('rideId').isMongoId().withMessage('Invalid ride id'),
    query('otp').isString().isLength({ min: 6, max: 6 }).withMessage('Invalid OTP'),
    rideController.startRide
)

router.post('/end-ride',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.endRide
)

router.post('/cancel',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.cancelRide
)

router.post('/cancel-by-captain',
    authMiddleware.authCaptain,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    rideController.cancelRideByCaptain
)

router.get('/history', authMiddleware.authUser, rideController.getUserHistory)

router.get('/captain-history', authMiddleware.authCaptain, rideController.getCaptainHistory)

router.post('/rate',
    authMiddleware.authUser,
    body('rideId').isMongoId().withMessage('Invalid ride id'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1 to 5').toInt(),
    body('comment').optional().isString().isLength({ max: 300 }),
    rideController.rateRide
)


module.exports = router;
