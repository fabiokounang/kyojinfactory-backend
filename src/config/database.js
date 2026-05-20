const mysql = require('mysql2/promise');

const path = require('path');
const env = require('./env');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const opts = {
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
}

if (process.env.NODE_ENV === 'production') {
  opts.ssl = {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
  };
}

const pool = mysql.createPool(opts);

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

module.exports = { pool, ping };
