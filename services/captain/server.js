const http = require('http');
const app = require('./app');
const port = process.env.PORT || 3002;

const server = http.createServer(app);

server.listen(port, () => {
    console.log(`Captain service is running on port ${port}`);
});
