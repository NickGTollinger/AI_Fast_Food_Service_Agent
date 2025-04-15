const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const cohereRoutes = require('./routes/cohereRoutes');
const authRoutes = require('./routes/authRoutes');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Retrieve the chat interface from our index.html and prepare to run server
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/cohere', cohereRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Chat interface available at http://localhost:${PORT}/index.html`);
    console.log(`Test API endpoint at http://localhost:${PORT}/api/cohere/generate`);
});

app.use((req, res, next) => {
    console.warn(`Unmatched request: ${req.method} ${req.originalUrl}`);
    res.status(404).send("Route not found");
  });
  
  