const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBIT_URL;

let connection, channel;
let connecting = null;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {

    // if a connection is already being made, reuse that same promise
    if (connecting) return connecting;

    connecting = (async () => {
        // rabbitmq takes a few seconds to boot inside docker, so keep retrying
        for (let attempt = 1; attempt <= 10; attempt++) {
            try {
                connection = await amqp.connect(RABBITMQ_URL);
                channel = await connection.createChannel();
                console.log('Connected to RabbitMQ');
                return channel;
            } catch (err) {
                console.log(`RabbitMQ not ready (attempt ${attempt}), retrying in 3s...`);
                await wait(3000);
            }
        }
        throw new Error('Could not connect to RabbitMQ');
    })();

    return connecting;
}

async function subscribeToQueue(queueName, callback) {
    if (!channel) await connect();
    await channel.assertQueue(queueName);
    channel.consume(queueName, async (message) => {
        try {
            await callback(message.content.toString());
        } finally {
            channel.ack(message);
        }
    });
}

async function publishToQueue(queueName, data) {
    if (!channel) await connect();
    await channel.assertQueue(queueName);
    channel.sendToQueue(queueName, Buffer.from(data));
}

module.exports = {
    subscribeToQueue,
    publishToQueue,
    connect,
};
