require('dotenv').config();
// Port is by default 3000, API key of course fetched via the hidden .env file
module.exports = {
    port: process.env.PORT || 3000,
    cohereApiKey: process.env.COHERE_API_KEY
};
