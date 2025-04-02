const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const sessionOrders = {};

//This is the placeholder menu for testing purposes. The full menu of items from MongoDB will replace these.
const connectDB = require("../db");
let db;
let menuItems = [];

//Connect to MongoDB database
(async () => {
  db = await connectDB();
  const collection = db.collection("menu_items");
  menuItems = await collection.find({}).toArray();
  console.log("Menu successfully loaded: ", menuItems.length)
})();

//Adjust to remove case sensitivity and punctuation where needed
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9\s]/g, '');

//This is how we extract menu items from the customer's input. Placeholder database has an item name, price, and quantity
const extractOrderItems = (input) => {
  const result = [];
  const text = normalize(input);

  menuItems.forEach(item => {
    const itemName = normalize(item.name);
    const regex = new RegExp(`(?:(\\d+)\\s*)?${itemName}`, 'i');
    const match = regex.exec(text);
    if (match) {
      const quantity = match[1] ? parseInt(match[1], 10) : 1;
      result.push({
        name: item.name,
        price: item.price,
        quantity,
      });
    }
  });

  return result;
};

//Orders are kept track of via a 7 digit sessionID. This is to retain order history for a user. This is the called function for adding items.
const updateOrder = (sessionId, newItems) => {
  if (!sessionOrders[sessionId]) sessionOrders[sessionId] = [];

  newItems.forEach(newItem => {
    const existing = sessionOrders[sessionId].find(i => i.name === newItem.name);
    if (existing) {
      existing.quantity += newItem.quantity;
    } else {
      sessionOrders[sessionId].push({ ...newItem });
    }
  });
};

//Function call for item removal
const removeItems = (sessionId, removeTargets) => {
  if (!sessionOrders[sessionId]) return [];

  const before = [...sessionOrders[sessionId]];
  sessionOrders[sessionId] = sessionOrders[sessionId].filter(
    item => !removeTargets.some(target => normalize(target.name) === normalize(item.name))
  );
  //Return a list of removed items
  return before.filter(
    item => !sessionOrders[sessionId].some(i => normalize(i.name) === normalize(item.name))
  );
};

//For item replacement if customer changes their mind and prefers an item in place of another
const replaceItem = (sessionId, oldItemName, newItem) => {
  if (!sessionOrders[sessionId]) sessionOrders[sessionId] = [];
  //Old item removal
  sessionOrders[sessionId] = sessionOrders[sessionId].filter(
    i => normalize(i.name) !== normalize(oldItemName)
  );
  //Replacement item added
  updateOrder(sessionId, [newItem]);
};

//The order is formatted neatly into a bullet pointed list
const formatOrder = (order) => {
  if (!order.length) return "(none)";
  return order.map(i => `- ${i.quantity} ${i.name} ($${(i.price * i.quantity).toFixed(2)})`).join('\n');
};

//Price calculation
const calculateTotal = (order) => {
  return order.reduce((sum, item) => sum + item.price * item.quantity, 0);
};

