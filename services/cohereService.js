const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Keep track of the orders of particular session
const sessionOrders = {};
const { connectDB } = require('../db');

// Set up storage for database and menu items
let db;
let menuItems = [];

// Connect to MongoDB
(async () => {
  db = await connectDB();
  const collection = db.collection("menu_items");
  menuItems = await collection.find({}).toArray();
  console.log("Menu successfully loaded:", menuItems.length);
})();

// We parse for menu items using the string-similarity library
const stringSimilarity = require('string-similarity');

// For parsing purposes we remove case sensitivity and extraneous characters
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
const getMostRecentOrder = async (customerId) => {
  if (!db || !customerId) return null;
  const orders = await db.collection("orders")
    .find({ customerId })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();
  return orders.length ? orders[0] : null;
};

const extractOrderItems = (input, quantity = null) => {
  const result = [];
  const text = normalize(input);
  const words = text.split(/\s+/);
  const candidates = [];

  // Create n-grams from the input (1 to 4 words). This let's us find the most likely menu item the customer is asking about
  for (let size = 1; size <= 4; size++) {
    for (let i = 0; i <= words.length - size; i++) {
      const phrase = words.slice(i, i + size).join(' ');
      for (const item of menuItems) {
        const itemNameNorm = normalize(item.name);
        const sim = stringSimilarity.compareTwoStrings(phrase, itemNameNorm);
        candidates.push({ item, sim, matchedPhrase: phrase });
      }
    }
  }

  // Get the best match above a certain threshold, handle tie-breakers by picking more specific item
  const best = candidates
  .filter(c => c.sim > 0.5)
  .sort((a, b) => {
    // Prioritize higher similarity
    if (b.sim !== a.sim) return b.sim - a.sim;

    return b.item.name.length - a.item.name.length;
  })[0];


  if (!best) return result;

  const { item } = best;
  const entry = {
    name: item.name,
    price: item.price || null,
    quantity: quantity || 1,
  };

  // --- REMOVABLE COMBO COMPONENT HANDLING ---
if (item.category === "Combos" && Array.isArray(item.items)) {
  const removedComponents = [];
  //No and without are the keywords we look for to signal an adjustment to a combo item
  for (const component of item.items) {
    const componentName = normalize(component.name);
    if (text.includes("no " + componentName) || text.includes("without " + componentName)) {
      removedComponents.push(component.name);
    }
  }
  //Push the component to be removed and find its associated menu item (should be under Extras)
  if (removedComponents.length > 0) {
    let deduction = 0;

    for (const name of removedComponents) {
      const matching = menuItems.find(m => normalize(m.name) === normalize(name));
      if (matching && matching.price) {
        deduction += matching.price;
      }
    }
    //Process the removal and calculate price change
    entry.name += ` (No ${removedComponents.join(", no ")})`;
    entry.price = parseFloat((entry.price - deduction).toFixed(2));
  }
}

  // --- SIZE HANDLING ---
  if (Array.isArray(item.sizes)) {
    const sizeMatch = item.sizes.find(s => text.includes(normalize(s.size)));

    //The default size should be the smallest one, which in our case is always a small or regular if the customer doesn't specify a size
    const defaultSize =
      item.sizes.find(s => normalize(s.size).includes("small")) ||
      item.sizes.find(s => normalize(s.size).includes("regular")) ||
      item.sizes[0];

    const chosenSize = sizeMatch || defaultSize;

    if (chosenSize) {
      entry.name += ` (${chosenSize.size})`;
      entry.price = chosenSize.price;
    }
  }

  // --- ICE HANDLING ---
  const iceOptions = getIceOptions(item);
  if (iceOptions) {
    const normalizedIceOptions = iceOptions.map(opt => normalize(opt));
    const matchedIce = normalizedIceOptions.find(opt => text.includes(opt));

    const originalIce = iceOptions.find(opt => normalize(opt) === matchedIce);
    // Default ice (if applicable to item) is with Canes Ice, but they may ask for no ice at no price change
    if (originalIce) {
      entry.ice = originalIce;
      if (originalIce !== "Cane's Ice") {
        entry.name += `, ${originalIce}`;
      }
    } else {
      // Default if no ice specified
      entry.ice = "Cane's Ice";
      entry.name += `, Cane's Ice`;
    }
  }
// --- ADDON HANDLING ---, for drinks (only Unsweet Tea in our case), let them add up to 2 addons like Sugar or Lemon. No price changes occur from this.
if (item.options?.addons?.choices) {
  const availableAddons = item.options.addons.choices;
  const normalizedAddons = availableAddons.map(opt => ({
    original: opt,
    normalized: normalize(opt)
  }));

  const loweredInput = input.toLowerCase();
  
  const selectedAddons = [];

  for (const { original, normalized } of normalizedAddons) {
    // Match word-boundary-like patterns (splits like 'sugar', 'splenda', etc.)
    const regex = new RegExp(`\\b${normalized}\\b`, 'i');
    if (regex.test(loweredInput) && selectedAddons.length < 2) {
      selectedAddons.push(original);
    }
  }

  if (selectedAddons.length > 0) {
    entry.addons = selectedAddons;
    entry.name += ` [${selectedAddons.join(', ')}]`;
  }
}

// After handling any specific cases, we can push the item and its info
  result.push(entry); 
  return result;

};

