# Lab Equipment Loans — Lab-Mid (Advanced Web Technologies), Variant 0

Students browse **lab equipment** and book **loans**; staff manage equipment and move loans forward.
Booking more units than are left returns **409 Not enough units left**, and every change appears live
(`availability:changed`) without refreshing.

### 🌐 Live: <https://labmid-awt.onrender.com>

Sign in with Google. Your admin Gmail is **admin**; any other Google account starts as a **student**;
the admin makes someone **staff** in *Users & Roles*. Each browser tab keeps its own sign-in. (Free hosting sleeps after 15 minutes without visitors, so the first visit can take
about a minute to wake up.)

Stack (as in my infra diagram): **React → Nginx → Google Auth 2.0 (Firebase Auth) → Node/Express API → PostgreSQL + Firebase**.

See **[DESIGN.md](DESIGN.md)** for the full design: application diagram, infra, ERD, API contract,
RBAC matrix, real-time event catalogue, caching plan and where each rule is enforced.

---

## Quick start — one click, one link

Needs **Node.js 20+** (<https://nodejs.org>, LTS). Nothing else to install — PostgreSQL is bundled.

**Double-click `START.bat`**, or in a terminal in this folder:

```bash
npm start
```

It installs packages (first time only), starts PostgreSQL, builds the React app, starts the API and opens

### 👉 <http://localhost:4000>

Out of the box it runs in **test mode**: the login page has an email box, so you can try every role
without Google:

| Type this email | You are |
|---|---|
| `admin@test.edu` | admin (can promote others to staff in **Users & Roles**) |
| any other email, e.g. `ali@student.edu` | student |

Press **Ctrl+C** in the window to stop.

## Turn on Google sign-in + live updates (≈10 min, free)

1. Go to <https://console.firebase.google.com> → **Add project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
3. **Build → Realtime Database → Create database** → any location → *Start in locked mode*.
   Open the **Rules** tab, paste everything from `firebase/database.rules.json`, **Publish**.
4. **Project settings (⚙) → General → Your apps → Web (`</>`)** → register an app. Keep the
   `firebaseConfig` values on screen.
5. **Project settings → Service accounts → Generate new private key** → a `.json` file downloads.

Then run the setup wizard and answer its questions (it writes everything into `server/.env` and copies
the key file for you):

```bash
npm run configure
```

Say **no** to "keep the test login box" for the real demo, then `npm start` again.
Sign in with the Gmail you gave the wizard — you are admin. Any other Google account is a student;
promote a staff account in **Users & Roles**.

All settings live in **one file: `server/.env`** (template: `server/.env.example`).

## How the public site is hosted

| Part | Service |
|---|---|
| React app + Node API (one web service, built from `render.yaml`) | Render (free, Singapore) |
| PostgreSQL | Neon (free, Singapore) — tables are created on first start |
| Google sign-in + live events | Firebase (Auth + Realtime Database) |

Every `git push` to `main` redeploys automatically. Secrets (database URL, Firebase key) live only in
Render's environment settings, never in the repo. If the site ever gets a new domain, allow it for
Google sign-in with:

```bash
npm run firebase:sync -- --domain=new-domain.onrender.com
```

## Run the full infra with Docker (Nginx + API + PostgreSQL)

With `server/.env` and `server/service-account.json` in place:

```bash
docker compose up --build
```
Open <http://localhost:8080> — Nginx serves React and proxies `/api` to the Node API.

## Tests (all 7 rules)

With the app running (⚠ the test **wipes** the database and re-seeds it):

```bash
npm test
```
```
✔ auth: no token -> 401, admin from ADMIN_EMAILS, new users are students
✔ Rule 1: staff do full CRUD on equipment, students can only read
✔ Rule 6: equipment browsing is cached (HIT/MISS, ETag 304, invalidated on change)
✔ Rule 2 + 5: students book; not enough units left -> 409; then notify when available
✔ Rule 2: a student reads/cancels only their own loans
✔ Rule 3: staff list all loans and loans of one equipment via nested URI
✔ Rule 4: loans move forward only; Rule 7: live events reach the right people
✔ Rule 5 under load: parallel bookings never overbook
✔ Loan set by staff + how much loan paid
✔ availability changed or not, overview, error + event catalogues
```

Reset the sample data any time with `npm run db:reset` (then restart the app).

## Commands

| Command | What it does |
|---|---|
| `npm start` | Everything on <http://localhost:4000> and opens the browser |
| `npm run setup` | Install packages + run the setup wizard |
| `npm run configure` | Only the setup wizard (Google sign-in, admin email) |
| `npm test` | Run the rule tests |
| `npm run db:reset` | Wipe and re-seed the database |

## Demo script (for the viva)

Open the site in **two tabs** and sign in with a different Google account in each. Every tab keeps its
own sign-in (closing a tab signs that tab out), so one tab can be staff/admin and the other a student.

1. **Student** opens *Lab Equipment*, books all 5 *Soldering Station* units → green **Acceptance**.
2. In the **staff/admin** window the card changes to **0 / 5 left** instantly, and a toast says *New loan request* (Rule 7).
3. **Student** (or a second student) books 1 more → red **Rejection (409) Not enough units left** → **Notify me when available**.
4. **Staff** → *All Loans* → **Confirm** → student sees the toast *now confirmed* (only that student gets it).
5. **Staff** → *Payments* → set loan amount 1000, record 400 → student sees *400 paid, 600 remaining*. Try 700 → 409.
6. **Staff** → **Complete** → units go back to 5 / 5 for everyone, and the waiting student gets *available again*.
7. Edit a quantity below the units on loan → 409 (capacity).
8. *Overview* tab: the interconnection API, cache hits/misses, the Error API table and the event catalogue.

Steps 2, 4 and 6 (live toasts) need Google sign-in turned on; in test mode, refresh to see others' changes.

## Project layout

```
START.bat    double-click to run
client/      React app (Vite)
server/      Node.js + Express API, scripts (start, setup wizard, database), tests
database/    schema.sql (tables, forward-only trigger) + seed.sql
firebase/    Realtime Database security rules
nginx/       Nginx config + Dockerfile (serves React, proxies /api)
docker-compose.yml   whole stack in one command
```

## Troubleshooting

- **"Port 4000 is busy"** — the app is already running in another window; use that one or close it.
- **PostgreSQL "could not load its files"** — the folder path is too long for Windows; move the project
  to a shorter path such as `D:\lab-mid\`.
- **Google popup says "unauthorized domain"** — Firebase → Authentication → Settings → Authorized domains →
  add the domain you opened the app on (`localhost` is there by default).
