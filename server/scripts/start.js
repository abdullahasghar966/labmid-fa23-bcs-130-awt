// One command runs everything and prints ONE link:
//   npm start     ->  PostgreSQL + API + React app on http://localhost:4000
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureEnvFile } from './setup.js';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const rootDir = path.resolve(serverDir, '..');
const clientDir = path.join(rootDir, 'client');
const step = (msg) => console.log(`\n> ${msg}`);

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// 1. Packages
for (const dir of [serverDir, clientDir]) {
  if (!existsSync(path.join(dir, 'node_modules'))) {
    step(`Installing packages in ${path.basename(dir)}/ (first run only)…`);
    const r = spawnSync('npm install', { cwd: dir, stdio: 'inherit', shell: true });
    if (r.status !== 0) fail('npm install failed.');
  }
}

// 2. Settings file
if (ensureEnvFile()) console.log('Created server/.env (test mode). Run "npm run setup" to add Google sign-in.');
const { config, hasClientBuild } = await import('../src/config.js');

// 3. Database (the bundled PostgreSQL, unless DATABASE_URL points somewhere else)
let db = { stop: async () => {} };
const { LOCAL_DB_URL, startLocalDb } = await import('./local-db.js');
if (config.databaseUrl === LOCAL_DB_URL) {
  step('Starting PostgreSQL…');
  try {
    db = await startLocalDb();
  } catch (err) {
    fail(err.message);
  }
}

// 4. Build the React app (skip with --no-build)
if (!process.argv.includes('--no-build') || !hasClientBuild()) {
  step('Building the React app…');
  const r = spawnSync('npm run build --silent', { cwd: clientDir, stdio: 'inherit', shell: true });
  if (r.status !== 0) fail('React build failed.');
}

// 5. API + app on one port
step('Starting the API…');
const { createApp } = await import('../src/app.js');
const url = `http://localhost:${config.port}`;
const server = createApp().listen(config.port);

server.on('error', async (err) => {
  await db.stop().catch(() => {});
  if (err.code === 'EADDRINUSE') {
    fail(`Port ${config.port} is busy - is the app already running in another window? Close it, or set PORT in server/.env.`);
  }
  fail(err.message);
});

server.on('listening', () => {
  const mode = config.firebase.web ? 'Google sign-in' : 'TEST MODE (type any email; admin@test.edu = admin)';
  console.log(`
==============================================================
  Lab Equipment Loans is running

  Open:   ${url}

  Login:  ${mode}
  Live updates: ${config.firebase.web && config.firebase.databaseURL ? 'on' : 'off (needs Firebase)'}
  Stop:   Ctrl+C
==============================================================
`);
  if (!process.argv.includes('--no-open') && !process.env.NO_OPEN) {
    const opener =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
});

const shutdown = async () => {
  server.close();
  await db.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
