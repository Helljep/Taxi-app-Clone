const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { publishToQueue } = require('./services/rabbit');

let io;

// captainId -> userId, for rides that are in progress.
// This is how we know which user should see which captain moving on the map.
const activeRides = new Map();

// captainId -> time we last saved their position, so we don't write to the DB on every tick
const lastSaved = new Map();
const SAVE_EVERY = 5000; // ms


function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: '*',
            methods: [ 'GET', 'POST' ]
        }
    });

    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);


        // every browser says who it is as soon as it connects.
        // each person gets their own "room", so we can message them by id
        // instead of remembering socket ids in the database.
        socket.on('join', (data) => {
            const { userId, userType, token } = data;

            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);

                if (decoded._id !== userId) {
                    return socket.emit('error', { message: 'Token does not match user' });
                }
            } catch (err) {
                return socket.emit('error', { message: 'Invalid token' });
            }

            if (userType !== 'user' && userType !== 'captain') {
                return socket.emit('error', { message: 'Invalid user type' });
            }

            socket.data.userId = userId;
            socket.data.userType = userType;
            socket.join(`${userType}:${userId}`);

            // everyone who is logged in can watch the live driver heatmap
            socket.join('heatmap');
        });


        // the captain's phone sends its position here, many times a minute
        socket.on('update-location-captain', async (data) => {
            const { userId, userType } = socket.data;
            const { location } = data;

            if (userType !== 'captain') {
                return socket.emit('error', { message: 'Join as a captain first' });
            }

            if (!location || !location.ltd || !location.lng) {
                return socket.emit('error', { message: 'Invalid location data' });
            }

            // 1. live: if this captain is on a ride, show the movement to that user right away
            const riderId = activeRides.get(userId);
            if (riderId) {
                io.to(`user:${riderId}`).emit('captain-location', location);
            }

            // 2. stored: save to the DB, but only every few seconds, through the queue
            const now = Date.now();
            if (now - (lastSaved.get(userId) || 0) >= SAVE_EVERY) {
                lastSaved.set(userId, now);
                try {
                    await publishToQueue('captain-location', JSON.stringify({
                        captainId: userId,
                        ltd: location.ltd,
                        lng: location.lng
                    }));
                } catch (err) {
                    console.log('Could not queue location', err.message);
                }

                // 3. supply: tell the heatmap service this captain is free in this spot.
                // A captain who is busy with a ride is not available supply, so remove them.
                try {
                    await publishToQueue('supply-events', JSON.stringify(
                        riderId
                            ? { type: 'remove', captainId: userId }
                            : { type: 'ping', captainId: userId, ltd: location.ltd, lng: location.lng }
                    ));
                } catch (err) {
                    console.log('Could not queue supply event', err.message);
                }
            }
        });

        socket.on('disconnect', async () => {
            console.log(`Client disconnected: ${socket.id}`);

            // an offline captain is no longer supply
            const { userId, userType } = socket.data;
            if (userType === 'captain') {
                lastSaved.delete(userId);
                try {
                    await publishToQueue('supply-events', JSON.stringify({ type: 'remove', captainId: userId }));
                } catch (err) {
                    console.log('Could not queue supply event', err.message);
                }
            }
        });
    });
}


const sendToRooms = (rooms, event, data) => {
    // an empty list would make socket.io send to EVERYONE, so stop here
    if (!io || !rooms || rooms.length === 0) {
        return;
    }
    io.to(rooms).emit(event, data);
}

const trackRide = (captainId, userId) => activeRides.set(String(captainId), String(userId));

const stopTrackingRide = (captainId) => activeRides.delete(String(captainId));


module.exports = { initializeSocket, sendToRooms, trackRide, stopTrackingRide };
