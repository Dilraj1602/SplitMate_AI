# SplitMate AI — Test and Validation Report

## 2026-10-25 — Product API and frontend integration

- **Implementation:** Added persistent product tables and API routes for dashboard, groups, memberships, invitations, invite links/join requests, expenses/splits/history, group balances, settlements, notifications, activity, profile, password change, and logout. Connected the existing React pages to live resource contracts and added dashboard and notification views, account identity and unread count, plus settlement details/actions.
- **404 diagnosis:** The original API router registered only health/authentication; product screens called endpoints that did not exist. The router now includes the product API module.
- **Database:** Reviewed additive migration `eff0170fdee4` (product tables/indexes only), applied it after `20261025_01` to the configured development PostgreSQL database, and ran Alembic check: `No new upgrade operations detected.` Existing auth/account records were preserved.
- **Backend:** `.venv\Scripts\python.exe -m pytest -q backend/tests` — **25 passed**, including group, invite-link approval, equal split, balances, pending/confirmed settlement, notifications, and activity flow against isolated SQLite. `compileall` succeeded.
- **Frontend:** `npm run build`, `npm run lint`, `npm run typecheck`, and Vitest — **18 tests across 3 files passed**.
- **Local services:** API health returned 200 at `http://127.0.0.1:8000`; frontend dev server is running at `http://127.0.0.1:5173` and returned 200 after startup.
- **External email:** No Brevo message was sent. The configured development OTP bypass suppresses provider calls; a prior read-only Brevo credential check returned 401. Real delivery still requires a valid key.
- **Limits:** Workflow tests use an isolated test database, not browser automation against the configured PostgreSQL account. The UI runs locally, but a full authenticated browser walkthrough was not performed. Group invitation records are in-app; they do not send email.

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

## 2026-10-25 — Brevo email OTP authentication

- **Implementation:** Added pending account creation, email verification OTP, resend, password-reset OTP, verified-account login, reusable Brevo email templates/service, settings, frontend OTP/reset forms, API/database/architecture documentation, tests, and initial Alembic revision `20261025_01`.
- **Database safety and migration:** Read-only inspection confirmed `ENVIRONMENT=development`, database `splitmate_ai`, no `users`/`auth_otps` tables, and an empty Alembic version table. Reviewed the generated SQL, applied the additive initial migration to this development database, then `uv run alembic -c backend/alembic.ini check` reported `No new upgrade operations detected.`
- **Backend:** `uv run pytest -q` — **20 passed**. Tests cover mocked Brevo payload/header, missing configuration, provider failure/timeout, OTP purpose/hash/expiry/attempt/single-use/supersession, and registration/verification/login/reset behavior.
- **Frontend:** `npm run build`, `npm run lint`, and `npm run typecheck` passed. `npm run test -- --reporter=dot --pool=forks --maxWorkers=1` — **18 passed across 3 files**.
- **Startup:** Backend started at `http://127.0.0.1:8001`; frontend started at `http://127.0.0.1:5174`. API health and readiness returned 200, OpenAPI contained all six auth routes, frontend returned 200, and CORS preflight from the frontend origin returned 200.
- **Configuration/provider:** `.env` remains ignored by Git. A local random `SECRET_KEY` was generated and stored in `.env` without printing it. A read-only Brevo account API credential check returned HTTP 401; therefore the configured `BREVO_API_KEY` is not currently accepted. No email was sent and real delivery is unverified. Replace the key with a valid Brevo API key before testing account creation.
- **Limitations:** Password-reset cannot revoke already-issued stateless access tokens because refresh/session storage does not exist. Current rate limits are per email address and are not an IP/global abuse limiter. No actual concurrent PostgreSQL verification stress test was run; OTP state changes use PostgreSQL row locks and atomic commits.

## 2026-10-25 — Pending registration retry and provider-key diagnosis

- **Issue reproduced from user report:** A first signup creates an inactive, unverified row before attempting delivery. Brevo failure returns 503 while retaining that pending row; a second signup previously returned 409.
- **Fix:** Repeating the same pending email/username with the matching password now resumes verification, never overwrites the original user fields/password, and does not create another user. A retry inside the OTP cooldown returns the pending-flow response; other duplicate identities still return 409.
- **Database check:** Confirmed the reported email has one matching pending, inactive, unverified account with matching username; no password, OTP, or hash was displayed. No account data was changed during inspection.
- **Provider check:** Repeated read-only Brevo account authentication check still returned HTTP 401. The key is non-empty but not accepted. No message was sent; the user supplied a test recipient, but provider authentication failed before any delivery attempt.
- **UI false-success correction:** The cooldown branch had returned 202 for a pending-account retry even though no send was attempted, which caused the frontend to navigate to OTP entry. It now returns 429 during cooldown; the verification page copy no longer promises that an email was sent. Backend: **21 passed**. Frontend build/lint/typecheck passed; Vitest: **18 passed**.
- **Local testing mode:** Enabled `DEV_OTP_BYPASS` and a six-digit development code in the ignored `.env`. This mode skips Brevo, stores only the code HMAC in the database, and restricts OTP routes to loopback while retaining purpose/expiry/attempt/single-use checks. Issued a fresh verification OTP for the user's existing pending account through the local resend route; no email was sent. The live API on port 8000 confirmed local development mode is active.
- **Additional validation:** Backend pytest now passes **24 tests**, including local OTP mode and production guard tests. Frontend build, lint, typecheck, and 18 tests pass. Alembic reports no schema drift.
