const test = require('node:test');
const assert = require('node:assert');
const { isImpossibleJump, distanceKm } = require('../services/fraud');
const { handleMessage, MAX_RETRIES } = require('../services/rabbit');

const BLR = { ltd: 12.9716, lng: 77.5946 };

test('a normal drive is accepted', () => {
    // about 1.1 km in 2 minutes = 33 km/h
    const prev = { ...BLR, time: 0 };
    const next = { ltd: BLR.ltd + 0.01, lng: BLR.lng, time: 120000 };
    assert.strictEqual(isImpossibleJump(prev, next), false);
});

test('teleporting to another city in 2 seconds is rejected', () => {
    const prev = { ...BLR, time: 0 };
    const next = { ltd: 28.6139, lng: 77.209, time: 2000 };   // Delhi
    assert.ok(distanceKm(prev, next) > 1000);
    assert.strictEqual(isImpossibleJump(prev, next), true);
});

test('the first ping and GPS noise are never rejected', () => {
    assert.strictEqual(isImpossibleJump(undefined, { ...BLR, time: 1 }), false);
    assert.strictEqual(isImpossibleJump({ ...BLR, time: 0 }, { ltd: BLR.ltd + 0.0002, lng: BLR.lng, time: 100 }), false);
});


// ---- queue retry / dead-letter behaviour with a fake channel ----

function fakeChannel() {
    const ch = { sent: [], acked: 0 };
    ch.assertQueue = async () => { };
    ch.sendToQueue = (queue, content, options) => ch.sent.push({ queue, content, options });
    ch.ack = () => { ch.acked++; };
    return ch;
}

const message = (retries) => ({
    content: Buffer.from('{"x":1}'),
    properties: { headers: retries === undefined ? {} : { 'x-retries': retries } }
});

test('a message that handles fine is just acknowledged', async () => {
    const ch = fakeChannel();
    await handleMessage(ch, 'q', message(), async () => { });
    assert.strictEqual(ch.acked, 1);
    assert.strictEqual(ch.sent.length, 0);
});

test('a failing message is re-queued with a retry count', async (t) => {
    t.mock.timers.enable({ apis: [ 'setTimeout' ] });
    const ch = fakeChannel();

    await handleMessage(ch, 'q', message(), async () => { throw new Error('db down'); });
    t.mock.timers.tick(5000);

    assert.strictEqual(ch.acked, 1);
    assert.strictEqual(ch.sent.length, 1);
    assert.strictEqual(ch.sent[ 0 ].queue, 'q');
    assert.strictEqual(ch.sent[ 0 ].options.headers[ 'x-retries' ], 1);
});

test('after the last retry the message goes to the dead-letter queue', async () => {
    const ch = fakeChannel();

    await handleMessage(ch, 'q', message(MAX_RETRIES), async () => { throw new Error('still broken'); });

    assert.strictEqual(ch.acked, 1);
    assert.strictEqual(ch.sent.length, 1);
    assert.strictEqual(ch.sent[ 0 ].queue, 'q.dead');
    assert.strictEqual(ch.sent[ 0 ].options.headers[ 'x-error' ], 'still broken');
});
