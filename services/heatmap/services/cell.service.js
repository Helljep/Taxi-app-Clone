const h3 = require('h3-js');
const redis = require('../db/redis');
const { surgeMultiplier } = require('./surge.service');

// The map is cut into H3 hexagons (resolution 8, about 0.7 km2 each), so a
// location becomes one short cell id and "how many captains are here" is a
// counter lookup instead of a geo search.
const RESOLUTION = 8;

const SUPPLY_TTL = 30 * 1000;        // a captain not heard from for 30s stops counting
const DEMAND_WINDOW = 5 * 60 * 1000; // a ride request counts for 5 minutes

// Redis layout:
//   supply:<cell>  sorted set  captainId -> last seen (ms)
//   demand:<cell>  sorted set  rideId    -> requested at (ms)
//   captain:cell   hash        captainId -> the cell they are counted in
//   cells          set         cells with recent activity
// Sorted sets mean a captain who loses signal simply ages out of the count.

const toCell = (ltd, lng) => h3.latLngToCell(Number(ltd), Number(lng), RESOLUTION);


module.exports.setCaptainPosition = async (captainId, ltd, lng) => {
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


module.exports.removeCaptain = async (captainId) => {
    const previous = await redis.hget('captain:cell', captainId);
    if (!previous) return;

    await redis.multi()
        .zrem(`supply:${previous}`, captainId)
        .hdel('captain:cell', captainId)
        .exec();
}


module.exports.addDemand = async (ltd, lng, rideId) => {
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


// Surge looks at the cell and its 6 neighbours, so a rider on a cell edge
// is priced by the area around them.
function areaTotals(cell, counts) {
    let drivers = 0;
    let demand = 0;

    for (const near of h3.gridDisk(cell, 1)) {
        drivers += counts[near]?.drivers || 0;
        demand += counts[near]?.demand || 0;
    }
    return { drivers, demand };
}


module.exports.getSurgeAt = async (ltd, lng) => {
    const cell = toCell(ltd, lng);
    const counts = await countCells(h3.gridDisk(cell, 1));
    const { drivers, demand } = areaTotals(cell, counts);

    return { cell, drivers, demand, multiplier: surgeMultiplier(demand, drivers) };
}


// Everything the map draws. Cells that have gone quiet are cleaned up here.
module.exports.getSnapshot = async () => {
    const active = await redis.smembers('cells');
    const counts = await countCells(active);

    const quiet = active.filter(cell => counts[cell].drivers === 0 && counts[cell].demand === 0);
    if (quiet.length > 0) {
        await forgetCells(quiet);
    }

    return active
        .filter(cell => !quiet.includes(cell))
        .map(cell => {
            const { drivers, demand } = counts[cell];
            const area = areaTotals(cell, counts);

            return {
                cell,
                center: h3.cellToLatLng(cell),
                boundary: h3.cellToBoundary(cell),
                drivers,
                demand,
                surge: surgeMultiplier(area.demand, area.drivers)
            };
        });
}


// Only touches what is really stale right now. Other captains may have pinged
// into these cells since they were counted, so nothing fresh is ever deleted.
async function forgetCells(cells) {
    const cutoff = Date.now() - SUPPLY_TTL;
    const demandCutoff = Date.now() - DEMAND_WINDOW;

    for (const cell of cells) {
        const stale = await redis.zrangebyscore(`supply:${cell}`, '-inf', cutoff);
        const current = stale.length ? await redis.hmget('captain:cell', ...stale) : [];

        const multi = redis.multi();
        stale.forEach((captainId, i) => {
            if (current[i] === cell) multi.hdel('captain:cell', captainId);
        });
        if (stale.length) multi.zrem(`supply:${cell}`, ...stale);
        multi.zremrangebyscore(`demand:${cell}`, '-inf', demandCutoff);
        await multi.exec();

        // drop the cell from the active list only if it is still empty
        const [ drivers, demand ] = await Promise.all([
            redis.zcard(`supply:${cell}`),
            redis.zcard(`demand:${cell}`)
        ]);
        if (drivers === 0 && demand === 0) await redis.srem('cells', cell);
    }
}
