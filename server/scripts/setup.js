// Setup wizard: creates/updates server/.env by asking a few questions.
//   npm run setup        (installs packages, then runs this)
//   npm run configure    (only this wizard)
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline/promises';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const envPath = path.join(serverDir, '.env');
const examplePath = path.join(serverDir, '.env.example');

export function ensureEnvFile() {
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    return true;
  }
  return false;
}

const readEnv = () => readFileSync(envPath, 'utf8');
const getValue = (text, key) => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
function setValue(text, key, value) {
  const line = `${key}=${value}`;
  return new RegExp(`^${key}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${text.trimEnd()}\n${line}\n`;
}

async function wizard() {
  const created = ensureEnvFile();
  console.log(created ? '\nCreated server/.env' : '\nUpdating server/.env');

  if (!process.stdin.isTTY) {
    console.log('(No terminal input - kept defaults. Run "npm run configure" later to set up Google sign-in.)');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question, fallback = '') => {
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
    return answer || fallback;
  };
  const yes = async (question, def) => {
    const a = (await ask(`${question} (${def ? 'Y/n' : 'y/N'})`)).toLowerCase();
    return a ? a.startsWith('y') : def;
  };

  let env = readEnv();

  console.log('\n--- Admin ---');
  const currentAdmins = getValue(env, 'ADMIN_EMAILS');
  const gmail = await ask('Your Gmail address (it becomes ADMIN; leave empty to skip)');
  if (gmail) {
    const admins = new Set(currentAdmins.split(',').map((s) => s.trim()).filter(Boolean));
    admins.add(gmail.toLowerCase());
    env = setValue(env, 'ADMIN_EMAILS', [...admins].join(','));
  }

  console.log('\n--- Google sign-in + live updates (Firebase) ---');
  console.log('Follow README section "Firebase setup" first (about 10 minutes, free).');
  if (await yes('Do you have your Firebase values ready?', false)) {
    const projectId = await ask('Project ID', getValue(env, 'FIREBASE_PROJECT_ID'));
    env = setValue(env, 'FIREBASE_PROJECT_ID', projectId);
    env = setValue(env, 'FIREBASE_API_KEY', await ask('apiKey', getValue(env, 'FIREBASE_API_KEY')));
    env = setValue(
      env,
      'FIREBASE_AUTH_DOMAIN',
      await ask('authDomain', getValue(env, 'FIREBASE_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`),
    );
    env = setValue(env, 'FIREBASE_APP_ID', await ask('appId', getValue(env, 'FIREBASE_APP_ID')));
    env = setValue(
      env,
      'FIREBASE_DATABASE_URL',
      await ask(
        'Realtime Database URL',
        getValue(env, 'FIREBASE_DATABASE_URL') || `https://${projectId}-default-rtdb.firebaseio.com`,
      ),
    );

    const target = path.join(serverDir, 'service-account.json');
    const keyFile = (await ask('Path to the downloaded service-account key (.json)', existsSync(target) ? target : ''))
      .replace(/^["']|["']$/g, '');
    if (keyFile && path.resolve(keyFile) !== target) {
      if (existsSync(keyFile)) {
        copyFileSync(keyFile, target);
        console.log('Copied the key to server/service-account.json');
      } else {
        console.log(`! File not found: ${keyFile} - copy it to server/service-account.json yourself.`);
      }
    }
    env = setValue(env, 'FIREBASE_SERVICE_ACCOUNT_PATH', './service-account.json');

    const keepTest = await yes('Also keep the test login box (no Google needed)? Turn this off for the real demo', false);
    env = setValue(env, 'AUTH_DEV_BYPASS', keepTest ? 'true' : 'false');
  } else {
    console.log('Skipped. The app runs in TEST MODE: log in by typing any email (admin@test.edu = admin).');
    env = setValue(env, 'AUTH_DEV_BYPASS', 'true');
  }

  rl.close();
  writeFileSync(envPath, env);
  console.log('\nSaved server/.env. Now run:  npm start\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  wizard().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
