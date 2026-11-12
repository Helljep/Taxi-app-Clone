const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const connectToDb = require('./db/db');
const rideRoutes = require('./routes/ride.routes');
const { connect: connectToRabbit } = require('./services/rabbit');

connectToDb();
connectToRabbit().catch(err => console.log(err.message));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// the gateway strips "/rides" so routes here start from "/"
app.use('/', rideRoutes);


module.exports = app;
