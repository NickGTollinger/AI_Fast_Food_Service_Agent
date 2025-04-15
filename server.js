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

// Serve static files from the "public" folder (e.g., index.html, login.html, signup.html)
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/cohere', cohereRoutes);
app.use('/api', authRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Chat interface available at http://localhost:${PORT}/index.html`);
  console.log(`Test API endpoint at http://localhost:${PORT}/api/cohere/generate`);
});

// Catch-all for unmatched routes
app.use((req, res, next) => {
  console.warn(`Unmatched request: ${req.method} ${req.originalUrl}`);
  res.status(404).send("Route not found");
});
