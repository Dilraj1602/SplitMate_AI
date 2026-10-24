# SplitMate AI — Test and Validation Report

## 2026-10-24 — Repository baseline and health tests

- **Scope:** Backend test discovery, app import, health endpoint and OpenAPI schema.
- **Environment:** Windows workspace `D:\SplitMateAI`; Python 3.13 virtual environment managed by `uv`.
- **Baseline commands before adding tests:**
  - `uv run pytest -q` — failed as a verification step: exit code 1, `no tests ran in 0.02s`.
  - `uv run pytest backend/tests -q` — failed as a verification step: exit code 5, `no tests ran in 0.01s`.
  - `uv run python -c "from backend.app.main import app; print(app.title, len(app.routes))"` — passed; printed `SplitMate AI API 5`.
- **Change:** Added `test_health_reports_api_status` and `test_openapi_schema_is_available` in `backend/tests/test_health.py`.
- **Post-change commands/results:**
  - `uv run pytest -q` — initially failed collection with `ModuleNotFoundError: No module named 'backend'` because the executable invocation did not include the repository root on the import path.
  - `uv run python -m pytest backend/tests -q` — passed, 2 tests.
  - `uv run python -m pytest -q` — passed, 2 tests.
  - Added pytest configuration to use `backend/tests` and include `.` on the import path.
  - Final `uv run pytest -q` — passed, 2 tests in 0.21s.
  - `git diff --check` — passed; Git emitted only line-ending normalization notices for the two edited Python/TOML files.
- **Not run:** Database connectivity, migrations, frontend build, integration/browser tests, and external services. No database was modified.
- **Status:** Initial health-test baseline verified; backend feature verification remains incomplete.

## 2026-10-24 — Backend foundation follow-up

- **Scope:** Environment settings, SQLAlchemy session lifecycle, FastAPI health/OpenAPI, Alembic path and metadata, PostgreSQL connectivity, Git secret-file state.
- **Baseline:** `uv run pytest -q` — passed, 2 tests.
- **Changes:** Added foundation tests and a `get_db` dependency; ensured Alembic imports mapped models before using metadata.
- **Commands and actual results:**
  - `uv run pytest -q` — passed, **5 tests** in 0.70s. An earlier test attempt failed because the monkeypatch targeted the module that defines `SessionLocal` rather than the dependency's imported reference; the test target was corrected before the passing run.
  - Final `uv run pytest -q` after strengthening the session cleanup test to throw during dependency use — passed, **5 tests** in 0.75s.
  - Final check after documentation/ignore-rule review: `uv run pytest -q` — passed, **5 tests** in 0.70s.
  - Read-only SQLAlchemy connection and `SELECT current_database()` — passed; returned `splitmate_ai`. URL, username, password, and host were not logged.
  - `uv run alembic -c backend/alembic.ini heads` — exited 0 with no revision heads.
  - Read-only `uv run alembic -c backend/alembic.ini check` — exited 1 with `New upgrade operations detected`; it loaded the `users` table metadata and detected the users table and unique indexes are absent from the connected schema. No migration/DDL was run.
  - `git diff --check` — passed; Git noted line-ending normalization for code files.
  - `.env` tracking check — not tracked; ignore check — ignored. No contents were printed.
- **Not run:** Migrations, writes to PostgreSQL, migration generation, authentication tests, frontend checks, or external services.
- **Status:** App config override, request session cleanup, Alembic path/model registration, health/OpenAPI, and local connectivity verified. Database migration status remains unresolved; auth implementation is blocked on DEC-010/011 and other recorded policy decisions.

## 2026-10-24 — Frontend scaffold and readiness foundation

- **Frontend commands:** From `frontend/`, `npm run build` passed; `npm run lint` passed; `npm run typecheck` passed; `npm run test -- --reporter=dot` passed, **10 tests across 3 files**.
- **Backend command:** `uv run pytest -q` — passed, **10 tests in 0.95s**, after adding environment/CORS parsing, optional database configuration, readiness no-DB and read-only probe behavior, and versioned API health coverage.
- **Database:** Read-only SQLAlchemy `SELECT current_database()` passed and returned `splitmate_ai`. No writes or DDL were run.
- **Readiness endpoint:** `TestClient` request to the live `/ready` route against the configured PostgreSQL engine returned HTTP 200 with status `ready`.
- **Migration check:** `uv run alembic -c backend/alembic.ini check` exited 1, as expected for the current unmigrated schema: reports new `users` table and unique indexes. This is a schema gap, not a test pass. No migration was applied.
- **Secret hygiene:** `git check-ignore .env` confirmed ignored; `git ls-files --error-unmatch .env` confirmed untracked. Values were not printed. `.env.example` is a placeholder-only template.
- **Diff hygiene:** `git diff --check` passed (only Git line-ending normalization notices).
- **Not run:** auth, product API workflows, migration-upgrade tests, email/Google integrations, or end-to-end flows.
- **Final result:** Frontend checks completed again after all source changes: build passed, lint passed, typecheck passed, and 10 tests across 3 files passed. Backend final run: 10 passed. `git diff --check` passed; Git reported only expected LF-to-CRLF normalization notices.

