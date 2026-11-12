const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const mapsRoutes = require('./routes/maps.routes');

app.use(express.json());
app.use(cookieParser());


// the gateway strips "/maps" so routes here start from "/"
app.use('/', mapsRoutes);


module.exports = app;
