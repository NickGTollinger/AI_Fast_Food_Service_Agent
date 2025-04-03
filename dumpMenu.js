const { MongoClient } = require('mongodb');
const fs = require('fs');
require('dotenv').config();

async function dumpCollectionToFile() {
  const client = new MongoClient(process.env.MONGO_URI);

  try {
    await client.connect();
    const db = client.db("canes_database");
    const collection = db.collection("menu_items");

    const allItems = await collection.find({}).toArray();

    // Write to file
    fs.writeFileSync('menu_dump.json', JSON.stringify(allItems, null, 2));
    console.log(`menu_items collection saved to menu_dump.json (${allItems.length} items)`);

    await client.close();
  } catch (err) {
    console.error("Error dumping menu_items:", err.message);
  }
}

dumpCollectionToFile();
