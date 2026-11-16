const dotenv = require('dotenv')
dotenv.config()
const express = require('express')
const cors = require('cors')
const expressProxy = require('express-http-proxy')
const requestId = require('./middlewares/requestId.middleware')
const metrics = require('./middlewares/metrics.middleware')
const rateLimits = require('./middlewares/rateLimit.middleware')

const app = express()

app.use(cors())
app.use(requestId)
app.use(metrics.trackRequests)

app.get('/metrics', metrics.showMetrics)
app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.use(rateLimits.general)
app.use([ '/users/login', '/users/register', '/captains/login', '/captains/register' ], rateLimits.login)
app.post('/rides/create', rateLimits.createRide)


// every request from the frontend comes here first,
// then gets forwarded to the service that owns it
const proxyTo = (serviceUrl) => expressProxy(serviceUrl, {
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
