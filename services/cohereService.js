const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Self-explanatory
const conversationHistory = {};

// Info needed for AI to generate its response to the user. System prompt is functional, but will need tweaking.
const generateText = async (sessionId, userPrompt) => {
    // Default system prompt for ordering at Cane's
    const systemPrompt = "You are a friendly Raising Cane’s employee taking customer orders. Greet customers, take their order, and confirm it when they are done. If they say they are finished, repeat the full order and ask if they need anything else. Do not output text to simulate the customer, it is only your job to confirm and add to the customer's order based on the text you receive as their response.";

    // New sessions mean a new order, always start history with the system prompt given to the AI
    if (!conversationHistory[sessionId]) {
        conversationHistory[sessionId] = [systemPrompt];
    }

    // Append the user's message to the conversation
    conversationHistory[sessionId].push(`Customer: ${userPrompt}`);

    // If the user says they are finished, summarize the order. This is kind of scuffed right now, and maybe not even necessary
    if (userPrompt.toLowerCase().includes("finished") || userPrompt.toLowerCase().includes("that’s all")) {
        conversationHistory[sessionId].push("You: Alright, here's what I have for your order:");
    }

    // Join the conversation history as a single prompt
    const fullPrompt = conversationHistory[sessionId].join("\n") + "\nYou:";
    // Query the Cohere api to generate a response, defines character limit and requires API key for usage
    const response = await axios.post('https://api.cohere.ai/v1/generate', {
        model: 'command',
        prompt: fullPrompt,
        max_tokens: 100
    }, {
        headers: {
            'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    // Store AI response in history
    conversationHistory[sessionId].push(`You: ${response.data.generations[0].text}`);

    return response.data.generations[0].text;
};

module.exports = { generateText };