// Helper function for the Ice Handling
const getIceOptions = (item) => {
  if (!item.options) return null;

  if (Array.isArray(item.options)) {
    const iceObj = item.options.find(opt => opt.ice);
    return iceObj ? iceObj.ice : null;
  }

  if (typeof item.options === 'object' && item.options.ice) {
    return item.options.ice;
  }

  return null;
};


// Order helper functions for addings, removals, replacements, etc
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

const removeItems = (sessionId, removeTargets) => {
  if (!sessionOrders[sessionId]) return [];

  const removedItems = [];

  for (const target of removeTargets) {
    const existingIndex = sessionOrders[sessionId].findIndex(
      item => normalize(item.name) === normalize(target.name)
    );

    if (existingIndex !== -1) {
      const existingItem = sessionOrders[sessionId][existingIndex];
      const qtyToRemove = target.quantity || existingItem.quantity;

      if (qtyToRemove < existingItem.quantity) {
        // Partial removal
        existingItem.quantity -= qtyToRemove;
        removedItems.push({ ...existingItem, quantity: qtyToRemove });
      } else {
        // Remove completely
        removedItems.push(sessionOrders[sessionId][existingIndex]);
        sessionOrders[sessionId].splice(existingIndex, 1);
      }
    }
  }

  return removedItems;
};
const replaceItem = (sessionId, oldItemName, newItem) => {
  if (!sessionOrders[sessionId]) sessionOrders[sessionId] = [];

  const normalizeBase = (fullName) => {
    const namePart = fullName.split(' (')[0];
    const iceMatch = fullName.match(/, (No Ice|Cane's Ice)/);
    const addonMatch = fullName.match(/\[([^\]]+)\]/);
    const ice = iceMatch ? iceMatch[1] : null;
    const addons = addonMatch ? addonMatch[1].split(',').map(a => a.trim()) : [];
    return { name: normalize(namePart), ice, addons: new Set(addons) };
  };

  const newInfo = normalizeBase(newItem.name);

  let bestMatchIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < sessionOrders[sessionId].length; i++) {
    const existing = sessionOrders[sessionId][i];
    const existingInfo = normalizeBase(existing.name);

    let score = 0;
    if (existingInfo.name === newInfo.name) score += 2;
    if (existingInfo.ice === newInfo.ice) score += 1;

    const addonOverlap = [...existingInfo.addons].filter(a => newInfo.addons.has(a)).length;
    score += addonOverlap;

    if (score > bestScore) {
      bestScore = score;
      bestMatchIndex = i;
    }
  }

  if (bestMatchIndex !== -1) {
    const existing = sessionOrders[sessionId][bestMatchIndex];
    const replaceQty = oldItemName.quantity || 1;

    if (existing.quantity > replaceQty) {
      // Reduce quantity of the original item
      existing.quantity -= replaceQty;
    } else {
      // Remove the item entirely
      sessionOrders[sessionId].splice(bestMatchIndex, 1);
    }

    // Add new item with intended quantity (default to 1 if missing)
    const newQty = newItem.quantity || 1;
    const existingNew = sessionOrders[sessionId].find(i => i.name === newItem.name);
    if (existingNew) {
      existingNew.quantity += newQty;
    } else {
      sessionOrders[sessionId].push({ ...newItem, quantity: newQty });
    }

  } else {
    // Couldn't find anything to replace, treat as new
    updateOrder(sessionId, [newItem]);
  }
};