//Cohere is responsible for taking the info parsed via the backend and conversing with the customer about their order, providing info where needed (can ask for menu, their current order, price total)
const rephraseWithCohere = async (updateMessage, currentOrder, total) => {
  const fullOrder = formatOrder(currentOrder);

//System prompt for when the customer updates their order in some way.
const aiPrompt = `
You are a helpful and polite Raising Cane’s employee. The assistant just updated the customer’s order.

Update summary:
${updateMessage}

Current full order:
${fullOrder}

Total so far: $${total}

Rephrase the update summary as a friendly and natural message to the customer:
  `.trim();
  const response = await axios.post('https://api.cohere.ai/v1/generate', {
    model: 'command',
    prompt: aiPrompt,
    max_tokens: 100,
    temperature: 0.3
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data.generations[0].text.trim();
};

//Fetch user prompt and normalize for processing
const generateText = async (sessionId, userPrompt) => {
  const userText = normalize(userPrompt);

  // These are the key phrases we parse for to determine intent to get the menu
  const isMenuRequest =
    userText.includes("menu") ||
    userText.includes("what do you have") ||
    userText.includes("show me") ||
    userText.includes("options");

  //Response to menu request is obviously the list of items from database
  if (isMenuRequest) {
    const menuText = menuItems.map(i => `- ${i.name}: $${i.price.toFixed(2)}`).join('\n');
    //System prompt for menu request
    const menuPrompt = `
You are a polite Raising Cane's employee. A customer asked to see the menu.

Respond with a friendly list of the menu items and their prices:

${menuText}
    `.trim();

    const menuResponse = await axios.post('https://api.cohere.ai/v1/generate', {
      model: 'command',
      prompt: menuPrompt,
      max_tokens: 100,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return menuResponse.data.generations[0].text.trim();
  }

  //These are the key phrases we parse for to determine the end of an order. Bot repeats their order and give the total.
  if (
    userText.includes("finished") ||
    userText.includes("that is all") ||
    userText.includes("that's all")
  ) {
    const order = sessionOrders[sessionId] || [];
    const total = calculateTotal(order).toFixed(2);
    const summary = `
Thanks for your order! Here's what I have:

${formatOrder(order)}

Your total is $${total}. Would you like anything else?
    `.trim();

    return await rephraseWithCohere(summary, sessionOrders[sessionId], total);
  }

  if (!sessionOrders[sessionId]) sessionOrders[sessionId] = [];

  //This is where we split the user prompt by clauses (ie: periods, commas, etc). Helpful for when the customer asks to make multiple changes at once (ie: add, removal, and replacement all at once). Clauses are parsed individually and in order as to properly serve customer.
  let combinedSummary = '';
  const clauses = userPrompt.split(/(?:,|\band\b|\.)/i).map(c => c.trim()).filter(Boolean);

  for (const clause of clauses) {
    const lowered = clause.toLowerCase();
    
    //Operation for removal
    if (lowered.includes("remove") || lowered.includes("delete")) {
      const targets = extractOrderItems(clause);
      const removed = removeItems(sessionId, targets);

      if (removed.length > 0) {
        combinedSummary += `Removed:\n${formatOrder(removed)}\n\n`;
      } else {
        combinedSummary += `Could not find any items to remove in: "${clause}"\n\n`;
      }
    
      //Operation for replacement
    } else if (lowered.includes("replace") || lowered.includes("change") || lowered.includes("instead")) {
      const words = normalize(clause).split(/\s+/);
      let oldItem = null;
      let newItem = null;

      for (let i = 0; i < words.length; i++) {
        if (["to", "with", "instead"].includes(words[i])) {
          const firstPart = words.slice(0, i).join(' ');
          const secondPart = words.slice(i + 1).join(' ');
          const possibleOld = extractOrderItems(firstPart);
          const possibleNew = extractOrderItems(secondPart);

          if (possibleOld.length && possibleNew.length) {
            oldItem = possibleOld[0];
            newItem = possibleNew[0];
            break;
          }
        }
      }

      if (oldItem && newItem) {
        replaceItem(sessionId, oldItem.name, newItem);
        combinedSummary += `Replaced ${oldItem.name} with ${newItem.quantity} ${newItem.name}.\n\n`;
      } else {
        combinedSummary += `Could not determine what to replace in: "${clause}"\n\n`;
      }
    //Operation for additions
    } else {
      const newItems = extractOrderItems(clause);
      if (newItems.length > 0) {
        updateOrder(sessionId, newItems);
        combinedSummary += `Added:\n${formatOrder(newItems)}\n\n`;
      } else {
        combinedSummary += `Didn't recognize any items in: "${clause}"\n\n`;
      }
    }
  }
  //Variables for keeping track of order and totals.
  const currentOrder = sessionOrders[sessionId];
  const total = calculateTotal(currentOrder).toFixed(2);
  return await rephraseWithCohere(combinedSummary.trim(), currentOrder, total);
};

module.exports = { generateText };
