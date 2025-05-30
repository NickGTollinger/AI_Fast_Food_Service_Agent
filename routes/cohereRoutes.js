const express = require('express');
const router = express.Router();
const { generateText } = require('../services/cohereService');

//Connect Cohere to the cloud server and maintain logs in the event of an error
router.post('/generate', async (req, res) => {
    console.log("/generate route hit");

    try {
        const { sessionId, prompt, customerId } = req.body;
        console.log("Request body:", req.body);

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID is required." });
        }

        const response = await generateText(sessionId, prompt, customerId);
        console.log("Received from frontend:", sessionId, prompt, customerId);

        console.log("Cohere response generated:", response);

        res.json({ reply: response });
    } catch (error) {
        console.error("Error in /generate:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
