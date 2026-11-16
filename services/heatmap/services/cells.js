const Redis = require('ioredis');
const h3 = require('h3-js');
const { surgeMultiplier } = require('./surge');

// The map is cut into H3 hexagons. Resolution 8 is roughly 0.7 km2 per cell.
// Every lat/lng becomes one short cell id, so "how many captains are here"
// turns into a simple counter instead of a geo search over every captain.
const RESOLUTION = 8;

const SUPPLY_TTL = 30 * 1000;       // a captain not heard from for 30s stops counting
const DEMAND_WINDOW = 5 * 60 * 1000; // ride requests count for 5 minutes

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => console.log('Redis error:', err.message));

// Redis layout
//   supply:<cell>   sorted set  captainId -> last seen (ms)
//   demand:<cell>   sorted set  rideId    -> requested at (ms)
//   captain:cell    hash        captainId -> the cell they are counted in
//   cells           set         cells that have (or recently had) activity
// A sorted set (instead of a bare number) means a captain who crashes or loses
// signal just ages out, so the counts can never drift upwards forever.

const toCell = (ltd, lng) => h3.latLngToCell(Number(ltd), Number(lng), RESOLUTION);


async function setCaptainPosition(captainId, ltd, lng) {
    const cell = toCell(ltd, lng);
    const previous = await redis.hget('captain:cell', captainId);

    const multi = redis.multi();
    if (previous && previous !== cell) {
        multi.zrem(`supply:${previous}`, captainId);
    }
    multi.zadd(`supply:${cell}`, Date.now(), captainId);
    multi.hset('captain:cell', captainId, cell);
    multi.sadd('cells', cell);
    await multi.exec();
}


// captain went offline, or took a ride and is no longer free
async function removeCaptain(captainId) {
    const previous = await redis.hget('captain:cell', captainId);
    if (!previous) return;

    await redis.multi()
        .zrem(`supply:${previous}`, captainId)
        .hdel('captain:cell', captainId)
        .exec();
}


async function addDemand(ltd, lng, rideId) {
    const cell = toCell(ltd, lng);
    await redis.multi()
        .zadd(`demand:${cell}`, Date.now(), String(rideId))
        .sadd('cells', cell)
        .exec();
}


// { cell: { drivers, demand } } for the given cells, in one round trip
async function countCells(cells) {
    if (cells.length === 0) return {};

    const now = Date.now();
    const pipeline = redis.pipeline();
    for (const cell of cells) {
        pipeline.zcount(`supply:${cell}`, now - SUPPLY_TTL, '+inf');
        pipeline.zcount(`demand:${cell}`, now - DEMAND_WINDOW, '+inf');
    }
    const results = await pipeline.exec();

    const counts = {};
    cells.forEach((cell, i) => {
        counts[cell] = {
            drivers: results[i * 2][1],
            demand: results[i * 2 + 1][1]
        };
    });
    return counts;
}


// Surge looks at the cell AND its 6 neighbours, so a rider standing on
// a cell edge is priced by the area around them, not one hexagon.
function areaTotals(cell, counts) {
    let drivers = 0, demand = 0;
    for (const near of h3.gridDisk(cell, 1)) {
        drivers += counts[near]?.drivers || 0;
        demand += counts[near]?.demand || 0;
    }
    return { drivers, demand };
}


async function getSurgeAt(ltd, lng) {
    const cell = toCell(ltd, lng);
    const counts = await countCells(h3.gridDisk(cell, 1));
    const { drivers, demand } = areaTotals(cell, counts);

    return { cell, drivers, demand, multiplier: surgeMultiplier(demand, drivers) };
}


// Everything the heatmap draws. Also tidies up cells that have gone quiet.
async function getSnapshot() {
    const active = await redis.smembers('cells');
    const counts = await countCells(active);

    const quiet = active.filter(cell => counts[cell].drivers === 0 && counts[cell].demand === 0);
    if (quiet.length > 0) {
        await cleanUp(quiet);
    }

    return active
        .filter(cell => !quiet.includes(cell))
        .map(cell => {
            const { drivers, demand } = counts[cell];
            const area = areaTotals(cell, counts);
            const [ ltd, lng ] = h3.cellToLatLng(cell);

            return {
                cell,
                center: [ ltd, lng ],
                boundary: h3.cellToBoundary(cell),   // [[lat, lng], ...] six corners
                drivers,
                demand,
                surge: surgeMultiplier(area.demand, area.drivers)
            };
        });
}


async function cleanUp(cells) {
    const cutoff = Date.now() - SUPPLY_TTL;
    const multi = redis.multi();

    for (const cell of cells) {
        // forget captains that aged out, but only if they were not counted somewhere new
        const stale = await redis.zrangebyscore(`supply:${cell}`, '-inf', cutoff);
        for (const captainId of stale) {
            if (await redis.hget('captain:cell', captainId) === cell) {
                multi.hdel('captain:cell', captainId);
            }
        }
        multi.del(`supply:${cell}`, `demand:${cell}`);
        multi.srem('cells', cell);
    }
    await multi.exec();
}


module.exports = {
    setCaptainPosition,
    removeCaptain,
    addDemand,
    getSurgeAt,
    getSnapshot,
    toCell
};
