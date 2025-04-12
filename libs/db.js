import pg from 'pg';
const { Pool } = pg;

// Railway provides DATABASE_URL, not POSTGRES_URL
const connectionString = process.env.DATABASE_URL;


if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is missing');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  },
  // Add connection limits
  max: 5,
  idleTimeoutMillis: 30000
});

/*
// lib/db.js
import pg from 'pg';
const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});*/

// Test connection
pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully');
  }
});

export default {
  async query(text, params) {
    try {
      const res = await pool.query(text, params);
      return res;
    } catch (err) {
      console.error('Database error:', err);
      throw err;
    }
  },
  
  // Transaction helper
  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
};