# SplitMate AI — Implementation Log

Entries are append-only. Do not revise prior results to imply checks passed when they did not.

## 2026-10-24 — Frontend foundation and backend readiness/configuration

**Change:** Added the initial React/TypeScript frontend structure, page and route inventory, auth/session UI boundary, API client, responsive layout, and deterministic paise split preview. Added frontend build, lint, typecheck, and Vitest commands. Backend settings now support database-independent app startup, comma-separated CORS origins, a database-independent `/health`, a read-only database `/ready`, and a versioned `/api/v1/health`. The DB dependency rejects requests when PostgreSQL is not configured and always closes opened sessions. Added configuration/readiness/versioned-OpenAPI tests.

**Reason:** Establish testable frontend structure and make operational liveness distinct from PostgreSQL readiness without changing schema/data or choosing unresolved security/financial policy.

**Files:** `frontend/` (source, manifests, lockfile, tests), `backend/app/config.py`, `backend/app/db/session.py`, `backend/app/dependencies.py`, `backend/app/main.py`, `backend/app/api/v1/router.py`, `backend/tests/test_foundation.py`, `.env.example`, and operational records.

**Evidence:** Frontend production build, Oxlint, TypeScript typecheck, and 10 Vitest tests passed. Backend tests and final verification are recorded in `TEST_REPORT.md`. A read-only PostgreSQL query returned `splitmate_ai`; no DDL or data changes were performed. `.env` remained ignored and untracked.

**Limitations:** Product workflows are not complete. Backend has no auth/group/expense/settlement APIs or migration revision. UI feature requests remain unintegrated and must be contract-aligned. Remaining product decisions are enumerated in `PROJECT_DECISIONS.md`.

## 2026-10-24 — Signup pending-state diagnosis

**Finding:** Reproduced `POST /api/v1/auth/register` against the current FastAPI app; it returns `404 Not Found` because the registration endpoint is not implemented. Therefore no account is created by the current form.

**Change:** Frontend API requests now have a 15-second abort timeout and show a retryable timeout message. Signup maps the missing registration route to an explicit unavailable message. Added tests for timeout error mapping and for the form clearing its pending state after the missing-route response.

**Verification:** `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test -- --reporter=dot` passed; 12 tests across 3 files passed. `git diff --check` passed (with existing line-ending normalization notices).

**Limitations/next:** This prevents indefinite loading and communicates the actual failure; it does not create accounts. The endpoint still requires the reviewed auth contract, migration, rate limiting, and email-verification delivery. See SM-008 in `KNOWN_ISSUES_AND_FIXES.md`.

## 2026-10-24 — Positive-flow verification attempt

**Scope:** Assessed all A–H workflow groups using repository/API inspection, browser page rendering, FastAPI `TestClient`, read-only PostgreSQL/Alembic checks, and existing suites.

**Results:** No complete positive end-to-end journey passed. `/health`, `/ready`, and `/api/v1/health` returned 200; registration and group-create returned 404. There are no Alembic revisions. The frontend signup page renders but cannot complete without backend auth. Groups/invitations, persisted expenses, balances, settlements, notifications/activity, and profile APIs are absent. Split unit tests were extended for the ₹900/3, ₹1,000 exact, and ₹100/3 examples; these are not integrated financial-flow tests.

**Verification:** Backend 10 tests passed. Frontend build, lint, typecheck passed; 14 frontend tests passed. Read-only DB connection succeeded against `splitmate_ai`; read-only Alembic check reports missing `users` table/indexes. No database data or schema was changed.

**Disposition:** Scenario A blocked; B–H not implemented. See `TEST_REPORT.md` and SM-009 in `KNOWN_ISSUES_AND_FIXES.md`.

## 2026-10-24 — Signup CORS preflight and requested minimum length

**Finding:** The user's Uvicorn log showed `OPTIONS /api/v1/auth/register` returning 404. Current settings had no configured CORS origins, and the app adds CORSMiddleware only when origins are set. The backend also has no registration `POST` route; resolving CORS alone cannot create an account.

**Changes:** Development now allows the two local Vite origins by default; production still has no inferred origins. Signup/password-reset UI validation and hint now use the user-requested six-character minimum. Tests cover CORS preflight, no implicit production origins, six-character acceptance, and rejection below six without a network request.

**Verification:** `uv run pytest -q` passed, 13 tests. From `frontend/`, tests passed, 15 across 3 files; build, lint, and typecheck passed. `TestClient` verified `OPTIONS /api/v1/auth/register` => 200 with the allowed origin and `POST /api/v1/auth/register` => 404.

**Limitations:** Registration is still unavailable. Email verification is required by the provisional auth policy but has no implemented endpoint/provider; no account was created. Six characters is weak for accounts containing financial records and needs server-side enforcement plus review before production (DEC-016).

## 2026-10-24 — Repository audit and health-test baseline

**Change:** Inspected the workspace and project documentation; recorded the baseline in `PROJECT_AUDIT.md`, unresolved product contracts in `PROJECT_DECISIONS.md`, and initial tracked gaps in `KNOWN_ISSUES_AND_FIXES.md`. Added two HTTP-level tests for the existing health endpoint and OpenAPI schema.

**Reason:** The repository had no discoverable tests, while the engineering brief requires evidence before feature implementation. These tests exercise the existing app without touching PostgreSQL.

**Files:** `backend/tests/test_health.py` and the five operational documents in `docs/`.

**Verification:** Final `uv run pytest -q` passed (2 tests in 0.21s) after adding `pythonpath` and `testpaths` pytest configuration. `git diff --check` passed; Git emitted line-ending normalization notices. See `TEST_REPORT.md`.

**Status:** Completed; baseline test coverage added. Application remains a scaffold and all product features remain unimplemented.

## 2026-10-24 — Backend foundation verification

**Change:** Added a request-scoped SQLAlchemy session dependency that closes in `finally`; explicitly imported mapped models in Alembic's environment before exposing `Base.metadata`; added tests for environment-backed settings, session closure, Alembic's migration path and model metadata. Updated the decision log with unresolved authentication contracts.

**Reason:** Alembic previously saw empty metadata because `env.py` imported only `Base`. The backend had no standard request-scoped session dependency or automated coverage of configuration and migration setup.

**Files:** `backend/app/dependencies.py`, `backend/migrations/env.py`, `backend/tests/test_foundation.py`, `docs/PROJECT_AUDIT.md`, `docs/KNOWN_ISSUES_AND_FIXES.md`, `docs/PROJECT_DECISIONS.md`, and `docs/TEST_REPORT.md`.

**Verification:** Baseline `uv run pytest -q` passed (2 tests). Post-change `uv run pytest -q` passed (5 tests), including a final rerun at 0.75s after strengthening the session-finalizer test to cover an exception path. A read-only SQLAlchemy probe connected and selected `current_database()` as `splitmate_ai`. `uv run alembic -c backend/alembic.ini heads` exited successfully and reported no revision heads. Read-only `alembic check` loaded the actual `users` metadata and detected the table and unique indexes are not in the connected database; no schema operation was applied. `.env` was confirmed ignored and not tracked without displaying its contents. `git diff --check` passed; Git noted CRLF normalization on edited code files.

**Status:** Backend foundation verified in the configured local environment. No migrations or authentication features were created. Authentication and identity contracts remain blocked as documented.
