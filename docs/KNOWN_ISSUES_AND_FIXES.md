# SplitMate AI — Known Issues and Fixes

## SM-001 — No effective test baseline

- **Severity:** High
- **Status:** Verified
- **Affected feature/files:** Backend test foundation; `backend/tests/test_health.py`
- **Reproduction before fix:** Run `uv run pytest -q` or `uv run pytest backend/tests -q` from repository root.
- **Expected:** Existing backend tests are collected and executed.
- **Observed:** Both commands reported `no tests ran`; the sole test module was empty.
- **Root cause:** Verified: `backend/tests/test_health.py` contained no test functions.
- **Fix:** Added HTTP-level tests for `/health` and `/openapi.json`; configured pytest to discover `backend/tests` and import from the repository root.
- **Regression test:** The new tests cover status/body and API schema title.
- **Verification evidence:** `uv run pytest -q` passed, 2 tests in 0.22s after configuration. See `TEST_REPORT.md`.
- **Remaining risk:** These tests do not exercise database-backed features or feature authorization.

## SM-002 — Product application is not implemented

- **Severity:** Critical
- **Status:** Open
- **Affected feature/files:** Authentication, groups, invitations, expenses, balances, settlements, dashboard, notifications, frontend; primarily `backend/app/`, `frontend/`.
- **Reproduction:** Inspect API routes and frontend files. Backend has only health behavior; `frontend/` has no files.
- **Expected:** Product journeys described in `project_details.md` work through authenticated APIs and a responsive UI.
- **Observed:** No such product workflows exist.
- **Root cause:** No feature implementation has been added yet (verified); this is a scope gap, not a diagnosed runtime defect.
- **Proposed fix:** Implement in dependency order after recording unresolved security/financial contracts.
- **Regression test:** Feature-specific unit, API, database, and browser checks are required as features are added.
- **Verification evidence:** Repository audit and route/file inventory; see `PROJECT_AUDIT.md`.
- **Remaining risk:** Application is not ready for real users or financial records.

## SM-003 — Two competing FastAPI entrypoints

- **Severity:** Medium
- **Status:** Open
- **Affected files:** `main.py`, `backend/app/main.py`, `docs/BACKEND_ARCHITECTURE.md`.
- **Reproduction:** Import either `main:app` or `backend.app.main:app`; these expose different titles and health response contracts.
- **Expected:** One documented canonical launch target.
- **Observed:** Root `main.py` declares a second app; architecture identifies `backend.app.main` as the app module.
- **Root cause:** Historical scaffold duplication is plausible but unverified.
- **Proposed fix:** Confirm the intended compatibility entrypoint, then consolidate or document without removing an externally used import path.
- **Regression test:** Startup/import test for canonical ASGI target.
- **Verification evidence:** Both source files were inspected; no launch scripts or README currently settle the entrypoint.
- **Remaining risk:** Developers may launch a different app than expected.

## SM-004 — Alembic metadata omitted mapped models

- **Severity:** High
- **Status:** Verified (metadata registration corrected; migration remains unapplied)
- **Affected files:** `backend/migrations/env.py`, `backend/app/models/__init__.py`, `backend/app/models/user.py`.
- **Reproduction before fix:** Alembic environment imported `Base` but not the model package; a fresh `Base.metadata` had no tables before model import.
- **Expected:** Alembic autogeneration sees all mapped models.
- **Observed:** `Base.metadata.tables` was empty before importing `backend.app.models`, then contained `users` afterward.
- **Root cause:** `env.py` never imported mapped model modules before assigning `target_metadata`.
- **Fix:** Explicitly import `backend.app.models` before `target_metadata = Base.metadata`.
- **Regression test:** `test_alembic_uses_backend_migrations_and_registered_model_metadata` checks the configured path and registered `users` table.
- **Verification evidence:** `uv run pytest -q` passed; read-only `uv run alembic -c backend/alembic.ini check` loaded `users` and its unique indexes.
- **Remaining risk:** The connected database has no `users` table and no migration revisions exist. No migration was generated or applied because identity normalization and authentication schema contracts are unresolved.

## SM-005 — Application schema has no migration baseline