// Helper function for formatting order to be more visually appealing
const formatOrder = (order) => {
  if (!order.length) return "(none)";
  return order.map(i => `- ${i.quantity} ${i.name} ($${(i.price * i.quantity).toFixed(2)})`).join('\n');
};

//Helper function for price calculation
const calculateTotal = (order) => {
  return order.reduce((sum, item) => sum + item.price * item.quantity, 0);
};

// Cohere will receive info from the back end and relay the information accordingly in a friendly manner
const rephraseWithCohere = async (updateMessage, currentOrder, total) => {
  const fullOrder = formatOrder(currentOrder);

  const aiPrompt = `
You are a helpful and polite, but concise Raising Cane’s employee. You just updated the customer’s order.

Update summary:
${updateMessage}

Current full order:
${fullOrder}

Total so far: $${total}

Rephrase the update summary as a friendly and natural message to the customer, but keep the vocabulary simple, don't overdo the friendliness, and don't assign a gender to the customer:
  `.trim();

  const response = await axios.post('https://api.cohere.ai/v1/generate', {
    model: 'command',
    prompt: aiPrompt,
    max_tokens: 150,
    temperature: 0.3
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data.generations[0].text.trim();
};

// Function for saving user order info. This includes session id, customer id, the items, their total, and the date. Customer ID and date will be useful for personalization.
const saveOrderToDB = async (sessionId, customerId) => {
  console.log("[Saving order]")
  if (!db || !sessionOrders[sessionId]) return;
  const order = sessionOrders[sessionId];
  const total = calculateTotal(order);

  const orderDocument = {
    sessionId,
    customerId: customerId || null,
    items: order,
    total,
    timestamp: new Date()
  };  

  try {
    const result = await db.collection('orders').insertOne(orderDocument);
    console.log(`Order stored with _id: ${result.insertedId}`);
  } catch (err) {
    console.error('Failed to save order to DB:', err);
  }
};

// This will hold a customer's previous, most recent order if applicable and offer it at the start.
const pendingRepeatOrder = {};


// Generate text operations do not consume AI tokens as they are simple operations that can easily be done via backend operations
const generateText = async (sessionId, userPrompt, customerId) => {
  const userText = normalize(userPrompt);
  // When the user first arrives on the page, trigger a welcome message and offer previous order if applicable
  if (userPrompt === "__USER_ARRIVED__") {
    if (customerId) {
      const recent = await getMostRecentOrder(customerId);
      if (recent && recent.items?.length) {
        const itemsSummary = recent.items.map(i => `- ${i.quantity} ${i.name}`).join('\n');
        const total = `$${calculateTotal(recent.items).toFixed(2)}`;
  
        pendingRepeatOrder[sessionId] = recent.items;
  
        return `Welcome back! Last time you ordered:\n${itemsSummary}\nTotal: ${total}.\nWould you like the same order again?`;
      }
    }
  
    return "Welcome to Raising Cane’s! What can I get started for you today?";
  }
  
  // Check for response to the previous order request. If yes, add their previous order. If no, don't and ask what they want
  else if (Array.isArray(pendingRepeatOrder[sessionId]) && pendingRepeatOrder[sessionId].length > 0) {
    const yesPattern = /\b(yes|yeah|sure|okay|yep|yup|please do|go ahead)\b/i;
    const noPattern = /\b(no|nah|nope|not now|don’t|don't want it)\b/i;
  
    if (yesPattern.test(userPrompt)) {
      const repeatItems = pendingRepeatOrder[sessionId];
      updateOrder(sessionId, repeatItems);
      delete pendingRepeatOrder[sessionId];
  
      return `Great! I've re-added your last order:\n${formatOrder(repeatItems)}\nTotal: $${calculateTotal(repeatItems).toFixed(2)}.\nLet me know if you’d like to add or change anything.`;
    }
  
    if (noPattern.test(userPrompt)) {
      delete pendingRepeatOrder[sessionId];
      return "No problem! What would you like to order today?";
    }
  
    // If not a yes, no, or some variant then just prompt again
    return "Would you like to repeat your last order? Just say 'yes' or 'no'.";
  }
  
  // Clear order command
  else if (/\b(clear|reset|empty)\b.*\border\b/i.test(userPrompt)) {
    sessionOrders[sessionId] = [];
    return "Got it! I've cleared your order. Let me know if you'd like to start a new one.";
  }

  
  // If the customers asks for calories for an item, provide it
  else if (userText.includes("calorie") || userText.includes("how many calories")) {
    const possibleItems = extractOrderItems(userPrompt);
    if (possibleItems.length > 0) {
      let reply = '';
      for (const item of possibleItems) {
        const baseName = item.name.split(/[\(,\[]/)[0].trim(); 
        const dbItem = menuItems.find(m => normalize(m.name) === normalize(baseName));
        
        if (dbItem) {
          let calories = null;
          if (Array.isArray(dbItem.sizes) && item.name.includes('(')) {
            const sizeMatch = item.name.match(/\(([^)]+)\)/);
            const size = sizeMatch ? sizeMatch[1].toLowerCase() : '';
            const matchedSize = dbItem.sizes.find(s => normalize(s.size) === normalize(size));
            calories = matchedSize?.calories;
          } else {
            calories = dbItem.calories;
          }
  
          if (calories != null) {
            reply += `${item.name} has approximately ${calories} calories.\n`;
          } else {
            reply += `Sorry, I couldn't find calorie info for ${item.name}.\n`;
          }
        }
      }
      return reply.trim();
    } else {
      return "Could you clarify which item you'd like to know the calories for?";
    }
  }
  // If the customer asks for the price of an item, provide it
  if (
    userText.includes("how much") ||
    userText.includes("price of") ||
    userText.includes("cost of")
  ) {
    const possibleItems = extractOrderItems(userPrompt);
    if (possibleItems.length > 0) {
      let reply = '';
      for (const item of possibleItems) {
        const dbItem = menuItems.find(m => normalize(m.name) === normalize(item.name.split(' (')[0]));
        if (dbItem) {
          let price = null;
  
          // Look for price based on size if mentioned
          if (Array.isArray(dbItem.sizes) && item.name.includes('(')) {
            const sizeMatch = item.name.match(/\(([^)]+)\)/);
            const size = sizeMatch ? sizeMatch[1].toLowerCase() : '';
            const matchedSize = dbItem.sizes.find(s => normalize(s.size) === normalize(size));
            price = matchedSize?.price;
          } else {
            price = dbItem.price;
          }
  
          if (price != null) {
            reply += `${item.name} costs $${price.toFixed(2)}.\n`;
          } else {
            reply += `Sorry, I couldn't find pricing info for ${item.name}.\n`;
          }
        }
      }
      return reply.trim();
    } else {
      return "Could you clarify which item you'd like the price for?";
    }
  }
  // If the customers wants to know what items there are in a specific category, provide it. These keywords indicate an intent for that.
  const categoryKeywords = {
  drinks: ["what drinks", "what beverages", "what kind of drinks"],
  combos: [, "what combos", "what kind of combos", "what meals", "what kind of meals"],
  tailgates: ["what tailgates", "what kind of tailgates"],
  extras: ["what extras", "what kind of extras", "what sides", "what kind of sides"]
};

for (const [categoryKey, keywords] of Object.entries(categoryKeywords)) {
  if (keywords.some(word => userText.includes(word))) {
    const itemsInCategory = menuItems.filter(item =>
      item.category?.toLowerCase() === categoryKey
    );

    if (itemsInCategory.length > 0) {
      let list = `<h3>${categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1)}</h3><ul>`;
      for (const item of itemsInCategory) {
        const displayName = item.name || item.brand || "Unnamed Item";
        list += `<li><strong>${displayName}</strong>`;

        if (typeof item.price === 'number') {
          list += ` - $${item.price.toFixed(2)}`;
        }

        if (Array.isArray(item.sizes)) {
          const sizeList = item.sizes.map(s => {
            const label = s.brand ? `${s.brand} (${s.size})` : `${s.size}`;
            const price = typeof s.price === 'number' ? `$${s.price.toFixed(2)}` : 'N/A';
            return `${label}: ${price}`;
          }).join('<br>');
          list += `<br><em>${sizeList}</em>`;
        }

        list += `</li>`;
      }
      list += `</ul>`;
      return `Here are our ${categoryKey}:<br><br>${list}`;
    } else {
      return `Sorry, I couldn't find anything in the ${categoryKey} category.`;
    }
  }
}
  // Paste the menu if the keywords are found
  const isMenuRequest =
    userText.includes("menu") ||
    userText.includes("what do you have") ||
    userText.includes("show me") ||
    userText.includes("options");

  // Menu formatting just to make it look a little nice
  if (isMenuRequest) {
    try {
      // Group items by category
      const categories = {};

      menuItems.forEach(item => {
        const category = item.category || "Other";
        if (!categories[category]) categories[category] = [];
        categories[category].push(item);
      });

      let menuHTML = '';

      for (const [category, items] of Object.entries(categories)) {
        menuHTML += `<h3 style="margin-top: 1em;">${category}</h3><ul style="padding-left: 1em;">`;

        items.forEach(item => {
          const displayName = item.name || item.brand || "Unnamed Item";
          menuHTML += `<li><strong>${displayName}</strong>`;

          if (typeof item.price === 'number') {
            menuHTML += ` - $${item.price.toFixed(2)}`;
          }

          if (Array.isArray(item.sizes) && item.sizes.length > 0) {
            const sizeList = item.sizes.map(s => {
              const label = s.brand ? `${s.brand} (${s.size})` : `${s.size}`;
              const price = typeof s.price === 'number' ? `$${s.price.toFixed(2)}` : 'N/A';
              return `${label}: ${price}`;
            }).join('<br>');
            menuHTML += `<br><em>${sizeList}</em>`;
          }
          

          menuHTML += `</li>`;
        });

        menuHTML += `</ul>`;
      }

      return `Here’s our menu:<br><br>${menuHTML}`;
    } catch (err) {
      console.error('Error generating menu list:', err);
      return "Sorry, I couldn’t retrieve the menu right now.";
    }
  }
  // Detect if customer is ending their order, paste their total and order if detected
  if (
    userText.includes("finished") ||
    userText.includes("that is all") ||
    userText.includes("that's all") ||
    userText.includes("done")
  ) {
    const order = sessionOrders[sessionId] || [];
    const total = calculateTotal(order).toFixed(2);
  
    if (order.length === 0) {
      return "Your order looks empty at the moment. Let me know if you'd like to get started with something tasty!";
    }
  
    const orderHTML = order.map(i =>
      `<li>${i.quantity} × <strong>${i.name}</strong> - $${(i.price * i.quantity).toFixed(2)}</li>`
    ).join('');
    // Call the save order function when user is finished
    await saveOrderToDB(sessionId, customerId);
    return `
  <h3>Thanks for your order! Here's what I have for you:</h3>
  <ul style="padding-left: 1em;">
    ${orderHTML}
  </ul>
  <p><strong>Final Total:</strong> $${total}</p>
  <p>Thank you again and have a great day!</p>
    `.trim();

  }

  // Checking for order requests, provide it if keywords detected
  const orderInquiryKeywords = [
    "what's my order",
    "what is my order",
    "what have i ordered",
    "show me my order",
    "what do i have",
    "what have i got",
    "current order",
    "so far in my order"
  ];
  const cleanedText = userPrompt.toLowerCase().replace(/[?.!,]/g, '');
  if (orderInquiryKeywords.some(phrase => cleanedText.includes(phrase)))
  {
    const order = sessionOrders[sessionId] || [];
    const total = calculateTotal(order).toFixed(2);
  
    if (order.length === 0) {
      return "You haven’t added anything to your order just yet. Let me know when you're ready to begin!";
    }
  
    const orderHTML = order.map(i =>
      `<li>${i.quantity} × <strong>${i.name}</strong> - $${(i.price * i.quantity).toFixed(2)}</li>`
    ).join('');
  
    return `
  <h3>Your Current Order</h3>
  <ul style="padding-left: 1em;">
    ${orderHTML}
  </ul>
  <p><strong>Total:</strong> $${total}</p>
  <p>Let me know if you'd like to add, change, or remove anything!</p>
    `.trim();
  }
  
  
  if (!sessionOrders[sessionId]) sessionOrders[sessionId] = [];

  let combinedSummary = '';
  
  // Check for common finalization phrases before attempting to modify the order
  const donePhrases = ["finished", "that's all", "that is all", "done", "i'm done", "that finishes my order", "that's it"];
  if (donePhrases.some(p => userPrompt.toLowerCase().includes(p))) {
    const order = sessionOrders[sessionId] || [];
    const total = calculateTotal(order).toFixed(2);
    const summary = `
  Thanks for your order! Here's what I have:
  
  ${formatOrder(order)}
  
  Your total is $${total}. Would you like anything else?
    `.trim();
    return await rephraseWithCohere(summary, order, total);
  }
// Process each clause for additions, removals, or replacements. Parsing rules expect commas for three or more items, and a conjunction like and for two item orders.
let clauses = [];

const hasComma = userPrompt.includes(',');
const hasAnd = /\band\b/i.test(userPrompt);
const isLikelyModifier = /\b(no|without|with)\b/i.test(userPrompt);

if (hasComma) {
  // Multi-item: split on commas and sentence enders
  clauses = userPrompt
    .split(/(?:,|[.?!/]+)/)
    .map(c => c.trim())
    .filter(Boolean);
} else if (hasAnd && !isLikelyModifier) {
  // Two-item list: split only if "and" is not part of a modifier clause
  clauses = userPrompt
    .split(/\band\b/i)
    .map(c => c.trim())
    .filter(Boolean);
} else {
  // One full sentence or modifier-based clause
  clauses = userPrompt
    .split(/[.?!/]+/)
    .map(c => c.trim())
    .filter(Boolean);
}
// Map these as the new clauses
clauses = clauses.map(c => c.replace(/^and\s+/i, "").trim());

    
  let currentOperation = null;

  for (const clause of clauses) {
    const lowered = clause.toLowerCase();

    // Update current operation if a new keyword is found
    if (lowered.includes("remove") || lowered.includes("delete") || lowered.includes("i don't want") || lowered.includes("get rid of")) {
      currentOperation = "remove";
    } else if (lowered.includes("replace") || lowered.includes("change") || lowered.includes("instead")) {
      currentOperation = "replace";
    } else if (lowered.includes("add") || lowered.includes("i want a") || lowered.includes("i'd like a") || lowered.includes("i would like a") || lowered.includes("can i get a") || lowered.includes("give me a") || lowered.includes("could i get a")) {
      currentOperation = "add";
    }

    // Try to detect quantity-item pairs like "2 sweet teas"
    const quantityMatches = [...clause.matchAll(/\b(\d+)\s+([a-zA-Z\s/'\-]+?)(?=(?:,|and|\.|$))/gi)];
    const manualItems = [];

    for (const match of quantityMatches) {
      const qty = parseInt(match[1]);
      const phrase = match[2].trim();
      const found = extractOrderItems(phrase, qty); 
      if (found.length > 0) {
        manualItems.push(found[0]);
      }
    }
    

    // Handle based on the current operation (remove in this case)
    if (currentOperation === "remove") {
      const targets = manualItems.length > 0 ? manualItems : extractOrderItems(clause);
      const removed = removeItems(sessionId, targets);      
      if (removed.length > 0) {
        combinedSummary += `Removed:\n${formatOrder(removed)}\n\n`;
      } else {
        combinedSummary += `Could not find any items to remove in: "${clause}"\n\n`;
      }
      // Handle replace operation
    } else if (currentOperation === "replace") {
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

    } else { // Assume add operation otherwise
      let newItems = manualItems.length > 0 ? manualItems : extractOrderItems(clause);
      if (newItems.length > 0) {
        updateOrder(sessionId, newItems);
        combinedSummary += `Added:\n${formatOrder(newItems)}\n\n`;
      } else {
        combinedSummary += `Didn't recognize any items in: "${clause}"\n\n`;
      }
    }
  }

  // Store order by session ID alongside their total
  const currentOrder = sessionOrders[sessionId];
  const total = calculateTotal(currentOrder).toFixed(2);
  return await rephraseWithCohere(combinedSummary.trim(), currentOrder, total);
};
module.exports = { generateText };
