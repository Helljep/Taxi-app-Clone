const { publishToQueue } = require('./rabbit');

// The ride service never talks to sockets directly. It drops a message on the
// "ride-events" queue and the realtime service pushes it to the right browsers.
module.exports.publishEvent = (event, rooms, data) => {
    return publishToQueue('ride-events', JSON.stringify({ event, rooms, data }));
}
