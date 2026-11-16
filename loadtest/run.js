// SURGE TEST. Simulates a "Diwali sale" for rides against the running stack:
//
//   - every driver is a real socket connection sending GPS every 2 s, accepting (or ignoring
//     or declining) offers, then doing the whole trip: OTP, start, finish
//   - riders arrive in three phases: calm -> SPIKE -> calm, using the real API
//   - a rider told "503, busy" waits the Retry-After time (plus jitter) and tries again
//
// At the end it checks the things that must ALWAYS be true:
//   * no ride is lost (every ride ends completed or cancelled)
//   * no driver is given two rides at once
//   * no 5xx errors other than deliberate load shedding
//
//   node run.js
//   SPIKE_RPS=200 SPIKE_S=40 node run.js
//
// Needs accounts.json (node setup.js). Start the stack with docker-compose.loadtest.yml.

const fs = require('fs');
const { io } = require('socket.io-client');

const GATEWAY = process.env.GATEWAY || 'http://localhost:3000';
const SOCKET = process.env.SOCKET || 'http://localhost:3005';
const WARM_S = Number(process.env.WARM_S) || 10;
const SPIKE_S = Number(process.env.SPIKE_S) || 30;
const COOL_S = Number(process.env.COOL_S) || 15;
const BASE_RPS = Number(process.env.BASE_RPS) || 5;
const SPIKE_RPS = Number(process.env.SPIKE_RPS) || 150;
const IGNORE_RATE = Number(process.env.IGNORE_RATE) || 0.08;   // drivers who let the offer time out
const DECLINE_RATE = Number(process.env.DECLINE_RATE) || 0.08; // drivers who press "ignore"
const RIDE_TIMEOUT_MS = 90000;
const CITY = { ltd: 12.9716, lng: 77.5946, spread: 0.03 };      // ~3 km each way

