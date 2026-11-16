// Uses the service-account key (server/service-account.json) to:
//   1. publish firebase/database.rules.json to the Realtime Database
//   2. read the web app's config and write it into server/.env
//   3. optionally add an authorized domain for Google sign-in (--domain=myapp.onrender.com)
//   npm run firebase:sync [-- --domain=example.com]
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cert } from 'firebase-admin/app';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const rootDir = path.resolve(serverDir, '..');
const keyPath = path.join(serverDir, 'service-account.json');
const envPath = path.join(serverDir, '.env');

if (!existsSync(keyPath)) {
  console.error('server/service-account.json not found.');
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const projectId = key.project_id;
const { access_token: token } = await cert(key).getAccessToken();

async function call(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${url} -> ${res.status} ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

// 1. Realtime Database URL + rules
const dbURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const rules = readFileSync(path.join(rootDir, 'firebase', 'database.rules.json'), 'utf8');
await call(`${dbURL}/.settings/rules.json`, { method: 'PUT', body: rules });
console.log('✔ Published Realtime Database security rules');

// 2. Web app config
const apps = await call(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`);
const app = apps.apps?.[0];
if (!app) throw new Error('No web app registered in this Firebase project.');
const web = await call(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${app.appId}/config`);
console.log(`✔ Read web app config (${app.displayName})`);

if (!existsSync(envPath)) copyFileSync(path.join(serverDir, '.env.example'), envPath);
let env = readFileSync(envPath, 'utf8');
const set = (k, v) => {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${env.trimEnd()}\n${line}\n`;
};
set('FIREBASE_API_KEY', web.apiKey);
set('FIREBASE_AUTH_DOMAIN', web.authDomain);
set('FIREBASE_PROJECT_ID', web.projectId);
set('FIREBASE_APP_ID', web.appId);
set('FIREBASE_DATABASE_URL', web.databaseURL || dbURL);
set('FIREBASE_SERVICE_ACCOUNT_PATH', './service-account.json');
writeFileSync(envPath, env);
console.log('✔ Wrote Firebase settings to server/.env');

// 3. Authorized domain for Google sign-in
const domainArg = process.argv.find((a) => a.startsWith('--domain='));
if (domainArg) {
  const domain = domainArg.split('=')[1].replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cfgUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  const cfg = await call(cfgUrl);
  const domains = new Set(cfg.authorizedDomains ?? []);
  if (domains.has(domain)) {
    console.log(`✔ ${domain} is already an authorized domain`);
  } else {
    domains.add(domain);
    await call(`${cfgUrl}?updateMask=authorizedDomains`, {
      method: 'PATCH',
      body: JSON.stringify({ authorizedDomains: [...domains] }),
    });
    console.log(`✔ Added ${domain} to Google sign-in authorized domains`);
  }
}
