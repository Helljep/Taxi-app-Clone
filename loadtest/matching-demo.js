// Why match in batches? This compares two ways of pairing riders and drivers on the SAME
// random city: "greedy" (each rider, in order, takes the nearest free driver) against the
// Hungarian algorithm the engine uses (best pairing for the whole batch at once).
//
//   node matching-demo.js

const { hungarian } = require('../services/ride/services/hungarian');
const { distanceKm, driveMinutes } = require('../services/ride/services/geo');

const CITY = { ltd: 12.9716, lng: 77.5946, spread: 0.04 };   // ~4 km box
const point = () => ({ ltd: CITY.ltd + (Math.random() - 0.5) * CITY.spread * 2, lng: CITY.lng + (Math.random() - 0.5) * CITY.spread * 2 });

function trial(riders, drivers) {
    const cost = Array.from({ length: riders }, () => []);
    const R = Array.from({ length: riders }, point), D = Array.from({ length: drivers }, point);
    R.forEach((r, i) => D.forEach((d, j) => { cost[ i ][ j ] = driveMinutes(distanceKm(r, d)); }));

    // greedy: riders in arrival order each grab the closest driver still free
    const taken = new Set(); let greedy = 0;
    for (let i = 0; i < riders; i++) {
        let best = -1;
        for (let j = 0; j < drivers; j++) if (!taken.has(j) && (best < 0 || cost[ i ][ j ] < cost[ i ][ best ])) best = j;
        taken.add(best); greedy += cost[ i ][ best ];
    }

    const t = process.hrtime.bigint();
    const batch = hungarian(cost).reduce((sum, j, i) => sum + cost[ i ][ j ], 0);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    return { greedy, batch, ms };
}

console.log('riders drivers | greedy total | batch total | saved  | solve time');
for (const [ r, d ] of [ [ 10, 12 ], [ 50, 60 ], [ 100, 120 ], [ 100, 400 ], [ 200, 300 ] ]) {
    const runs = Array.from({ length: 20 }, () => trial(r, d));
    const avg = (k) => runs.reduce((s, x) => s + x[ k ], 0) / runs.length;
    const saved = (1 - avg('batch') / avg('greedy')) * 100;
    console.log(`${String(r).padStart(6)} ${String(d).padStart(7)} | ${avg('greedy').toFixed(1).padStart(9)} min | ${avg('batch').toFixed(1).padStart(8)} min | ${saved.toFixed(1).padStart(4)} % | ${avg('ms').toFixed(1)} ms`);
}
console.log('\n(averages over 20 random cities; totals are summed pickup minutes for the whole batch)');
