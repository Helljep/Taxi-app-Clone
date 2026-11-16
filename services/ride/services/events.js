const { publishToQueue } = require('./rabbit');

// Instead of talking to sockets directly, the ride service drops a message
// on the "ride-events" queue. The realtime service picks it up and
// pushes it to the right browsers.
module.exports.publishEvent = (event, rooms, data) => {
    return publishToQueue('ride-events', JSON.stringify({ event, rooms, data }));
}
