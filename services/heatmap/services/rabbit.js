const amqp = require('amqplib');

// RabbitMQ helper shared (copied) by every service that uses the queue.
//
// Reliability features:
//  - a message that makes the handler throw is retried up to MAX_RETRIES times
//    (with a growing delay), then moved to "<queue>.dead" so it is never lost
//    and never blocks the queue (a "dead-letter queue")
//  - if RabbitMQ drops the connection we reconnect and re-subscribe
//  - published messages are marked persistent

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms, multiplied by the attempt number

let connection, channel;
let connecting = null;
const consumers = []; // { queueName, callback } so we can re-subscribe after a reconnect

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

async function reconnect() {
    try {
        await connect();
        for (const { queueName, callback } of consumers) {
            await consume(queueName, callback);
        }
    } catch (err) {
        console.log('Could not reconnect to RabbitMQ:', err.message);
    }
}


// Decides what happens to one message. Exported so it can be tested with a fake channel.
async function handleMessage(ch, queueName, message, callback) {
    try {
        await callback(message.content.toString());
    } catch (err) {
        const retries = (message.properties.headers?.[ 'x-retries' ] || 0) + 1;

        if (retries > MAX_RETRIES) {
            console.log(`Giving up on a ${queueName} message after ${MAX_RETRIES} retries: ${err.message}`);
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
        // always ack: a failed message has been re-queued or dead-lettered above
        ch.ack(message);
    }
}


async function consume(queueName, callback) {
    if (!channel) await connect();
    const ch = channel;
    await ch.assertQueue(queueName);
    // at most 10 unacknowledged messages at once, so a slow handler applies back-pressure
    await ch.prefetch(10);
    await ch.consume(queueName, (message) => {
        if (message) handleMessage(ch, queueName, message, callback);
    });
}

async function subscribeToQueue(queueName, callback) {
    consumers.push({ queueName, callback });
    await consume(queueName, callback);
}

async function publishToQueue(queueName, data) {
    if (!channel) await connect();
    await channel.assertQueue(queueName);
    channel.sendToQueue(queueName, Buffer.from(data), { persistent: true });
}

module.exports = {
    subscribeToQueue,
    publishToQueue,
    connect,
    handleMessage,
    MAX_RETRIES,
};
