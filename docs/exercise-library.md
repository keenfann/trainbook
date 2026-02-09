# Exercise Library

Trainbook supports external exercise lookup and one-click add from a local snapshot file:

- Snapshot: `/Users/keenfann/Documents/GitHub/trainbook/server/resources/exercisedb-library.json`
- Sync script: `/Users/keenfann/Documents/GitHub/trainbook/server/scripts/sync-exercisedb-library.mjs`
- NPM command: `npm run sync:exercise-library`

## Source and Fallback

The sync script first attempts to pull from:

- `keenfann/free-exercise-db` (`dist/exercises.json`)

If unavailable, it falls back to:

- `yuhonas/free-exercise-db` (`dist/exercises.json`)

The selected source is recorded in the snapshot `source` metadata.

## Model Mapping

Stored exercise metadata aligns to the fork-style model:

- `forkId`
- `name`
- `force`
- `level`
- `mechanic`
- `equipment`
- `primaryMuscles[]`
- `secondaryMuscles[]`
- `instructions[]`
- `category`
- `images[]` (relative paths)

In SQLite (`exercises` table), those arrays are persisted as JSON text columns:

- `primary_muscles_json`
- `secondary_muscles_json`
- `instructions_json`
- `images_json`

Relational catalog fields remain local to Trainbook:

- `id`, `name`, `notes`
- `merged_into_id`, `merged_at`, `archived_at`
- `created_at`, `updated_at`

Image rendering resolves `images[0]` at runtime with:

- `https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/<relative-path>`

## Backfill Behavior

On server startup, exercises without `fork_id` are backfilled by exact name match against the local snapshot. Existing rows with populated metadata are preserved, and unmatched rows receive deterministic defaults (`primaryMuscles` fallback + baseline enum defaults).

## Seed Behavior

Server startup (`npm run dev` / `npm run start`) applies the following in order:

1. `ensureDefaultExercises()` seeds `server/seed-exercises.json` with `INSERT OR IGNORE` (unique by exercise `name`).
2. `backfillExerciseMetadataFromLibrary()` enriches rows that still have no `fork_id`.

Implications:

- Seed changes do not overwrite existing rows with the same `name`.
- To reseed from scratch, use a new SQLite DB path (or clear the DB before start).

## Fetch + Seed Workflow

1. Refresh snapshot:
   - `npm run sync:exercise-library`
2. Start the server:
   - `npm run dev`
3. Verify:
   - `GET /api/exercises` should return rows with `forkId` for matched entries.

Optional dev import seed (full app payload):

- `DEV_SEED_PATH=./path/to/export.json npm run dev`
