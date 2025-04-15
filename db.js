const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
dotenv.config();

// Use the MONGO_URI from environment variables or fall back to a default string
const uri = process.env.MONGO_URI="mongodb+srv://dbUser:dbUser@databasecluster.cxgvj.mongodb.net/?retryWrites=true&w=majority&appName=DatabaseCluster"
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    return client.db("canes_database");
  } catch (err) {
    console.error("Failed to connect to database", err.message);
    process.exit(1);
  }
}

// Helper to get the "user-information" collection
async function getUserCollection() {
  const db = await connectDB();
  return db.collection("user-credentials and information");
}

module.exports = { connectDB, getUserCollection };
