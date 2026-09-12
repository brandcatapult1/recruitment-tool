# Recruitment Operations Tool

Internal HR/TA system per `prd.md` (v1). Built module by module; **M0–M2** are implemented
(foundation, campaign/department setup, public apply page). The product name in the UI is
**Brand Catapult — HR Pulse**.

There is no manual setup. The app is deployed by connecting the GitHub repo to a host (Render for
development, Hostinger Cloud for production per PRD §13.2). On every boot the server:

1. **Applies any pending database migrations** from `migrations/`, skipping ones already applied,
   and logs each file it runs (`[migrate] apply/skip ...`). A Postgres advisory lock prevents two
   booting instances from migrating at the same time. If a migration fails, startup aborts so a
   broken schema never serves traffic.
2. **Reconciles the admin login** with the `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`
   environment variables. If no admin exists it creates one. If the admin exists but its password
   differs from `ADMIN_PASSWORD`, it resets the password and logs that it did — so **changing
   `ADMIN_PASSWORD` in the host dashboard and redeploying is how you reset a forgotten admin
   password**. If `ADMIN_PASSWORD` is not set, stored passwords are never touched.
3. Starts the web server.

## Stack

- Node.js + TypeScript + Express, server-rendered EJS views
- Postgres on Neon (`pg`, plain SQL migrations in `migrations/`)
- Sessions in Postgres — the app server is stateless per PRD §13.1
- Cloudinary for candidate files (signed, authenticated, `raw`; helpers only in M0 — upload UI arrives in M2)

## Deploying (Render, development environment)

In the Render dashboard, create a **Web Service** connected to this repo's `dev` branch and set:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |

Then add the environment variables below in the service's **Environment** tab and deploy. Watch the
deploy log for the `[migrate]` and `[bootstrap]` lines, then sign in with the admin email and
password you configured.

### Environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **`dev` branch** pooled connection string (PRD §13.2: schema changes always reach `dev` before `main`) |
| `SESSION_SECRET` | Any long random string |
| `APP_BASE_URL` | The service's public URL |
| `CAREERS_BASE_URL` | Optional. Candidate-facing base for apply links. Until set, apply links use `APP_BASE_URL` |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin login, used only until an admin exists |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` / `CLOUDINARY_FOLDER` | **Required before this deploy.** On Render set `CLOUDINARY_FOLDER` to `dev/hr-pulse`. Every apply submission uploads a CV; if these four are missing, submissions fail. |

Production (Hostinger Cloud, `main` branch, Neon `main` branch) is configured the same way, plus
`NODE_ENV=production`. Because nothing is stored on the app server, moving between hosts is a
configuration change, not a migration (PRD §13.3).

## Adding a schema change (for future modules)

Add a new numbered file to `migrations/` (e.g. `0002_....sql`) and push. The next deploy applies it
automatically — to the dev environment first, always, per PRD §13.2. Never edit an already-applied
migration file; applied files are tracked by name in the `_migrations` table.

## Project layout

| Path | Purpose |
|---|---|
| `src/constants.ts` | The single enumerations module (PRD §6). Every dropdown and validation reads from it. |
| `migrations/0001_init.sql` | All eight tables per PRD §5, CHECK constraints mirroring §6, append-only trigger on `event`, session table. |
| `migrations/0002_m1_campaign_setup.sql` | Unique campaign-question pairing, select-options check, campaign status index. |
| `migrations/0003_m1_departments.sql` | Department table, seed list, campaign.department_id, job description, public salary flag. |
| `migrations/0004_m2_apply.sql` | Apply capture fields, one application per person per campaign, honeypot audit log. |
| `src/snapshots.ts` | R5: build and read helpers. Qualifiers and dimensions come from the department. |
| `src/campaigns/` | Campaign CRUD, source variant URLs (R6: unknown source → `other`). |
| `src/departments/` | Admin-only department CRUD and apply-question builder. |
| `src/apply/` | Phone normalisation and application submit transaction. |
| `src/questions/`, `src/routes/questions.ts` | Question bank. Deactivate, never delete. |
| `src/routes/campaigns.ts` | Campaign form, question builder, source links. |
| `src/db/migrate.ts` | Startup migration runner (idempotent, advisory-locked). |
| `src/bootstrap.ts` | Startup first-admin creation (idempotent). |
| `src/events.ts` | `writeEvent()` — the only path by which events are created. |
| `src/files/cloudinary.ts` | Signed upload / authenticated delivery / deletion helpers per PRD §13.4. No UI yet. |
| `src/auth/` | Email+password auth, Postgres-backed sessions, `requireLogin` / `requireRole` middleware. |
| `src/staff/`, `src/routes/staff.ts` | Staff CRUD, Admin only. Deactivation preserves historical attribution. |
| `src/routes/home.ts` | Home plus the Partner-only Leadership Overview route (dashboard itself is M8). |

## Access rules implemented (PRD §4, M0 acceptance criteria)

- `admin`, `recruiter`, `partner` can log in; `interviewer_no_login` exists as data only and is
  rejected at login even if credentials were somehow set.
- Staff management (`/staff/**`) and department setup (`/departments/**`) are Admin-only.
- Campaigns and the question bank are reachable by Admin, Recruiter and Partner.
- `/leadership` is Partner-only.
- Enumerations live in code (`src/constants.ts`); there is no enumeration-editing surface for any role.
- Deactivated staff are excluded from `listSelectableInterviewers()` (the future interviewer dropdown
  source) but remain referenced by historical records.

## Environments (PRD §13.2)

| Environment | Git branch | Host | Neon branch |
|---|---|---|---|
| Development | `dev` | Render | `dev` |
| Production | `main` | Hostinger Cloud | `main` |

Never point the dev environment at the production Neon branch. Confirm point-in-time restore is
enabled on the production Neon branch before launch (PRD §13.3).
