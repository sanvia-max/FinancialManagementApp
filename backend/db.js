const { Pool } = require('pg');
require('dotenv').config();

// Create database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error connecting to database:', err);
  }
  console.log('Connected to PostgreSQL database');
  release();
});

/**
 * Execute database query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
const query = (text, params) => pool.query(text, params);

module.exports = { query };