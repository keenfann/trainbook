# Trainbook

Trainbook is a self-hosted strength training log designed for fast, satisfying workout tracking. It runs on the same stack as Episodely: React + Vite on the frontend, Express + SQLite on the backend, and Docker for deployment.

## Features
- Multi-user accounts with password auth
- Shared exercise catalog with archive, unarchive, merge, and impact confirmation
- Routine builder with create/edit/delete, duplicate, and explicit exercise reorder
- Session logging with set add/edit/delete, undo delete, and session detail editing
- Bodyweight logging with trend summaries
- Analytics for overview, progression, volume/frequency distribution, and bodyweight trend
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

Import payloads must match the current export schema version (`version: 3`).

## Offline Sync
Trainbook queues supported mutations in IndexedDB when the browser is offline and replays them to `POST /api/sync/batch` when connectivity returns. Sync operations are idempotent via client operation IDs persisted in `sync_operations`.

## Migrations and Upgrades
Database migrations run automatically at server startup and are tracked in `schema_migrations`. Always back up SQLite before upgrading. Use the release checklist in `docs/release-checklist.md`.

## Release Checklist
Operational release steps (backup, migration verification, smoke tests, rollback notes) are documented in `docs/release-checklist.md`.

## License
See `LICENSE`.