## 2026-10-24 — Signup pending-state regression

- **Reproduction:** `TestClient` POST to `/api/v1/auth/register` returned HTTP 404 `Not Found`; no account was created.
- **Frontend fix verification:** From `frontend/`, `npm run build` passed, `npm run lint` passed, `npm run typecheck` passed, and `npm run test -- --reporter=dot` passed, **12 tests across 3 files**.
- **Coverage added:** Timeout errors map to a retryable API error; submitting signup against a 404 renders the unavailable endpoint explanation and re-enables the submit button.
- **Scope limit:** The regression validates pending-state exit only. Functional registration awaits backend schema/migration and email verification setup.

## 2026-10-24 — Positive-flow end-to-end verification

- **Scope:** Assessed positive-flow scenario groups A–H. No database writes, account creation, migrations, or resets were performed.
- **Scenario outcome:** **8 scenario groups assessed: 0 complete end-to-end passes, 1 blocked, 7 not implemented.** Scenario A (registration/authentication) is blocked by missing registration/login APIs and auth schema migration. Scenarios B–H (groups/invitations, persisted expenses, balances, expense history, settlements, notifications/activity, profile/settings) are not implemented in the backend.
- **Browser:** Opened the real Vite application at `/signup`; the form rendered. This was page-render inspection, not a completed browser workflow. No browser automation package is configured, and the app has no successful registration route.
- **Browser submission:** Not performed. The only real registration action could create an account if the route changed; the current backend is missing that route. Per the UI automation confirmation policy, do not click the final account-creation action without action-time confirmation. The in-process synthetic `TestClient` probe safely established the route's 404 behavior.
- **Backend:** `uv run pytest -q` passed, **10 tests in 0.90s**. These cover foundation/health behavior, not business workflows.
- **Frontend:** `npm run build`, `npm run lint`, and `npm run typecheck` passed. `npm run test -- --reporter=dot` passed, **14 tests across 3 files**.
- **Read-only API probes:** `TestClient` returned HTTP 200 for `/health`, `/ready`, and `/api/v1/health`; `POST /api/v1/auth/register` and `POST /api/v1/groups` returned HTTP 404. A synthetic `.invalid` account payload was used only for route probing; no handler ran and no record was written.
- **Local HTTP probe:** A request through PowerShell to the already-running local API did not return within 30 seconds and was canceled. It is not counted as a passing check; the in-process `TestClient` results above are the verified API responses.
- **Database:** Read-only SQLAlchemy query connected and returned database name `splitmate_ai`. No DML/DDL was performed. `alembic heads` returned no migration heads. Read-only `alembic check` exited 1 because it detects the missing `users` table and indexes.
- **Financial arithmetic:** Frontend unit tests passed for equal split (`₹900.00` across 3), exact split (`₹1,000.00` as `₹200/₹300/₹500`), and deterministic equal rounding (`₹100.00` across 3). These are pure-function unit tests; no expense API, persistence, or backend balance calculation exists.
- **External integrations:** Email delivery and Google OAuth were not attempted; provider configuration is absent.
- **Status:** The app is not end-to-end verified. See SM-009 in `KNOWN_ISSUES_AND_FIXES.md`.

## 2026-10-24 — Signup preflight and minimum length follow-up

- **Root cause from user log:** `CORS_ORIGINS` was unset in the local environment, so CORS middleware was not installed and the browser's `OPTIONS /api/v1/auth/register` request received 404. Separately, the backend has no `POST /api/v1/auth/register` route, so no account could be created even after preflight succeeds.
- **Fix verification:** Development CORS now defaults to `http://localhost:5173` and `http://127.0.0.1:5173`; `TestClient` confirmed local preflight returns 200 with the expected allow-origin header. Production has no implicit CORS origins. Signup and reset UI now enforce the user-requested six-character minimum.
- **Backend tests:** `uv run pytest -q` — **13 passed in 0.84s**.
- **Frontend tests/checks:** `npm run test -- --reporter=dot` — **15 tests across 3 files passed**; build, lint, and typecheck passed.
- **Actual account result:** `POST /api/v1/auth/register` remains HTTP 404. No account or database record was created. Email verification is described as required in the provisional project auth policy, but verification endpoint, migration, and email delivery are not implemented/configured.
- **Security note:** Six characters is a weak password minimum for financial account data. It was implemented at the user's direction; the backend must enforce the same contract and rate-limit auth operations before the route is enabled, and the threshold should be revisited before production.
