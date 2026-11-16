const amqp = require('amqplib');

// RabbitMQ helper (each service that uses the queue has its own copy).
// A message whose handler throws is retried a few times, then moved to
// "<queue>.dead" so it is never lost and never blocks the queue.

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms, multiplied by the attempt number

let connection, channel;
let connecting = null;
const consumers = []; // remembered so we can subscribe again after a reconnect

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));


async function connect() {

    // if a connection is already being made, reuse that same promise
    if (connecting) return connecting;

    connecting = (async () => {
        // rabbitmq takes a few seconds to boot inside docker, so keep retrying
        for (let attempt = 1; attempt <= 10; attempt++) {
            try {
                connection = await amqp.connect(process.env.RABBIT_URL);
                channel = await connection.createChannel();
                console.log('Connected to RabbitMQ');

                connection.on('error', (err) => console.log('RabbitMQ error:', err.message));
                connection.on('close', () => {
                    console.log('RabbitMQ connection closed, reconnecting...');
                    channel = null;
                    connecting = null;
                    reconnect();
                });

                return channel;
            } catch (err) {
                console.log(`RabbitMQ not ready (attempt ${attempt}), retrying in 3s...`);
                await wait(3000);
            }
        }
        connecting = null;
        throw new Error('Could not connect to RabbitMQ');
    })();

    return connecting;
}


// After a connection is lost keep trying until RabbitMQ is back, however long
// that takes, then subscribe to every queue again.
async function reconnect() {
    while (true) {
        try {
            await connect();
            for (const { queueName, callback } of consumers) {
                await consume(queueName, callback);
            }
            return;
        } catch (err) {
            console.log('Could not reconnect to RabbitMQ, trying again in 5s:', err.message);
            await wait(5000);
        }
    }
}


async function handleMessage(ch, queueName, message, callback) {
    try {
        await callback(message.content.toString());
    } catch (err) {
        const retries = (message.properties.headers?.[ 'x-retries' ] || 0) + 1;

        if (retries > MAX_RETRIES) {
            console.log(`Giving up on a ${queueName} message: ${err.message}`);
            await ch.assertQueue(`${queueName}.dead`);
            ch.sendToQueue(`${queueName}.dead`, message.content, {
                persistent: true,
                headers: { 'x-error': err.message, 'x-retries': retries - 1 }
            });
        } else {
            console.log(`Retrying a ${queueName} message (${retries}/${MAX_RETRIES}): ${err.message}`);
            setTimeout(() => {
                ch.sendToQueue(queueName, message.content, {
                    persistent: true,
                    headers: { 'x-retries': retries }
                });
            }, RETRY_DELAY * retries);
        }
    } finally {
        // the message was handled, re-queued or dead-lettered, so it is always acknowledged
        ch.ack(message);
    }
}


async function consume(queueName, callback) {
    if (!channel) await connect();
    const ch = channel;

    await ch.assertQueue(queueName);
    await ch.prefetch(10);
    await ch.consume(queueName, (message) => {
        if (message) handleMessage(ch, queueName, message, callback);
    });
}


async function subscribeToQueue(queueName, callback) {
    consumers.push({ queueName, callback });
    await consume(queueName, callback);
}


// declaring a queue is a network round trip, so it is done once per queue per channel,
// not once per message (a reconnect creates a new channel and so declares again)
let declaredOn = null;
const declared = new Set();

async function publishToQueue(queueName, data) {
    if (!channel) await connect();
    if (declaredOn !== channel) { declaredOn = channel; declared.clear(); }
    if (!declared.has(queueName)) {
        await channel.assertQueue(queueName);
        declared.add(queueName);
    }
    channel.sendToQueue(queueName, Buffer.from(data), { persistent: true });
}

module.exports = {
    subscribeToQueue,
    publishToQueue,
    connect,
};
