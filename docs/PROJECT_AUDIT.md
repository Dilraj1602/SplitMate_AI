# SplitMate AI — Project Audit

**Audit date:** 2026-10-24  
**Workspace:** `D:\SplitMateAI`  
**Git baseline:** `main...origin/main`, clean before this audit's changes.

## Scope inspected

Read the product specification, API documentation, backend and database architecture, frontend architecture and visual design specification, plus the existing backend code, migration setup, dependency manifests, environment example, ignore rules, and test files. The `.env` file exists and is ignored; its values were not copied into this audit.

## Current inventory

| Area | Observed state |
|---|---|
| Backend | FastAPI skeleton in `backend/app`; `/health` only. Root `main.py` is a separate older minimal app. |
| Data | SQLAlchemy `User` model only. Alembic environment exists, but no revision files exist under `backend/migrations/versions`. |
| Database | PostgreSQL URL is configured by environment. No database connection or migration was run during this audit. |
| Authentication | Not implemented: no schemas, auth/session/token services or routes. |
| Product workflows | Groups, invitations, expenses, splits, balances, settlements, notifications, activity, and dashboard are not implemented. |
| Frontend | `frontend/` contains no files; no package manifest or lockfile exists. |
| AI/integrations | Dependencies for planned AI providers are present; no app workflows or external email/Google integration are implemented. AI is explicitly a later phase. |
| Tests | `backend/tests/test_health.py` was empty. Root `uv run pytest -q` and scoped pytest initially discovered no tests. |
| Documentation | Product/API/schema/architecture/design documents exist. README and requested operational audit/log/issue/decision/test-report docs were absent. |

## Confirmed gaps and risks

1. No user-facing feature is currently implemented beyond health checks and a preliminary user table.
2. The root `main.py` and `backend.app.main` are two distinct FastAPI apps, creating ambiguity about the canonical launch target.
3. The existing settings require `DATABASE_URL` at import time, coupling even health-only app import to local configuration.
4. Alembic's target metadata imports only models imported by `backend.app.db.session`; model registration currently relies on package side effects, and the model package exports `User` only.
5. `backend/app/dependencies.py`, schemas, services, repositories, and endpoint modules contain no feature implementations.
6. No frontend scaffold, checks, or application interface exists.
7. No baseline tests were discoverable before this audit.

## Documentation conflicts and unresolved product decisions

See [PROJECT_DECISIONS.md](PROJECT_DECISIONS.md). The product document identifies outstanding decisions in its section 19, and the frontend design spec has its own reconciliation section 16. In particular, signup identity fields, username normalization, invite-link approval, expiry/reinvitation, member-removal/admin transfer, currency support, group archival with debt, and email verification/session policy require reconciliation before the affected workflows are implemented. Settlement confirmation/rejection and pending-versus-confirmed balance behavior are specified; cancellation and reversal authorization still needs to follow a carefully enforced policy.

## Verification boundary

The backend module imported successfully with the local environment and registered five routes (including framework routes). No database connectivity, migration, frontend build, or external integration was attempted. The test file has now been populated; results are recorded in [TEST_REPORT.md](TEST_REPORT.md).

## Next implementation slice

Establish an app entrypoint and test strategy without changing database state, then implement authentication and profile requirements only after resolving their security-sensitive contracts. Continue with groups/invitations before financial workflows, following the product specification's dependency order.

## Foundation follow-up — 2026-10-24

- Baseline `uv run pytest -q` passed with 2 tests before this follow-up; the suite now includes database-independent settings, session lifecycle, Alembic path/model registration, health, and OpenAPI coverage.
- A read-only connection probe succeeded against the configured development database and returned database name `splitmate_ai`.
- Alembic resolves `backend/migrations`; before the fix its metadata was empty until models were imported. `env.py` now imports `backend.app.models` before assigning `Base.metadata`.
- `alembic check` is read-only and detected the expected `users` table and two unique indexes as absent from the connected database. No migration revisions exist and no schema changes were applied.
- `.env` is ignored and is not tracked by Git. Its contents and connection URL were not included in command output or documentation.
- See `PROJECT_DECISIONS.md` for authentication and identity contracts still unresolved.

## Continued implementation — 2026-10-24

- Frontend now has a React, TypeScript, Vite, Tailwind, and React Router scaffold with public/authentication screens, protected application route inventory, group/expense/settlement UI flows, and documented unavailable states where APIs do not exist. It is an early integrated UI, not a complete working product; most API-backed journeys remain unimplemented server-side.
- Frontend verification: production build, Oxlint, TypeScript typecheck, and Vitest all pass. Vitest currently reports 10 passing tests.
- Backend configuration now permits database-independent app startup; `DATABASE_URL` remains environment-loaded and optional for liveness. CORS origins are environment-configured. `/ready` performs a read-only `SELECT 1`, while `/health` remains database-independent. `/api/v1/health` establishes the versioned router prefix.
- SQLAlchemy session construction is conditional on database configuration and request dependency closes sessions. Alembic remains configured at `backend/migrations` and imports mapped metadata.
- Current backend suite: 10 tests expected after the new readiness success probe; record the verified result in `TEST_REPORT.md` after final run.
- Read-only PostgreSQL connectivity returned the database name `splitmate_ai`. Read-only Alembic check reports `users` and its unique indexes absent. No migration revision was created or applied, and no database writes were performed.
- `.env` remains ignored and untracked; values were not printed or copied into records. `CORS_ORIGINS` and `ENVIRONMENT` were added to `.env.example` only.
- Remaining work: resolve high-impact account-retention, auth abuse/rate-limit, verification/reset contract, Google credentials/linking, settlement cancel/reversal authorization, and API/frontend request-shape decisions before building those workflows. The frontend uses provisional contracts and requires backend alignment.

## Positive-flow verification — 2026-10-24

- Assessed scenarios A–H. No complete positive end-to-end user journey passed. Signup UI renders in the browser, but `/api/v1/auth/register` returns 404; group creation also returns 404. Other product APIs are absent.
- Backend `uv run pytest -q`: 10 passed. Frontend build/lint/typecheck passed and Vitest: 14 passed across 3 files. Financial split examples are verified only as frontend unit calculations.
- Readiness and direct SQL connectivity succeeded read-only; the connected database is `splitmate_ai`. Alembic has no revision heads, and read-only `alembic check` reports missing `users` table/indexes.
- No synthetic user/group/expense/settlement was persisted; no migration or destructive operation was run. Full results are in `TEST_REPORT.md`.
- Follow-up to the signup report: default development CORS now handles local Vite preflight (verified 200); registration `POST` remains 404. Signup/reset UI minimum is six per user direction; see DEC-016. No account was created.
