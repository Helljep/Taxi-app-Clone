const cellService = require('../services/cell.service');

const isCoordinate = (ltd, lng) =>
    Number.isFinite(ltd) && Number.isFinite(lng) && Math.abs(ltd) <= 90 && Math.abs(lng) <= 180;


module.exports.getHeatmap = async (req, res) => {
    try {
        res.status(200).json({ cells: await cellService.getSnapshot() });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

// the ride service asks: how busy is it around this pickup?
module.exports.getSurge = async (req, res) => {
    const ltd = Number(req.query.ltd);
    const lng = Number(req.query.lng);

    if (!isCoordinate(ltd, lng)) {
        return res.status(400).json({ message: 'ltd and lng are required' });
    }

    try {
        res.status(200).json(await cellService.getSurgeAt(ltd, lng));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

// the ride service reports: someone just asked for a ride here
module.exports.addDemand = async (req, res) => {
    const ltd = Number(req.body.ltd);
    const lng = Number(req.body.lng);
    const { rideId } = req.body;

    if (!isCoordinate(ltd, lng) || !rideId) {
        return res.status(400).json({ message: 'ltd, lng and rideId are required' });
    }

    try {
        await cellService.addDemand(ltd, lng, rideId);
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}
