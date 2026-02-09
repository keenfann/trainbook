# Trainbook

Trainbook is a self-hosted strength training log designed for fast, satisfying workout tracking. It runs on the same stack as Episodely: React + Vite on the frontend, Express + SQLite on the backend, and Docker for deployment.

## Features
- Multi-user accounts with password auth
- Shared exercise catalog with archive, unarchive, merge, and impact confirmation
- External exercise library search/add flow backed by `keenfann/free-exercise-db` snapshot data
- Routine builder with create/edit/delete, duplicate, explicit exercise reorder, superset pairing, and per-exercise rest/band targets
- Mobile-first guided workout logging with preview -> focused exercise flow -> superset auto-alternation -> explicit next exercise progression
- In-workout exercise detail quick view (icon-only action) with image, instructions, and movement metadata
- Timestamped workout progress (session start/end, exercise start/complete, set start/complete) with duration insights
- Workout logging with set add/edit/delete, undo delete, and workout detail editing
- Bodyweight logging with trend summaries
- Analytics for overview, progression, interactive weekly/monthly trend charts (with regression + moving-average overlays), volume/frequency distribution, and bodyweight trend
- iOS-inspired motion system with directional page transitions, animated modals/cards, and accessibility-focused motion controls (`System` / `Reduced` / `Full`)
- Two-step import flow (validate -> confirm) with strict payload version checks
- Offline mutation queue with idempotent batch sync replay (`/api/sync/batch`)
- PWA install support with service worker runtime caching

## Stack
- UI: React + Vite
- Backend: Node.js + Express
- Storage: SQLite

## Quick Start (Local)
Requirements: Node.js 22+

- `npm install`
- `npm run dev` starts Vite (web) and the Express API together
- `npm test` runs API + UI tests (Vitest)
- `npm run build` builds the UI to `dist/`
- `npm run start` serves the API and the built UI from one process

The API is available at `http://localhost:4286/api/health` during development.
The Vite dev server listens on `localhost:5173` by default. Override with
`VITE_HOST`, `VITE_PORT`, and `VITE_API_TARGET` in `.env` if needed.

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

## Project Structure
- `src/` React UI
- `server/` Express API
- `server/resources/` local exercise-library snapshot data
- `server/scripts/` maintenance scripts (including library sync)
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

Import payloads support schema versions `3`, `4`, `5`, and `6`. New exports are generated as `version: 6`.

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

## Offline Sync
Trainbook queues supported mutations in IndexedDB when the browser is offline and replays them to `POST /api/sync/batch` when connectivity returns. Sync operations are idempotent via client operation IDs persisted in `sync_operations`.

## Migrations and Upgrades
Database migrations run automatically at server startup and are tracked in `schema_migrations`. Always back up SQLite before upgrading. Use the release checklist in `docs/release-checklist.md`.

## Release Checklist
Operational release steps (backup, migration verification, smoke tests, rollback notes) are documented in `docs/release-checklist.md`.

## License
See `LICENSE`.