- **Severity:** High
- **Status:** Open
- **Affected files:** `backend/migrations/versions/` (empty), current `User` model.
- **Reproduction:** `uv run alembic -c backend/alembic.ini heads` returns no heads; read-only `alembic check` detects `users` and its unique indexes as missing from the connected local database.
- **Expected:** A reviewed Alembic baseline matches the approved database model.
- **Observed:** There are no migration revisions; the live local schema differs from model metadata.
- **Root cause:** No initial migration has been created (verified). Whether the database contains unrelated or valuable data was not investigated.
- **Proposed fix:** Resolve identity/normalization and authentication schema decisions, inspect the intended development database and its current revision, then create and review a migration against a disposable database before applying anywhere.
- **Regression test:** Migration upgrade/downgrade tests against a dedicated disposable database.
- **Verification evidence:** Alembic path and metadata were checked; `alembic check` was read-only and no DDL was run.
- **Remaining risk:** Database readiness is not established; do not treat the connected schema as migrated.

## SM-006 — Frontend exists but is not integrated with implemented product APIs

- **Severity:** Critical
- **Status:** Open
- **Affected areas:** `frontend/`, `backend/app/api/v1/`
- **Observed:** Frontend route/UI scaffolding exists and its build/test/tooling passes. Backend currently provides only health and versioned health routes; protected product pages cannot complete real API workflows.
- **Fix so far:** Added explicit unavailable states and HTTP error handling instead of fabricated success. Added client-side paise split preview only; it is not authoritative financial logic.
- **Remaining work:** Implement reviewed backend contracts, connect each page, and verify real workflows against an isolated database.

## SM-007 — Backend database readiness is verified, schema is not migrated

- **Severity:** High
- **Status:** Open
- **Observed:** Read-only PostgreSQL connectivity succeeds, but read-only Alembic check detects the `users` table/indexes as missing and no migration revision exists.
- **Safety boundary:** No migration was generated or applied and no database writes were performed.
- **Next:** Resolve model/auth decisions, create and review migration revisions, then validate against an isolated disposable database before considering any development database change.

### SM-002 status update — 2026-10-24

The frontend gap is now **partially addressed**: a scaffold, route/page inventory, form wiring, responsive UI, and local split preview exist, with frontend checks passing. The original statement that `frontend/` has no files describes the initial audit state. The issue remains open because backend product endpoints and complete connected workflows are absent.

## SM-008 — Signup request cannot create an account

- **Severity:** Critical
- **Status:** Open
- **Affected files:** `frontend/src/pages/AuthPages.tsx`, `frontend/src/services/api.ts`, `backend/app/api/v1/router.py`
- **Reproduction:** Submit the signup form while the current backend is running. `POST /api/v1/auth/register` returns HTTP 404 because no registration route is implemented.
- **Root cause:** Frontend form integration was scaffolded ahead of backend auth; the database schema has no migration baseline and the verification-email provider/abuse controls are not configured.
- **Fix so far:** Added a 15-second fetch timeout, a signup-specific explanation for 404, and a regression test confirming the submit button leaves pending state. The frontend does not report successful account creation.
- **Follow-up:** Local development CORS now defaults to `localhost:5173` and `127.0.0.1:5173`; production still requires explicit origins. Preflight is verified HTTP 200. Signup/reset UI minimum is six per DEC-016 and is validated explicitly.
- **Remaining work:** Implement the registration contract with reviewed persistence migration, rate limits, hashed verification token, and configured email delivery; test it against an isolated database before connecting to the development database.
- **Limitation:** The current change fixes indefinite loading and exposes the actual missing capability. It does not make registration functional.
- **Current exact behavior:** `OPTIONS /api/v1/auth/register` now returns 200 for the local Vite origin; `POST /api/v1/auth/register` still returns 404.

## SM-009 — Positive-flow application journeys are not end-to-end available

- **Severity:** Critical
- **Status:** Open
- **Affected areas:** Auth, groups, invitations, expenses, balances, settlements, notifications, activity, profile, migrations, and frontend integration.
- **Verification:** Positive-flow scenarios A–H assessed on 2026-10-24. No complete journey passed. Direct `TestClient` probes returned 404 for registration and group creation; product routes beyond health are absent. Alembic has no migration heads; read-only check detects missing `users` table/indexes.
- **Unit coverage boundary:** Frontend split arithmetic tests pass for selected equal/exact/rounding cases, but no backend financial calculations, persistence, authorization, settlement transition, or balance aggregation exists to verify.
- **Next:** Finalize auth/retention/rate-limit/email contracts, create and review initial migrations, test auth/group/expense/settlement APIs against a disposable PostgreSQL database, then add real browser workflow tests.
- **Safety:** No accounts or synthetic financial records were written; no migration or database reset was run.
