const test = require('node:test');
const assert = require('node:assert');

const { rankCandidates } = require('../services/dispatch');
const { isCancellationAbuse, MAX_CANCELS } = require('../services/fraud');

const captains = [ { _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'd' } ];

test('dispatch offers the captain with the shortest ETA first', () => {
    const ranked = rankCandidates({ captains, etas: [ 300, 60, 120, 240 ] });
    assert.deepStrictEqual(ranked.map(r => r.captain._id), [ 'b', 'c', 'd', 'a' ]);
    assert.strictEqual(ranked[ 0 ].etaSeconds, 60);
});

test('dispatch skips busy captains and captains who were already offered the ride', () => {
    const ranked = rankCandidates({
        captains, etas: [ 300, 60, 120, 240 ], busyIds: [ 'b' ], offeredIds: [ 'c' ]
    });
    assert.deepStrictEqual(ranked.map(r => r.captain._id), [ 'd', 'a' ]);
});

test('dispatch puts captains with unknown ETA last and still works without any ETAs', () => {
    const ranked = rankCandidates({ captains, etas: [ null, 500, null, 100 ] });
    assert.deepStrictEqual(ranked.slice(0, 2).map(r => r.captain._id), [ 'd', 'b' ]);

    const noEtas = rankCandidates({ captains, etas: null });
    assert.strictEqual(noEtas.length, 4);
});

test('dispatch with nobody available returns an empty list', () => {
    assert.deepStrictEqual(rankCandidates({ captains: [], etas: [] }), []);
    assert.deepStrictEqual(rankCandidates({ captains, etas: [ 1, 2, 3, 4 ], busyIds: [ 'a', 'b', 'c', 'd' ] }), []);
});

test('riders who cancel too often are blocked', () => {
    assert.strictEqual(isCancellationAbuse(MAX_CANCELS - 1), false);
    assert.strictEqual(isCancellationAbuse(MAX_CANCELS), true);
});
