const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const cohereRoutes = require('./routes/cohereRoutes');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Serve frontend files from "public" directory
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/cohere', cohereRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`💬 Chat interface available at http://localhost:${PORT}/index.html`);
    console.log(`📡 Test API endpoint at http://localhost:${PORT}/api/cohere/generate`);
});
