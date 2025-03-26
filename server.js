const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Routes
const cohereRoutes = require("./routes/cohereRoutes");
app.use("/api", cohereRoutes);

// Export the app if it's being required (for Vercel)
if (process.env.VERCEL) {
  module.exports = app;
} else {
  // Local dev server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