const accounts = JSON.parse(fs.readFileSync(__dirname + '/accounts.json', 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const point = () => ({ ltd: CITY.ltd + rand(-CITY.spread, CITY.spread), lng: CITY.lng + rand(-CITY.spread, CITY.spread) });

// ---------- results ----------
const R = {
    attempts: 0, accepted: 0, shed503: 0, retries: 0, gaveUpClient: 0, serverErrors: 0, gatewayErrors: 0, otherErrors: 0,
    completed: 0, cancelledNoDriver: 0, lost: 0, missedPushes: 0, resynced: 0,
    offersSeen: 0, declined: 0, ignored: 0, confirmed: 0, confirmConflicts: 0,
    doubleBooked: 0, duplicateTerminal: 0,
    apiMs: [], confirmMs: [], totalMs: []
};
const otpOf = new Map();       // rideId -> otp (the rider's screen shows it, the driver types it)
const waiters = new Map();     // rideId -> resolve(outcome)
const outcomeOf = new Map();   // rideId -> 'completed' | 'cancelled'
const confirmedAt = new Map();

async function api(method, path, token, body, extra = {}) {
    let res;
    try {
        res = await fetch(GATEWAY + path, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra },
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (err) {
        return { status: 0, json: null, retryAfter: 0 };                // network error
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json, retryAfter: Number(res.headers.get('retry-after')) || 0 };
}

// A real app retries when the network or a server copy blips. So does the simulator,
// otherwise a restarting service would look like "lost rides" that were never the server's fault.
async function apiRetry(method, path, token, body) {
    let res;
    for (let attempt = 1; attempt <= 12; attempt++) {
        res = await api(method, path, token, body);
        if (![ 0, 502, 503, 504 ].includes(res.status)) return res;
        R.gatewayErrors++;
        await sleep(rand(500, 1500));
    }
    return res;
}

// ---------- drivers ----------
const drivers = accounts.drivers.map(d => ({ ...d, rideId: null, pos: point(), socket: null }));

function startDriver(d) {
    const socket = io(SOCKET, { transports: [ 'websocket' ], reconnection: true });
    d.socket = socket;

    const ping = () => {
        d.pos = { ltd: d.pos.ltd + rand(-0.0004, 0.0004), lng: d.pos.lng + rand(-0.0004, 0.0004) };
        socket.emit('update-location-captain', { location: d.pos });
    };
    socket.on('connect', () => {
        socket.emit('join', { userId: d.id, userType: 'captain', token: d.token });
        ping();
    });
    setInterval(() => socket.connected && ping(), 2000);

    socket.on('new-ride', async (ride) => {
        R.offersSeen++;
        const roll = Math.random();
        if (roll < IGNORE_RATE) { R.ignored++; return; }                 // let it expire
        await sleep(rand(200, 1500));                                    // reading the offer
        if (roll < IGNORE_RATE + DECLINE_RATE) {
            R.declined++;
            return api('POST', '/rides/decline', d.token, { rideId: ride._id });
        }

        const res = await apiRetry('POST', '/rides/confirm', d.token, { rideId: ride._id });
        if (res.status === 409) { R.confirmConflicts++; return; }        // too late or not theirs: expected, harmless
        if (res.status !== 200) { count5xx(res); return; }

        R.confirmed++;
        if (d.rideId) R.doubleBooked++;                                  // INVARIANT: one ride at a time
        d.rideId = ride._id;
        confirmedAt.set(ride._id, Date.now());

        // wait for the rider's screen to show the OTP, drive over, start, drive, finish
        for (let i = 0; i < 40 && !otpOf.has(ride._id); i++) await sleep(100);
        await sleep(rand(1000, 3000));
        await apiRetry('GET', `/rides/start-ride?rideId=${ride._id}&otp=${otpOf.get(ride._id)}`, d.token);
        await sleep(rand(2000, 5000));
        await apiRetry('POST', '/rides/end-ride', d.token, { rideId: ride._id });
        d.rideId = null;
    });
}

// ---------- riders ----------
const idleRiders = accounts.riders.map(r => ({ ...r }));
const riderById = new Map(accounts.riders.map(r => [ r.id, r ]));

function startRiderSocket(r) {
    const socket = io(SOCKET, { transports: [ 'websocket' ], reconnection: true });
    r.socket = socket;
    socket.on('connect', () => socket.emit('join', { userId: r.id, userType: 'user', token: r.token }));
    socket.on('ride-confirmed', (ride) => { otpOf.set(ride._id, ride.otp); });
    const finish = (outcome) => (ride) => {
        if (outcomeOf.has(ride._id)) { R.duplicateTerminal++; return; }
        outcomeOf.set(ride._id, outcome);
        waiters.get(ride._id)?.(outcome);
    };
    socket.on('ride-ended', finish('completed'));
    socket.on('ride-cancelled', finish('cancelled'));
}

function riderBody() {
    return {
        pickup: `Simulated pickup ${Math.random().toString(36).slice(2, 7)}`,
        destination: `Simulated destination ${Math.random().toString(36).slice(2, 7)}`,
        vehicleType: [ 'car', 'car', 'moto', 'auto' ][ Math.floor(Math.random() * 4) ],
        paymentMethod: 'cash',
        pickupCoordinates: point(),
        destinationCoordinates: point()
    };
}

function count5xx(res) {
    if (res.status === 502 || res.status === 504) R.gatewayErrors++;   // a service copy was down for a moment
    else if (res.status === 503) R.shed503++;
    else if (res.status >= 500) { R.serverErrors++; console.log('5xx:', res.status, JSON.stringify(res.json)); }
    else R.otherErrors++;
}

async function rideOnce(rider) {
    R.attempts++;
    const body = riderBody();
    const key = `${rider.id}-${Date.now()}-${Math.random()}`;      // same key on every retry of this request
    const t0 = Date.now();
    let ride = null;

    for (let attempt = 1; attempt <= 8 && !ride; attempt++) {
        const t = Date.now();
        const res = await api('POST', '/rides/create', rider.token, body, { 'Idempotency-Key': key });
        R.apiMs.push(Date.now() - t);

        if (res.status === 201 || res.status === 200) { ride = res.json; R.accepted++; break; }

        if (res.status === 503 || res.status === 429) {
            R.shed503++; R.retries++;
            await sleep(res.retryAfter * 1000 * rand(0.5, 1.5));    // wait what the server asked, with jitter
            continue;
        }
        if (res.status === 0 || res.status === 502 || res.status === 504) {  // a copy of the service is restarting: retry with the SAME key
            R.gatewayErrors++; R.retries++;
            await sleep(rand(500, 1500));
            continue;
        }
        count5xx(res);
        break;
    }
    if (!ride) { R.gaveUpClient++; return; }

    const outcome = outcomeOf.get(ride._id) || await Promise.race([
        new Promise(resolve => waiters.set(ride._id, resolve)),
        sleep(RIDE_TIMEOUT_MS).then(() => 'lost')
    ]);

    // No push message arrived. A real app re-reads its state from the server (on reconnect or
    // pull-to-refresh), so the simulator does too, and only calls a ride lost if the SERVER has no ending for it.
    let final = outcome;
    if (final === 'lost') {
        R.missedPushes++;
        const history = await apiRetry('GET', '/rides/history', rider.token);
        const found = (history.json || []).find(r => r._id === ride._id);
        if (found && (found.status === 'completed' || found.status === 'cancelled')) { final = found.status; R.resynced++; }
    }

    if (final === 'completed') { R.completed++; R.totalMs.push(Date.now() - t0); }
    else if (final === 'cancelled') R.cancelledNoDriver++;
    else R.lost++;                                                   // INVARIANT BROKEN: no ending at all

    if (confirmedAt.has(ride._id)) R.confirmMs.push(confirmedAt.get(ride._id) - t0);
}

async function launch() {
    const rider = idleRiders.pop();
    if (!rider) return false;                                       // every rider already has an open ride
    rideOnce(rider).finally(() => idleRiders.push(rider));
    return true;
}

// Poisson arrivals: gaps between requests are random, the average gives the rate
async function arrivals(rps, seconds, label) {
    console.log(`\n== ${label}: ${rps} requests/s for ${seconds}s ==`);
    const end = Date.now() + seconds * 1000;
    let skipped = 0;
    while (Date.now() < end) {
        await sleep(-Math.log(1 - Math.random()) / rps * 1000);
        if (!await launch()) skipped++;
    }
    if (skipped) console.log(`   (${skipped} arrivals skipped: all ${accounts.riders.length} riders already had a ride open)`);
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [ ...arr ].sort((a, b) => a - b); return s[ Math.min(s.length - 1, Math.floor(s.length * p)) ]; };

async function engineStats() {
    try { return await (await fetch(GATEWAY + '/rides/engine/stats')).json(); } catch (e) { return null; }
}

(async () => {
    console.log(`Drivers: ${drivers.length}, riders: ${accounts.riders.length}`);
    try { await fetch(GATEWAY + '/rides/engine/stats/reset', { method: 'POST', headers: { 'x-internal-key': process.env.INTERNAL_KEY || 'change-this-internal-key' } }); } catch (e) { /* optional */ }

    drivers.forEach(startDriver);
    accounts.riders.forEach(startRiderSocket);
    console.log('Waiting for drivers to appear on the map...');
    await sleep(6000);

    const started = Date.now();
    let peakQueue = 0;
    const watcher = setInterval(async () => {
        const s = await engineStats();
        if (s) peakQueue = Math.max(peakQueue, s.queueDepth);
    }, 500);

    await arrivals(BASE_RPS, WARM_S, 'calm');
    await arrivals(SPIKE_RPS, SPIKE_S, 'SPIKE');
    await arrivals(BASE_RPS, COOL_S, 'calm again');

    console.log('\nWaiting for every ride to finish...');
    const deadline = Date.now() + RIDE_TIMEOUT_MS + 5000;
    while (idleRiders.length < accounts.riders.length && Date.now() < deadline) await sleep(500);
    clearInterval(watcher);

    const server = await engineStats();
    const seconds = (Date.now() - started) / 1000;
    const finished = R.completed + R.cancelledNoDriver;

    const report = {
        durationSeconds: Math.round(seconds),
        drivers: drivers.length, riders: accounts.riders.length,
        load: { baseRps: BASE_RPS, spikeRps: SPIKE_RPS, spikeSeconds: SPIKE_S },
        requests: { rideRequests: R.attempts, acceptedByApi: R.accepted, turnedAway503: R.shed503, gatewayErrors502: R.gatewayErrors, clientRetries: R.retries, gaveUpAfterRetries: R.gaveUpClient },
        outcome: { completed: R.completed, cancelledNoDriver: R.cancelledNoDriver, lost: R.lost, pushMessagesMissed: R.missedPushes, recoveredByResync: R.resynced },
        drivers_: { offersSeen: R.offersSeen, confirmed: R.confirmed, declined: R.declined, ignored: R.ignored, tooLateConflicts: R.confirmConflicts },
        latencyMs: {
            createApi: { p50: pct(R.apiMs, 0.5), p95: pct(R.apiMs, 0.95), p99: pct(R.apiMs, 0.99) },
            requestToDriverAccepted: { p50: pct(R.confirmMs, 0.5), p95: pct(R.confirmMs, 0.95) },
            requestToTripComplete: { p50: pct(R.totalMs, 0.5), p95: pct(R.totalMs, 0.95) }
        },
        queue: { peakDepth: peakQueue, endDepth: server?.queueDepth, serverCounters: server?.counters },
        invariants: {
            noRideLost: R.lost === 0,
            noDriverDoubleBooked: R.doubleBooked === 0,
            noDuplicateOutcomes: R.duplicateTerminal === 0,
            noUnexpected5xx: R.serverErrors === 0
        }
    };

    fs.mkdirSync(__dirname + '/results', { recursive: true });
    const file = `${__dirname}/results/surge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    console.log('\n================ RESULT ================');
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nSaved to ${file}`);
    console.log(Object.values(report.invariants).every(Boolean) ? '\nALL INVARIANTS HELD' : '\n!! AN INVARIANT FAILED, see above');
    process.exit(0);
})();
