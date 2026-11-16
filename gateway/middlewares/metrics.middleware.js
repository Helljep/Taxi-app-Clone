const client = require('prom-client');

client.collectDefaultMetrics();

const requestDuration = new client.Histogram({
    name: 'gateway_http_request_duration_seconds',
    help: 'Time taken by requests going through the gateway',
    labelNames: [ 'service', 'method', 'status' ],
    buckets: [ 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 ]
});

// times every request and writes one access-log line when it finishes
module.exports.trackRequests = (req, res, next) => {
    const stopTimer = requestDuration.startTimer();

    res.on('finish', () => {
        // the first path part (users, rides, ...) keeps the number of labels small
        const service = req.originalUrl.split('/')[ 1 ]?.split('?')[ 0 ] || 'root';
        const seconds = stopTimer({ service, method: req.method, status: res.statusCode });

        if (process.env.ACCESS_LOG !== 'off') {
            console.log(`${req.id} ${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(seconds * 1000)}ms`);
        }
    });

    next();
}

// Prometheus format, available at GET /metrics
module.exports.showMetrics = async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
}
