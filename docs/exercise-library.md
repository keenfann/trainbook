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

Image rendering resolves `images[0]` at runtime with:

- `https://raw.githubusercontent.com/keenfann/free-exercise-db/main/exercises/<relative-path>`

## Backfill Behavior

On server startup, exercises without `fork_id` are backfilled by exact name match against the local snapshot. Existing rows with populated metadata are preserved, and unmatched rows receive deterministic defaults (`primaryMuscles` fallback + baseline enum defaults).
