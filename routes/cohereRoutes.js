const express = require('express');
const { generateText } = require('../services/cohereService');
const router = express.Router();

// POST /api/generate — Handles AI chat requests
router.post('/generate', async (req, res) => {
    console.log("🔁 /generate route hit");

    try {
        const { sessionId, prompt } = req.body;
        console.log("📝 Request body:", req.body);

        if (!sessionId) {
            console.log("Missing sessionId");
            return res.status(400).json({ error: "Session ID is required." });
        }

        const response = await generateText(sessionId, prompt);
        console.log("Cohere response generated:", response);

        res.json({ reply: response });
    } catch (error) {
        console.error("Error in /generate:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
