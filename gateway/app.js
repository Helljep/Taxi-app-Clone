const dotenv = require('dotenv')
dotenv.config()
const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const expressProxy = require('express-http-proxy')
const rateLimit = require('express-rate-limit')
const client = require('prom-client')

const app = express()

app.use(cors())


// ---- request id + access log -------------------------------------------------
// Every request gets an id that is passed on to the service behind the gateway,
// so one user action can be followed through the logs of several services.
app.use((req, res, next) => {
    req.id = req.headers[ 'x-request-id' ] || crypto.randomUUID()
    res.setHeader('x-request-id', req.id)
    next()
})


// ---- metrics ------------------------------------------------------------------
// Prometheus format at GET /metrics: request count and latency per service and status.
client.collectDefaultMetrics()

const httpDuration = new client.Histogram({
    name: 'gateway_http_request_duration_seconds',
    help: 'Time taken by requests going through the gateway',
    labelNames: [ 'service', 'method', 'status' ],
    buckets: [ 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 ]
})

app.use((req, res, next) => {
    const stop = httpDuration.startTimer()
    res.on('finish', () => {
        // the first path part (users, rides, ...) keeps the number of label values small
        const service = req.originalUrl.split('/')[ 1 ]?.split('?')[ 0 ] || 'root'
        const seconds = stop({ service, method: req.method, status: res.statusCode })
        if (process.env.ACCESS_LOG !== 'off') {
            console.log(`${req.id} ${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(seconds * 1000)}ms`)
        }
    })
    next()
})

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType)
    res.end(await client.register.metrics())
})

app.get('/health', (req, res) => res.json({ status: 'ok' }))


// ---- rate limiting ------------------------------------------------------------
// Protects the services from one noisy client (or a brute-force login attempt).
// Counts are kept in this gateway's memory; with several gateways you would store
// them in Redis (rate-limit-redis) so the limit is shared.
const limiter = (limit, message) => rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message }
})

const perMinute = Number(process.env.RATE_LIMIT_PER_MIN) || 600

app.use(limiter(perMinute, 'Too many requests, slow down'))
app.use([ '/users/login', '/users/register', '/captains/login', '/captains/register' ],
    limiter(Number(process.env.AUTH_RATE_LIMIT_PER_MIN) || 20, 'Too many login attempts, try again in a minute'))
app.post('/rides/create',
    limiter(Number(process.env.RIDE_RATE_LIMIT_PER_MIN) || 15, 'Too many ride requests, try again in a minute'))


// ---- routing ------------------------------------------------------------------
// every request from the frontend comes here first,
// then gets forwarded to the service that owns it
const proxyTo = (url) => expressProxy(url, {
    timeout: 10000,
    proxyReqOptDecorator(options, req) {
        options.headers[ 'x-request-id' ] = req.id
        return options
    },
    proxyErrorHandler(err, res) {
        console.log('Proxy error:', err.code || err.message)
        res.status(502).json({ message: 'Service unavailable, try again shortly' })
    }
})

app.use('/users', proxyTo(process.env.USER_SERVICE_URL))
app.use('/captains', proxyTo(process.env.CAPTAIN_SERVICE_URL))
app.use('/rides', proxyTo(process.env.RIDE_SERVICE_URL))
app.use('/maps', proxyTo(process.env.MAPS_SERVICE_URL))
app.use('/heatmap', proxyTo(process.env.HEATMAP_SERVICE_URL))


app.get('/', (req, res) => {
    res.send('Gateway is up')
})

module.exports = app
