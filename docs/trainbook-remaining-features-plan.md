# Trainbook Remaining Features Plan (Sequential, Full-Scope)

## Summary
Implement all remaining product work **one item at a time**, in strict order, with each item fully shipped (code + tests + docs) before starting the next.  
Baseline assumptions use the current working tree in `/Users/keenfann/Documents/GitHub/trainbook` (including existing uncommitted changes) and keep the shared exercise catalog model.

## Implementation Tracker (Live)
Last updated: 2026-02-07

- [x] 1. Quality Gate Foundation (tests + CI)
  - [x] Test dependencies installed (`supertest`, Testing Library, `jsdom`)
  - [x] Backend API integration smoke test scaffold added
  - [x] Frontend component/flow tests completed
  - [x] CI workflow added (`npm ci`, `npm test`, `npm run build`)
  - [x] Item complete (all gates green)
- [x] 2. Migration System + Data Safety
  - [x] Introduced SQL migration runner with `schema_migrations` tracking
  - [x] Moved base schema creation into `server/migrations/0001_initial_schema.sql`
  - [x] Added reversible additive migration (`0002_add_sync_operations.sql`)
  - [x] Added migration assertions to automated tests
- [x] 3. Multi-User Shared Catalog Hardening
  - [x] Added exercise impact summary endpoint (`GET /api/exercises/:id/impact`)
  - [x] Hardened archive/merge with improved validation and `BEGIN IMMEDIATE` transactions
  - [x] Added impact metadata to merge/archive responses
  - [x] Added UI impact-aware confirmations for merge and archive
- [x] 4. Session Logging Completion
  - [x] Added in-session set editing (`PUT /api/sets/:id` with updated set payload)
  - [x] Added delete-with-undo workflow for session sets
  - [x] Added active session name/notes editing (`PUT /api/sessions/:id`)
  - [x] Added recent-session detail view in Log page
- [x] 5. Routine Builder Completion
  - [x] Added routine duplication endpoint (`POST /api/routines/:id/duplicate`)
  - [x] Added explicit reorder endpoint (`PUT /api/routines/:id/reorder`)
  - [x] Added UI duplicate and reorder controls for routine exercises
  - [x] Added local drag/reorder support and stronger validation in `RoutineEditor`
- [ ] 6. Exercise Library Completion
- [ ] 7. Analytics Expansion
- [ ] 8. Import/Export Robustness
- [ ] 9. PWA Offline Capability
- [ ] 10. Release Hardening + Documentation

## Public API / Interface Changes
1. Add explicit API contracts for features currently UI-missing but backend-partial:
- `PUT /api/sets/:id` already exists; standardize request/response and expose in UI for set editing.
- `PUT /api/sessions/:id` already exists; expose session name/notes editing in UI.
- `PUT /api/weights/:id` and `DELETE /api/weights/:id` already exist; expose in UI.

2. Add new analytics endpoints:
- `GET /api/stats/progression?exerciseId=<id>&window=90d|180d|365d`
- `GET /api/stats/distribution?metric=volume|frequency&window=30d|90d`
- `GET /api/stats/bodyweight-trend?window=30d|90d|180d`

3. Add routine quality-of-life endpoints:
- `POST /api/routines/:id/duplicate`
- `PUT /api/routines/:id/reorder` (explicit exercise position update payload)

4. Add import/export safety endpoint:
- `POST /api/import/validate` (dry-run validation + summary, no writes)

5. Add offline sync endpoint:
- `POST /api/sync/batch` for queued offline mutations (idempotent with client-generated operation IDs).

## Sequential Implementation Plan

1. **Quality Gate Foundation (tests + CI)**
- Scope: establish safe delivery pipeline before accelerating feature work.
- Backend: add API integration tests for auth, exercises, routines, sessions, sets, weights, stats, import/export.
- Frontend: add component/flow tests for login, active session logging, routine CRUD, exercise CRUD, settings import/export.
- CI: add GitHub Actions workflow for Node 22 running `npm ci`, `npm test`, `npm run build`.
- Done when: CI blocks merges on failing tests/build and minimum smoke coverage exists for all current routes.

2. **Migration System + Data Safety**
- Scope: replace implicit schema drift with explicit migrations.
- Backend: introduce SQL migration runner and `schema_migrations` table; move schema evolution out of ad hoc startup changes.
- DB: create reversible migrations for any upcoming schema additions.
- Done when: app boot applies pending migrations once, supports existing DBs, and no data loss occurs on upgrade.

