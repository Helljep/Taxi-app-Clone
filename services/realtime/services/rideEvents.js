const { subscribeToQueue } = require('./rabbit');
const { sendToRooms, trackRide, stopTrackingRide } = require('../socket');

// Listens to the "ride-events" queue (filled by the ride and heatmap services)
// and forwards each message to the right people over Socket.io.
// If this handler throws (for example Redis is briefly down) the queue helper
// retries the message and finally parks it in "ride-events.dead".

function listenToRideEvents() {
    subscribeToQueue('ride-events', async (message) => {
        let parsed;
        try {
            parsed = JSON.parse(message);
        } catch (err) {
            // retrying a message that is not even JSON would never help
            console.log('Bad ride event', err.message);
            return;
        }

        const { event, rooms, data } = parsed;

        // when a captain takes a ride we start streaming their location to that user
        if (event === 'ride-confirmed' || event === 'ride-started') {
            await trackRide(data.captain._id, data.user._id);
        }

        if (event === 'ride-ended' || event === 'ride-cancelled') {
            if (data.captain?._id) {
                await stopTrackingRide(data.captain._id);
            }
        }

        sendToRooms(rooms, event, data);
    });
}

module.exports = listenToRideEvents;
