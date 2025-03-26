const express = require('express');
const { generateText } = require('../services/cohereService');
const router = express.Router();

//Designates a /generate route for AI responses, also assists in maintaining conversation state
router.post('/generate', async (req, res) => {
    try {
        const { sessionId, prompt } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID is required." });
        }

        const response = await generateText(sessionId, prompt);
        res.json({ reply: response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;