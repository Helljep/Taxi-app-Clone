// Load test: many captains stream GPS pings while many riders watch the live heatmap.
//
//   cd loadtest && npm install
//   node loadtest.js --captains 300 --riders 50 --seconds 60
//
// What it measures
//   - how many location pings per second the system takes in (captains -> realtime -> queue -> Redis)
//   - how fast GET /heatmap answers while that is going on (average and 95th percentile)
//   - how many live "heatmap-update" pushes the riders receive
//   - errors (failed requests, rate limits, socket errors)
//
// It does NOT create rides: that path calls the free Nominatim/OSRM map services, whose
// usage policy forbids load testing. Self-host them if you want to test that part too.
//
// The gateway rate-limits by IP, and this test comes from ONE IP, so start the stack with
// the limits lifted, for example:
//   RATE_LIMIT_PER_MIN=10000000 AUTH_RATE_LIMIT_PER_MIN=10000000 docker compose up --build

const axios = require('axios');
const { io } = require('socket.io-client');

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([ arg.slice(2), all[ i + 1 ] ]);
    return pairs;
}, []));

const CAPTAINS = Number(args.captains) || 100;
const RIDERS = Number(args.riders) || 20;
const SECONDS = Number(args.seconds) || 30;
const BASE_URL = args.api || 'http://localhost:3000';
const SOCKET_URL = args.socket || 'http://localhost:3005';
const PING_EVERY = 2000; // ms, same as the real app

const run = Date.now().toString(36);
const stats = { pings: 0, heatmapPushes: 0, errors: 0, socketErrors: 0, heatmapLatencies: [] };
const sockets = [];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// run an async function over a list with limited parallelism (registration hashes passwords, so it is slow)
async function inBatches(items, size, fn) {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(fn));
    }
}

const percentile = (values, p) => {
    if (values.length === 0) return 0;
    const sorted = [ ...values ].sort((a, b) => a - b);
    return sorted[ Math.min(sorted.length - 1, Math.floor(sorted.length * p)) ];
};


async function registerCaptain(i) {
    const types = [ 'car', 'moto', 'auto' ];
    const response = await axios.post(`${BASE_URL}/captains/register`, {
        fullname: { firstname: `Load${i}`, lastname: 'Captain' },
        email: `load-captain-${run}-${i}@test.local`,
        password: 'password123',
        vehicle: { color: 'blue', plate: `LT${i}`, capacity: 4, vehicleType: types[ i % 3 ] }
    });
    return { id: response.data.captain._id, token: response.data.token };
}

async function registerRider(i) {
    const response = await axios.post(`${BASE_URL}/users/register`, {
        fullname: { firstname: `Load${i}`, lastname: 'Rider' },
        email: `load-rider-${run}-${i}@test.local`,
        password: 'password123'
    });
    return { id: response.data.user._id, token: response.data.token };
}


function startCaptain(captain, i) {
    // spread captains over a few km around central Bangalore
    let ltd = 12.9716 + (Math.random() - 0.5) * 0.06;
    let lng = 77.5946 + (Math.random() - 0.5) * 0.06;

    const socket = io(SOCKET_URL, { transports: [ 'websocket' ] });
    sockets.push(socket);

    socket.on('connect', () => {
        socket.emit('join', { userId: captain.id, userType: 'captain', token: captain.token });
    });
    socket.on('error', () => stats.socketErrors++);
    socket.on('connect_error', () => stats.socketErrors++);

    const timer = setInterval(() => {
        // drift by at most ~15 m per tick, which is a believable city speed
        ltd += (Math.random() - 0.5) * 0.00027;
        lng += (Math.random() - 0.5) * 0.00027;
        socket.emit('update-location-captain', { userId: captain.id, location: { ltd, lng } });
        stats.pings++;
    }, PING_EVERY + (i % 10) * 50); // slightly staggered so pings are not one big burst

    return () => clearInterval(timer);
}

function startRider(rider) {
    const socket = io(SOCKET_URL, { transports: [ 'websocket' ] });
    sockets.push(socket);

    socket.on('connect', () => {
        socket.emit('join', { userId: rider.id, userType: 'user', token: rider.token });
    });
    socket.on('heatmap-update', () => stats.heatmapPushes++);
    socket.on('connect_error', () => stats.socketErrors++);

    // also poll the HTTP endpoint, like a rider opening the app
    const timer = setInterval(async () => {
        const started = Date.now();
        try {
            await axios.get(`${BASE_URL}/heatmap`, { headers: { Authorization: `Bearer ${rider.token}` } });
            stats.heatmapLatencies.push(Date.now() - started);
        } catch (err) {
            stats.errors++;
        }
    }, 1000);

    return () => clearInterval(timer);
}


async function main() {
    console.log(`Load test: ${CAPTAINS} captains, ${RIDERS} riders, ${SECONDS}s against ${BASE_URL} / ${SOCKET_URL}`);

    console.log('Registering test accounts (this can take a while)...');
    const captains = [], riders = [];
    await inBatches([ ...Array(CAPTAINS).keys() ], 10, async (i) => captains.push(await registerCaptain(i)));
    await inBatches([ ...Array(RIDERS).keys() ], 10, async (i) => riders.push(await registerRider(i)));

    console.log('Starting traffic...');
    const stops = [
        ...captains.map(startCaptain),
        ...riders.map(startRider)
    ];

    const started = Date.now();
    for (let t = 5; t <= SECONDS; t += 5) {
        await sleep(5000);
        const elapsed = (Date.now() - started) / 1000;
        console.log(`  ${Math.round(elapsed)}s: ${Math.round(stats.pings / elapsed)} pings/s, ` +
            `${stats.heatmapPushes} heatmap pushes, ${stats.errors} http errors, ${stats.socketErrors} socket errors`);
    }

    stops.forEach(stop => stop());
    sockets.forEach(socket => socket.close());

    const elapsed = (Date.now() - started) / 1000;
    const average = stats.heatmapLatencies.reduce((a, b) => a + b, 0) / (stats.heatmapLatencies.length || 1);

    console.log('\n---- result ----');
    console.log(`location pings sent : ${stats.pings} (${(stats.pings / elapsed).toFixed(1)}/s)`);
    console.log(`GET /heatmap        : ${stats.heatmapLatencies.length} ok, ${stats.errors} failed`);
    console.log(`  latency           : avg ${average.toFixed(0)} ms, p95 ${percentile(stats.heatmapLatencies, 0.95)} ms`);
    console.log(`live heatmap pushes : ${stats.heatmapPushes} received by ${RIDERS} riders`);
    console.log(`socket errors       : ${stats.socketErrors}`);
    console.log('\nNow check http://localhost:3000/metrics and the RabbitMQ dashboard (http://localhost:15672)');
    console.log('for queue depth: a queue that keeps growing means a consumer cannot keep up.');
    process.exit(0);
}

main().catch(err => {
    console.error('Load test failed:', err.response?.data || err.message);
    process.exit(1);
});
