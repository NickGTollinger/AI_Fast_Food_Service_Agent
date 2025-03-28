const serverless = require("serverless-http");
const app = require("../server"); // we're going to slightly tweak server.js to make this work

module.exports = serverless(app);
