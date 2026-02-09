# Repository Guidelines

## Project Structure & Module Organization
Trainbook is a single Node server with a Vite-built UI:
- `src/` React UI code
- `server/` Express API (`server/index.js`)
- `tests/` Vitest suites for API/UI utilities
- `scripts/` development helper assets (for example, committed seed exports)
- `db/` local SQLite files (ignored by git)
- `data/` Docker-mounted SQLite data
- `public/` static assets served by Vite (favicons/PWA)
- `docs/` roadmap tracker and release/runbook documentation
- `.devcontainer/` development container configuration (Node 22, forwarded ports)
- `.github/` CI workflows for automated test/build validation
- `index.html`, `vite.config.js`, `package.json` at repo root

If you add a new top-level directory, update this section with a one-line purpose.

## Build, Test, and Development Commands
- `npm install` install dependencies
- `npm run dev` run Vite and the API in parallel
- `npm test` run Vitest API/UI suites
- `npm run build` build the UI to `dist/`
- `npm run preview` preview the UI build
- `npm run start` serve the API and built UI from one process
- `docker compose up --build` build and run the Docker image

The Vite dev server proxies `/api` to `http://localhost:4286` by default (override with `VITE_API_TARGET`).

## Coding Style & Naming Conventions
Keep formatting consistent and easy to scan:
- Indentation: 2 spaces for JS/TS/JSON/YAML/CSS; 4 spaces for scripts; tabs only in Makefiles.
- File and directory names: `kebab-case` (e.g., `session-card.jsx`).
- Types/components: `PascalCase` (e.g., `WorkoutCard.jsx`).
- Variables/functions: `camelCase`; constants: `UPPER_SNAKE_CASE`.

If a formatter or linter is added (e.g., Prettier, ESLint), run it before opening a PR and note deviations.

## Testing Guidelines
- Place tests under `tests/` and mirror `src/` paths.
- Use `*.test.jsx` (or language-appropriate equivalents) for test files.
- New features should include tests or a short PR note explaining why coverage is deferred.
- Run tests when building new features (`npm test`); call out if tests were not run.
- Keep tests offline and fast: avoid network calls and long sleeps.

## Commit & Pull Request Guidelines
Use Conventional Commits going forward:
- Examples: `feat: add workout stats`, `fix: handle empty sessions`, `docs: update README`
- Agents should make commits as needed to keep changes small and reviewable.
- Agents should auto-commit completed work by default (after implementing and verifying changes), unless the user explicitly asks not to commit.

PRs should include a short summary, linked issue (if any), test steps, and UI screenshots for visual changes. Note any migration or data-impacting changes explicitly.

## Documentation
Keep `README.md` in sync with user-facing behavior, feature lists, and configuration defaults whenever changes are made.

## Security & Configuration
Store configuration in `.env` files and provide a `.env.example` when adding new variables. Never commit secrets; prefer environment variables or Docker secrets in deployment.
