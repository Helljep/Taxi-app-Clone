const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const heatmapRoutes = require('./routes/heatmap.routes');
const { listenToSupplyEvents, broadcastHeatmap } = require('./services/heatmap.events');

app.use(express.json());
app.use(cookieParser());

listenToSupplyEvents();
broadcastHeatmap();


// the gateway strips "/heatmap" so routes here start from "/"
app.use('/', heatmapRoutes);


module.exports = app;
