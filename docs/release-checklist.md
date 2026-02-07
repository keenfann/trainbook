# Trainbook Release Checklist

## 1. Pre-Release Backup
- Confirm current `DB_PATH` target.
- Create a timestamped SQLite backup before deploy:
  - `sqlite3 "$DB_PATH" ".backup '$DB_PATH.backup-$(date +%Y%m%d-%H%M%S).sqlite'"`
- Verify backup file exists and is readable.

## 2. Build and Test Gates
- Run `npm test` and confirm all tests pass.
- Run `npm run build` and confirm production bundle builds successfully.

## 3. Deploy and Migration Verification
- Deploy updated app code.
- Start server once to apply pending migrations.
- Verify migration ledger:
  - `SELECT id, applied_at FROM schema_migrations ORDER BY id;`
- Verify sync table exists:
  - `PRAGMA table_info(sync_operations);`

## 4. Smoke Test (Post-Deploy)
- Auth: register/login/logout.
- Logging: start session, add/edit/delete set, end session.
- Routines: create/edit/reorder/duplicate routine.
- Exercises: archive/unarchive/merge with impact modal path.
- Stats: overview + progression + distribution + bodyweight trend.
- Import: validate then confirm import with a recent export file.
- Offline: disconnect network, log at least one set, reconnect, verify queued operations sync exactly once.

## 5. Rollback Notes
- If release regression is detected:
  - Stop app process.
  - Restore latest backup over active DB file.
  - Redeploy previous known-good app revision.
  - Restart app and re-run smoke checks.
- If rollback is partial (code only), ensure migration compatibility before restart.
