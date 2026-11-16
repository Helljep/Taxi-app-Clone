const test = require('node:test');
const assert = require('node:assert');

// run against an in-memory Redis so no server is needed
require.cache[ require.resolve('ioredis') ] = {
    id: 'ioredis', filename: 'ioredis', loaded: true,
    exports: require('ioredis-mock')
};

const { surgeMultiplier } = require('../services/surge');
const cells = require('../services/cells');

const HERE = [ 12.9716, 77.5946 ];

test('surge is 1x when captains cover demand, rises when they do not, caps at 3x', () => {
    assert.strictEqual(surgeMultiplier(0, 0), 1);
    assert.strictEqual(surgeMultiplier(2, 5), 1);
    assert.strictEqual(surgeMultiplier(3, 2), 1.5);
    assert.strictEqual(surgeMultiplier(5, 0), 3);
    assert.strictEqual(surgeMultiplier(50, 1), 3);
});

test('captain counts once, moves between cells, and can be removed', async () => {
    await cells.setCaptainPosition('c1', ...HERE);
    await cells.setCaptainPosition('c1', ...HERE);   // same captain twice = still one
    await cells.setCaptainPosition('c2', ...HERE);

    let snap = await cells.getSnapshot();
    assert.strictEqual(snap.length, 1);
    assert.strictEqual(snap[ 0 ].drivers, 2);
    assert.strictEqual(snap[ 0 ].boundary.length, 6);

    await cells.setCaptainPosition('c1', 13.1, 77.9);  // far away -> new cell
    snap = await cells.getSnapshot();
    assert.strictEqual(snap.length, 2);
    assert.strictEqual(snap.reduce((n, c) => n + c.drivers, 0), 2);
    assert.strictEqual(snap.find(c => c.cell === cells.toCell(...HERE)).drivers, 1);

    await cells.removeCaptain('c1');
    await cells.removeCaptain('c2');
    snap = await cells.getSnapshot();
    assert.strictEqual(snap.length, 0);   // quiet cells are cleaned up
});

test('demand without captains raises surge; captains next door bring it back down', async () => {
    for (let i = 0; i < 4; i++) await cells.addDemand(...HERE, `ride${i}`);

    let surge = await cells.getSurgeAt(...HERE);
    assert.strictEqual(surge.demand, 4);
    assert.strictEqual(surge.drivers, 0);
    assert.strictEqual(surge.multiplier, 3);   // 4 requests / max(0,1) capped

    // a captain a few hundred metres away lands in a neighbouring cell
    await cells.setCaptainPosition('c3', HERE[ 0 ] + 0.006, HERE[ 1 ]);
    await cells.setCaptainPosition('c4', ...HERE);
    surge = await cells.getSurgeAt(...HERE);
    assert.strictEqual(surge.drivers, 2);
    assert.strictEqual(surge.multiplier, 2);
});
