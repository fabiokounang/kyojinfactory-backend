const app = require('./app');
const env = require('./config/env');
const { ping } = require('./config/database');

async function start() {
  try {
    await ping();
    console.log(`[db] Connected to ${env.db.host}:${env.db.port}/${env.db.database}`);
  } catch (err) {
    console.warn('[db] Connection check failed:', err.message);
    console.warn('[db] Server akan tetap berjalan; pastikan MySQL hidup & .env benar.');
  }

  app.listen(env.port, () => {
    console.log(`[api] Listening on http://localhost:${env.port}`);
  });
}

start();
