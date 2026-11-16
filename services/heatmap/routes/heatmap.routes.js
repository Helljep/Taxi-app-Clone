const express = require('express');
const router = express.Router();
const heatmapController = require('../controllers/heatmap.controller');
const authMiddleware = require('../middlewares/auth.middleware');


router.get('/', authMiddleware.authAny, heatmapController.getHeatmap)

router.get('/surge', authMiddleware.internalOnly, heatmapController.getSurge)

router.post('/demand', authMiddleware.internalOnly, heatmapController.addDemand)
router.post('/demand/remove', authMiddleware.internalOnly, heatmapController.removeDemand)


module.exports = router;
