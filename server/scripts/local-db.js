// Runs a real PostgreSQL server from node_modules - no install needed.
// Data is kept in server/.pgdata
//   npm run db:local     (only the database; `npm start` in the root starts it for you)
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { resetDatabase } from './db-reset.js';

const dataDir = fileURLToPath(new URL('../.pgdata', import.meta.url));
export const LOCAL_DB_PORT = 5433;
const DB = 'lab_loans';
export const LOCAL_DB_URL = `postgres://postgres:password@localhost:${LOCAL_DB_PORT}/${DB}`;

async function isRunning() {
  const client = new pg.Client({ connectionString: LOCAL_DB_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export async function startLocalDb() {
  if (await isRunning()) {
    console.log(`PostgreSQL already running on port ${LOCAL_DB_PORT}.`);
    return { stop: async () => {} };
  }

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'password',
    port: LOCAL_DB_PORT,
    persistent: true,
    onLog: () => {},
  });

  // A half-created folder (e.g. a failed first run) is removed and created again.
  if (!existsSync(`${dataDir}/PG_VERSION`)) {
    rmSync(dataDir, { recursive: true, force: true });
    try {
      await server.initialise();
    } catch (err) {
      if (String(err.message).includes('3221225781') || String(err.message).includes('3221225734')) {
        throw new Error(
          'PostgreSQL could not load its files. Windows does this when the project folder path is very long - ' +
            'move the project to a shorter folder (for example D:\\lab-mid) and try again.',
        );
      }
      throw err;
    }
  }
  await server.start();

  const admin = new pg.Client({
    connectionString: `postgres://postgres:password@localhost:${LOCAL_DB_PORT}/postgres`,
  });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE ${DB}`);
    await resetDatabase({ connectionString: LOCAL_DB_URL });
    console.log('Created database "lab_loans" with tables and sample equipment.');
  }
  await admin.end();

  console.log(`PostgreSQL running on port ${LOCAL_DB_PORT}.`);
  return { stop: () => server.stop() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await startLocalDb();
  console.log(`Connection: ${LOCAL_DB_URL}\nPress Ctrl+C to stop.`);
  const stop = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
