const dotenv = require('dotenv');
dotenv.config();
const http = require('http');
const app = require('./app');
const cells = require('./services/cells');
const { subscribeToQueue, publishToQueue } = require('./services/rabbit');
const port = process.env.PORT || 3006;

const BROADCAST_EVERY = 3000; // ms


// The realtime service reports captain positions on the "supply-events" queue.
// This is the "queue -> counter" step: each message just moves a captain
// between cells, so a burst of pings never touches the database.
function listenToSupplyEvents() {
    subscribeToQueue('supply-events', async (message) => {
        try {
            const { type, captainId, ltd, lng } = JSON.parse(message);

            if (type === 'ping') {
                await cells.setCaptainPosition(captainId, ltd, lng);
            } else if (type === 'remove') {
                await cells.removeCaptain(captainId);
            }
        } catch (err) {
            console.log('Bad supply event', err.message);
        }
    });
}


// Push the whole map to every browser every few seconds, but only when it changed.
// The realtime service forwards this to the "heatmap" socket room.
let lastSent = '';

async function broadcastHeatmap() {
    try {
        const snapshot = await cells.getSnapshot();
        const json = JSON.stringify(snapshot);

        if (json !== lastSent) {
            lastSent = json;
            await publishToQueue('ride-events', JSON.stringify({
                event: 'heatmap-update',
                rooms: [ 'heatmap' ],
                data: { cells: snapshot }
            }));
        }
    } catch (err) {
        console.log('Could not broadcast heatmap:', err.message);
    }
}


http.createServer(app).listen(port, () => {
    console.log(`Heatmap service is running on port ${port}`);
});

listenToSupplyEvents();
setInterval(broadcastHeatmap, BROADCAST_EVERY);
