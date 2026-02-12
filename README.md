# Trainbook

[![CI](https://github.com/keenfann/trainbook/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/keenfann/trainbook/actions/workflows/ci.yml)

Trainbook is a self-hosted strength training log designed for fast, satisfying workout tracking. It runs on the same stack as Episodely: React + Vite on the frontend, Express + SQLite on the backend, and Docker for deployment.

## Features
- Multi-user accounts with password auth
- Shared exercise catalog with archive, unarchive, merge, and impact confirmation
- External exercise library search/add flow backed by `keenfann/free-exercise-db` snapshot data
- Routine builder with create/edit/delete, duplicate, explicit exercise reorder, superset pairing, per-exercise rest/band targets, and routine types (`standard` / `rehab`)
- Mobile-first guided workout logging with preview -> one-screen exercise checklist -> auto-start next exercise on finish/skip
- In-workout next-target weight adjuster (`- / value / +`) for weighted exercises with immediate routine target updates
- In-workout exercise detail quick view (icon-only action) with image, instructions, and movement metadata
- Timestamped workout progress (session start/end, exercise start/complete, set start/complete) with duration insights
- Workout logging with set add/edit/delete, undo delete, and workout detail editing
- Bodyweight logging with trend summaries
- Analytics for overview, progression, interactive weekly/monthly trend charts (with regression + moving-average overlays), drill-down volume/frequency distribution by muscle -> exercise, and bodyweight trend, including routine-type filtering (`standard` / `rehab` / `all`)
- iOS-inspired motion system with directional page transitions, animated modals/cards, and accessibility-focused motion controls (`System` / `Reduced` / `Full`)
- Two-step import flow (validate -> confirm) with strict payload version checks
- Offline mutation queue with idempotent batch sync replay (`/api/sync/batch`)
- PWA install support with service worker runtime caching

## Stack
- UI: React + Vite
- Backend: Node.js + Express
- Storage: SQLite

## CI/CD and Releases
- Pull requests and pushes to `main` run verification (`npm ci`, `npm test`, `npm run build`).
- Pushes to `main` also build and publish `ghcr.io/keenfann/trainbook`.
- Docker tags published from `main`: `latest`, `main`, `v<packageVersion>.<run_number>`, and `sha-<shortsha>`.
- A GitHub release is created automatically for each `main` push using tag `v<packageVersion>.<run_number>` with generated release notes.

## Quick Start (Local)
Requirements: Node.js 22+

- `npm install`
- `npm run dev` starts Vite (web) and the Express API together
- `npm run dev:codex` starts a headless-friendly dev stack for Codex Web (no browser auto-open, no file watching)
- `npm test` runs API + UI tests (Vitest)
- `npm run build` builds the UI to `dist/`
- `npm run start` serves the API and the built UI from one process
- `npm run start:codex` builds and serves the app in one command for screenshot tooling

The API is available at `http://localhost:4286/api/health` during development.
The API binds to `0.0.0.0:4286` by default (`HOST`), and Vite listens on `0.0.0.0:5173` by default. Override with
`VITE_HOST`, `VITE_PORT`, and `VITE_API_TARGET` in `.env` if needed.

## Codex Web Startup/Screenshots
Use one of these start commands in Codex Web:

- `npm run dev:codex` for development screenshots (Vite on `0.0.0.0:5173`, API on `0.0.0.0:4286`)
- `npm run start:codex` for production-style screenshots from the built app (`:4286`)

If you need authenticated screenshots without manual login, set:

```bash
DEV_AUTOLOGIN=true
DEV_AUTOLOGIN_ALLOW_REMOTE=true
DEV_SEED_PATH=./scripts/seed-export.json
```

## Dev Container
This repo includes a `.devcontainer/` setup pinned to Node.js 22 with ports
5173 (Vite) and 4286 (API) forwarded. The container sets `VITE_HOST=0.0.0.0`
and disables auto-opening the browser for headless workflows.

## Quick Start (Docker)
- `docker compose up`
- Visit `http://localhost:4286`

Set `DB_PATH` in `compose.yaml` or a `.env` file (see `.env.example`). The server
creates a session secret on first start. Sessions are stored in SQLite, so
logins persist across restarts as long as `DB_PATH` points to durable storage.
Auth session cookies are persistent for 30 days.

### Compose Sample
Use `/compose.sample.yml` as a reference for deploying the published GHCR image:

- `docker compose -f compose.sample.yml up -d`

## Project Structure
- `src/` React UI
- `server/` Express API
- `server/resources/` local exercise-library snapshot data
- `server/scripts/` maintenance scripts (including library sync)
- `scripts/` development helper assets (including sample export seed)
- `tests/` Vitest coverage for API and UI flows
- `db/` SQLite database files (local only)
- `data/` Docker volume mount for SQLite
- `public/` static assets and service worker
- `docs/` implementation and release documentation
- `vite.config.js` Vite config and API proxy
- `server/seed-exercises.json` default exercise seed list

## Import and Export
Exports are JSON backups (Settings -> Export JSON). Import is a two-step flow:
1. Validate selected JSON (`POST /api/import/validate`) to inspect adds/reuse/skips/conflicts.
2. Confirm import (`POST /api/import`) to apply the payload.

Import is idempotent for exact matches: existing exercises (by name) and identical routines/sessions/bodyweight entries are reused instead of duplicated.

Import payloads support schema versions `3`, `4`, `5`, `6`, and `7`. New exports are generated as `version: 7`.

In addition to manual JSON export, the server performs automatic full-database exports to disk:
- cadence: once every 7 days
- retention: keep 365 days, automatically delete older export files
- default output path: `<dirname(DB_PATH)>/exports`

Automatic export behavior can be configured with environment variables:
- `AUTO_EXPORT_ENABLED` (default `true`)
- `AUTO_EXPORT_DIR` (optional override for export directory)
- `AUTO_EXPORT_INTERVAL_DAYS` (default `7`)
- `AUTO_EXPORT_RETENTION_DAYS` (default `365`)
- `AUTO_EXPORT_CHECK_INTERVAL_MINUTES` (default `60`)

## Exercise Library
Trainbook stores exercise metadata aligned to the fork model (`forkId`, `force`, `level`, `mechanic`, `equipment`, `primaryMuscles`, `secondaryMuscles`, `instructions`, `category`, `images`) while keeping local relational IDs for routines/sessions.

Use `npm run sync:exercise-library` to refresh `/server/resources/exercisedb-library.json`.

### Exercise Data Model
The `exercises` table stores local relational identity plus fork-aligned metadata:

- Relational fields: `id`, `name`, `notes`, `merged_into_id`, `merged_at`, `archived_at`, `created_at`, `updated_at`
- External/fork fields: `fork_id`, `force`, `level`, `mechanic`, `equipment`, `category`
- Array fields stored as JSON text: `primary_muscles_json`, `secondary_muscles_json`, `instructions_json`, `images_json`

`fork_id` is unique when present, and `name` is globally unique in the catalog.

### Fetch from External Source
Refresh the local snapshot from the external source with:

- `npm run sync:exercise-library`

The sync script tries `keenfann/free-exercise-db` first and falls back to `yuhonas/free-exercise-db` if needed. Snapshot metadata (`provider`, `etag`, `generatedAt`) is written to `server/resources/exercisedb-library.json`.

### Seed Instructions
Exercise seed behavior runs automatically on server startup (`npm run dev` or `npm run start`):

1. Seed defaults from `server/seed-exercises.json` (`INSERT OR IGNORE` by `name`).
2. Backfill fork metadata for rows without `fork_id` using `server/resources/exercisedb-library.json`.

Because seed inserts are `INSERT OR IGNORE`, existing exercise rows are not overwritten. To re-seed from scratch, start with a fresh DB file (for example, by pointing `DB_PATH` to a new SQLite file).

For full dev-data seeding (exercises/routines/sessions/weights from an export payload), set `DEV_SEED_PATH`:

- `DEV_SEED_PATH=./path/to/export.json npm run dev`

For Codex web or non-local dev hosts, you can explicitly allow dev autologin and use the committed sample export:

```bash
DEV_AUTOLOGIN=true
DEV_AUTOLOGIN_ALLOW_REMOTE=true
DEV_SEED_PATH=./scripts/seed-export.json
```

## Offline Sync
Trainbook queues supported mutations in IndexedDB when the browser is offline and replays them to `POST /api/sync/batch` when connectivity returns. Sync operations are idempotent via client operation IDs persisted in `sync_operations`.

## Migrations and Upgrades
Database migrations run automatically at server startup and are tracked in `schema_migrations`. Always back up SQLite before upgrading. Use the release checklist in `docs/release-checklist.md`.

## Release Checklist
Operational release steps (backup, migration verification, smoke tests, rollback notes) are documented in `docs/release-checklist.md`.

## License
See `LICENSE`.