3. **Multi-User Shared Catalog Hardening**
- Scope: keep shared exercises, but prevent unsafe cross-user side effects.
- Backend: enforce transactional safety on merge/archive paths and validate referenced entities before mutation.
- Rules: any logged-in user can edit/archive/merge catalog entries.
- UI: show clear confirmation + impact summary before merge/archive.
- Done when: merge/archive operations are deterministic, atomic, and clearly communicated.

4. **Session Logging Completion**
- Scope: remove current workout-flow gaps.
- UI: support editing existing sets (reps/weight/RPE), deleting with undo affordance, editing active session name/notes, and viewing full session details.
- Backend: ensure `PUT /api/sets/:id` and `PUT /api/sessions/:id` support these flows cleanly.
- Done when: all in-session CRUD is available without page refresh and reflected immediately.

5. **Routine Builder Completion**
- Scope: make routines production-usable for repeat training plans.
- UI: drag/reorder exercises, duplicate routine, preserve target defaults, improve validation messaging.
- Backend: add duplicate + reorder endpoints and ensure position integrity.
- Done when: users can create, reorder, duplicate, and edit routines without data inconsistencies.

6. **Exercise Library Completion**
- Scope: improve discoverability and cleanup operations.
- UI: add archived view toggle, unarchive action, stronger duplicate prevention feedback, and merge history visibility.
- Backend: expose filtered list modes (`active`, `archived`, `all`) and merge metadata consistently.
- Done when: catalog maintenance is reliable for shared multi-user usage.

7. **Analytics Expansion**
- Scope: move from summary stats to actionable progression insights.
- Backend: implement progression, distribution, and bodyweight trend endpoints.
- UI: add exercise progression charts, rolling volume/frequency views, and trend cards with selectable windows.
- Done when: users can answer “am I progressing?” per exercise and per time window directly in-app.

8. **Import/Export Robustness**
- Scope: make backup/restore safer and predictable.
- Backend: add import dry-run validation, duplicate/conflict reporting, and strict payload version checks.
- UI: two-step import (validate -> confirm), with clear summary of adds/updates/skips.
- Done when: imports are auditable before write and failures are actionable.

9. **PWA Offline Capability**
- Scope: convert “PWA-ready” to practical offline support.
- Frontend: add service worker, cache strategy for shell/API reads, IndexedDB mutation queue, retry/sync status UI.
- Backend: add idempotent batch sync endpoint.
- Done when: users can log sets offline and sync safely once online, without duplicate writes.

10. **Release Hardening + Documentation**
- Scope: finalize operational readiness.
- Docs: update `/Users/keenfann/Documents/GitHub/trainbook/README.md` and `/Users/keenfann/Documents/GitHub/trainbook/AGENTS.md` to reflect all user-facing behavior and new commands/workflows.
- Ops: add release checklist (migration backup, smoke test, rollback notes).
- Done when: fresh setup, upgrade, backup/restore, and offline sync workflows are documented and repeatable.

## Test Cases and Scenarios
1. Auth and session security: register/login/logout/password change, CSRF retry behavior, unauthenticated route rejection.
2. Shared catalog safety: exercise merge/archive in multi-user data, no orphaned routine/session references, atomic rollback on failure.
3. Session logging: add/edit/delete sets, RPE persistence, active session end/update, history detail retrieval.
4. Routine integrity: reorder persistence, duplicate routine correctness, target value preservation.
5. Analytics correctness: progression outputs match fixture data across windows and sparse datasets.
6. Import/export reliability: round-trip export->import, dry-run validation errors, version mismatch handling, partial invalid payload behavior.
7. Offline sync: queued operations replay exactly once, conflict handling, reconnect recovery, no duplicate set inserts.
8. Regression suite: `npm test` + `npm run build` green in CI for each item before moving to the next.

## Assumptions and Defaults
- Delivery model: strict sequential execution, one roadmap item fully complete before next.
- Scope preference: include reliability, UX, and analytics (full-scope), not a narrow slice.
- Audience: self-hosted instances with a small number of users.
- Exercise model: shared catalog with per-user routines/sessions/stats.
- Catalog permissions: any logged-in user can edit/archive/merge exercises.
- DB evolution: schema changes are allowed with safe migrations.
- Existing uncommitted changes in `/Users/keenfann/Documents/GitHub/trainbook/server/db.js`, `/Users/keenfann/Documents/GitHub/trainbook/server/index.js`, and `/Users/keenfann/Documents/GitHub/trainbook/src/App.jsx` are treated as in-progress baseline.
