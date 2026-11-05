require("dotenv").config();

const { Pool } = require("pg");
const { createDatabaseOptions } = require("./databaseOptions");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file.");
}

const pool = new Pool(createDatabaseOptions());

module.exports = pool;
