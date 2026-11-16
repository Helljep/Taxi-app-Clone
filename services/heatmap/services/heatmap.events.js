const { subscribeToQueue, publishToQueue } = require('./rabbit');
const cellService = require('./cell.service');

const BROADCAST_EVERY = 3000; // ms


// The realtime service reports captain positions on the "supply-events" queue.
// Each message only moves a captain between cells, so a burst of pings never
// touches the database.
function listenToSupplyEvents() {
    subscribeToQueue('supply-events', async (message) => {
        const { type, captainId, ltd, lng } = JSON.parse(message);

        if (type === 'ping') {
            await cellService.setCaptainPosition(captainId, ltd, lng);
        } else if (type === 'remove') {
            await cellService.removeCaptain(captainId);
        }
    });
}


// Every few seconds the whole map is pushed to the browsers (through the realtime
// service), but only when it changed since the last push.
function broadcastHeatmap() {
    let lastSent = '';

    setInterval(async () => {
        try {
            const cells = await cellService.getSnapshot();
            const json = JSON.stringify(cells);

            if (json === lastSent) return;
            lastSent = json;

            await publishToQueue('ride-events', JSON.stringify({
                event: 'heatmap-update',
                rooms: [ 'heatmap' ],
                data: { cells }
            }));
        } catch (err) {
            console.log('Could not broadcast heatmap:', err.message);
        }
    }, BROADCAST_EVERY);
}


module.exports = { listenToSupplyEvents, broadcastHeatmap };
