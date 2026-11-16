const dotenv = require('dotenv')
dotenv.config()
const express = require('express')
const cors = require('cors')
const expressProxy = require('express-http-proxy')

const app = express()

app.use(cors())


// every request from the frontend comes here first,
// then gets forwarded to the service that owns it
app.use('/users', expressProxy(process.env.USER_SERVICE_URL))
app.use('/captains', expressProxy(process.env.CAPTAIN_SERVICE_URL))
app.use('/rides', expressProxy(process.env.RIDE_SERVICE_URL))
app.use('/maps', expressProxy(process.env.MAPS_SERVICE_URL))
app.use('/heatmap', expressProxy(process.env.HEATMAP_SERVICE_URL))


app.get('/', (req, res) => {
    res.send('Gateway is up')
})

module.exports = app
