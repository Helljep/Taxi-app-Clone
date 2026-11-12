const { subscribeToQueue } = require('./rabbit');
const { sendToRooms, trackRide, stopTrackingRide } = require('../socket');

// Listens to the "ride-events" queue (filled by the ride service)
// and forwards each message to the right people over Socket.io.

function listenToRideEvents() {
    subscribeToQueue('ride-events', (message) => {
        try {
            const { event, rooms, data } = JSON.parse(message);

            // when a captain takes a ride we start streaming their location to that user
            if (event === 'ride-confirmed' || event === 'ride-started') {
                trackRide(data.captain._id, data.user._id);
            }

            if (event === 'ride-ended') {
                stopTrackingRide(data.captain._id);
            }

            sendToRooms(rooms, event, data);
        } catch (err) {
            console.log('Bad ride event', err.message);
        }
    });
}

module.exports = listenToRideEvents;
