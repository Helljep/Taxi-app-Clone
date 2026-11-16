const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const { publishToQueue } = require('./services/rabbit');
const state = require('./services/state');
const { isImpossibleJump } = require('./services/gps');

let io;

// A captain's socket stays on one realtime server, so these can live in memory.
// captainId -> time we last saved their position, so we don't write to the DB on every tick
const lastSaved = new Map();
const SAVE_EVERY = 5000; // ms

// captainId -> last accepted position, used to spot GPS spoofing
const lastPosition = new Map();


function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: '*',
            methods: [ 'GET', 'POST' ]
        }
    });

    // With the Redis adapter a message sent to a room reaches sockets connected to
    // ANY realtime server, so this service can run as several copies.
    io.adapter(createAdapter(state.redis.duplicate(), state.redis.duplicate()));

    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        socket.on('join', (data) => joinRoom(socket, data));

        socket.on('update-location-captain', (data) => updateCaptainLocation(socket, data));

        // the captain switched to "offline"
        socket.on('go-offline', () => leaveSupply(socket));

        socket.on('disconnect', () => {
            console.log(`Client disconnected: ${socket.id}`);
            leaveSupply(socket);
        });
    });
}


// Every browser says who it is as soon as it connects. Each person gets their own
// "room", so we can message them by id instead of remembering socket ids.
function joinRoom(socket, data) {
    const { userId, userType, token } = data || {};

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
}


// The captain's phone sends its position here, many times a minute.
async function updateCaptainLocation(socket, data) {
    const { userId, userType } = socket.data;
    const location = data?.location;

    if (userType !== 'captain') {
        return socket.emit('error', { message: 'Join as a captain first' });
    }

    if (!location || !Number.isFinite(location.ltd) || !Number.isFinite(location.lng)) {
        return socket.emit('error', { message: 'Invalid location data' });
    }

    const now = Date.now();
    const position = { ltd: location.ltd, lng: location.lng, time: now };

    if (isImpossibleJump(lastPosition.get(userId), position)) {
        console.log(`Ignoring impossible GPS jump from captain ${userId}`);
        return socket.emit('error', { message: 'Location ignored: impossible movement' });
    }
    lastPosition.set(userId, position);

    // 1. live: if this captain is on a ride, show the movement to that rider right away
    let riderId = null;
    try {
        riderId = await state.getRider(userId);
    } catch (err) {
        console.log('Could not read active ride:', err.message);
    }

    if (riderId) {
        io.to(`user:${riderId}`).emit('captain-location', location);
    }

    // 2. stored: only every few seconds, through the queue
    if (now - (lastSaved.get(userId) || 0) < SAVE_EVERY) return;
    lastSaved.set(userId, now);

    try {
        await publishToQueue('captain-location', JSON.stringify({
            captainId: userId,
            ltd: location.ltd,
            lng: location.lng
        }));

        // 3. heatmap: a captain with a ride is not free, so they leave the count
        await publishToQueue('supply-events', JSON.stringify(
            riderId
                ? { type: 'remove', captainId: userId }
                : { type: 'ping', captainId: userId, ltd: location.ltd, lng: location.lng }
        ));
    } catch (err) {
        console.log('Could not queue location:', err.message);
    }
}


// an offline captain is no longer counted as free
async function leaveSupply(socket) {
    const { userId, userType } = socket.data;
    if (userType !== 'captain') return;

    lastSaved.delete(userId);
    lastPosition.delete(userId);

    try {
        await publishToQueue('supply-events', JSON.stringify({ type: 'remove', captainId: userId }));
    } catch (err) {
        console.log('Could not queue supply event:', err.message);
    }
}


const sendToRooms = (rooms, event, data) => {
    // an empty list would make socket.io send to EVERYONE, so stop here
    if (!io || !rooms || rooms.length === 0) {
        return;
    }
    io.to(rooms).emit(event, data);
}

const trackRide = (captainId, userId) => state.trackRide(captainId, userId);

const stopTrackingRide = (captainId) => state.stopTrackingRide(captainId);


module.exports = { initializeSocket, sendToRooms, trackRide, stopTrackingRide };
