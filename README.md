# Trainbook

Trainbook is a self-hosted strength training log designed for fast, satisfying workout tracking. It runs on the same stack as Episodely: React + Vite on the frontend, Express + SQLite on the backend, and Docker for deployment.

## Features
- Multi-user accounts with password auth
- Track routines, exercises, sessions, sets, reps, and bodyweight
- Mobile-first logging flow for quick set entry
- Stats overview with weekly volume and PRs
- JSON import/export for backups
- PWA-ready for iPhone home screen installs

## Stack
- UI: React + Vite
- Backend: Node.js + Express
- Storage: SQLite

## Quick Start (Local)
Requirements: Node.js 22+

- `npm install`
- `npm run dev` starts Vite (web) and the Express API together
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
- `db/` SQLite database files (local only)
- `data/` Docker volume mount for SQLite
- `vite.config.js` Vite config and API proxy
- `server/seed-exercises.json` default exercise seed list

## Import and Export
Exports are JSON backups (Settings → Export JSON). Imports accept the same
format and merge data into the current account.

## License
See `LICENSE`.
