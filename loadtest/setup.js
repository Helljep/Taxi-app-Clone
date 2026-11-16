// Creates the fake accounts the surge test needs (drivers and riders), through the real
// sign-up API, and saves their tokens in accounts.json. Run once; the test reuses them.
//
//   node setup.js                       (200 drivers, 600 riders)
//   DRIVERS=500 RIDERS=2000 node setup.js

const fs = require('fs');

const GATEWAY = process.env.GATEWAY || 'http://localhost:3000';
const DRIVERS = Number(process.env.DRIVERS) || 200;
const RIDERS = Number(process.env.RIDERS) || 600;
const CONCURRENCY = 20;
const RUN = Date.now().toString(36);
const TYPES = [ 'car', 'car', 'moto', 'auto' ]; // a realistic mix, cars most common

async function post(path, body) {
    const res = await fetch(GATEWAY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
    return res.json();
}

async function pool(count, worker) {
    let next = 0, done = 0;
    const results = new Array(count);
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (next < count) {
            const i = next++;
            results[ i ] = await worker(i);
            if (++done % 50 === 0) process.stdout.write(`\r  ${done}/${count}`);
        }
    }));
    process.stdout.write(`\r  ${count}/${count}\n`);
    return results;
}

(async () => {
    console.log(`Creating ${DRIVERS} drivers...`);
    const drivers = await pool(DRIVERS, async (i) => {
        const vehicleType = TYPES[ i % TYPES.length ];
        const r = await post('/captains/register', {
            fullname: { firstname: `Driver${i}`, lastname: 'Sim' },
            email: `sim-driver-${RUN}-${i}@loadtest.dev`,
            password: 'loadtest1',
            vehicle: { color: 'white', plate: `SIM${i}`, capacity: 4, vehicleType }
        });
        return { id: r.captain._id, token: r.token, vehicleType };
    });

    console.log(`Creating ${RIDERS} riders...`);
    const riders = await pool(RIDERS, async (i) => {
        const r = await post('/users/register', {
            fullname: { firstname: `Rider${i}`, lastname: 'Sim' },
            email: `sim-rider-${RUN}-${i}@loadtest.dev`,
            password: 'loadtest1'
        });
        return { id: r.user._id, token: r.token };
    });

    fs.writeFileSync(__dirname + '/accounts.json', JSON.stringify({ drivers, riders }));
    console.log('Saved accounts.json');
})().catch(err => { console.error(err.message); process.exit(1); });
