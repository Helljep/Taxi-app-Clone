const dotenv = require('dotenv');
dotenv.config();
const http = require('http');
const { initializeSocket } = require('./socket');
const listenToRideEvents = require('./services/rideEvents');
const port = process.env.PORT || 3005;

const server = http.createServer((req, res) => {
    res.end('Realtime service is up');
});

initializeSocket(server);
listenToRideEvents();

server.listen(port, () => {
    console.log(`Realtime service is running on port ${port}`);
});
