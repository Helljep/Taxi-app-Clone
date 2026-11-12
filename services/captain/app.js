const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const connectToDb = require('./db/db');
const captainRoutes = require('./routes/captain.routes');
const captainService = require('./services/captain.service');
const { subscribeToQueue } = require('./services/rabbit');

connectToDb();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// the realtime service drops captain positions on this queue,
// we pick them up here and save them to the database
subscribeToQueue('captain-location', async (msg) => {
    try {
        const { captainId, ltd, lng } = JSON.parse(msg);
        await captainService.updateLocation(captainId, ltd, lng);
    } catch (err) {
        console.log('Could not save captain location', err.message);
    }
});


// the gateway strips "/captains" so routes here start from "/"
app.use('/', captainRoutes);


module.exports = app;
