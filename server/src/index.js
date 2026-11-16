// Production entry point (Render / Docker). Locally, `npm start` in the root runs scripts/start.js.
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { ensureSchema } from './migrate.js';

await ensureSchema();
const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Lab Loans API listening on port ${config.port}`);
  if (config.devAuthBypass) {
    console.warn('AUTH_DEV_BYPASS is ON - "Bearer dev:<email>" tokens are accepted. Testing only!');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
