const { subscribeToQueue } = require('./rabbit');
const { sendToRooms, trackRide, stopTrackingRide } = require('../socket');

// Listens to the "ride-events" queue (filled by the ride and heatmap services)
// and forwards each message to the right people over Socket.io.

function listenToRideEvents() {
    subscribeToQueue('ride-events', async (message) => {
        const { event, rooms, data } = JSON.parse(message);

        // once a captain takes a ride, their location is streamed to that rider
        if (event === 'ride-confirmed' || event === 'ride-started') {
            await trackRide(data.captain._id, data.user._id);
        }

        if ((event === 'ride-ended' || event === 'ride-cancelled') && data.captain?._id) {
            await stopTrackingRide(data.captain._id);
        }

        sendToRooms(rooms, event, data);
    });
}

module.exports = listenToRideEvents;
