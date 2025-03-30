const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
  try {
    await client.connect();
    return client.db("canes_database"); 
  } catch (err) {
    console.error("Failed to connect to database", err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
