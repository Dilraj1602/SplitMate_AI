# SplitMate AI

SplitMate AI is an expense-sharing application in active development. Its FastAPI backend and React frontend now integrate email OTP authentication, groups and invitations, expenses and splits, balances, settlements, notifications, activity, and profile settings.

## Current status

- Frontend: Vite app with authenticated screens wired to the API and INR split preview.
- Backend: FastAPI routes for auth and current product workflows, PostgreSQL persistence, Argon2 password hashing, and short-lived bearer access tokens.
- Database: SQLAlchemy auth and product models. Alembic revisions `20261025_01` and `eff0170fdee4` are applied to the configured development database.
- Tests: backend pytest and frontend Vitest include auth and group/expense/balance/settlement workflows; these are API tests against an isolated SQLite database, not browser-to-PostgreSQL tests.

See [the project audit](docs/PROJECT_AUDIT.md), [implementation log](docs/IMPLEMENTATION_LOG.md), [project decisions](docs/PROJECT_DECISIONS.md), [known issues](docs/KNOWN_ISSUES_AND_FIXES.md), and [test report](docs/TEST_REPORT.md) for verified status and open decisions. Product and architecture specifications are also in `docs/`.

Auth details: [API documentation](docs/API_DOCUMENTATION.md), [database design](docs/DATABASE_DESIGN.md), [backend architecture](docs/BACKEND_ARCHITECTURE.md), [frontend architecture](docs/FRONTEND_ARCHITECTURE.md).

## Requirements

- Python 3.13 or newer and [`uv`](https://docs.astral.sh/uv/)
- Node.js and npm
- PostgreSQL for database readiness and database-backed development

## Local setup

From the repository root, install the Python dependencies:

```powershell
uv sync
```

Create a local environment file only if one does not already exist. Edit its placeholders locally; do not commit `.env` or paste secret values into logs or documentation.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Set `DATABASE_URL` to a PostgreSQL URL using the Psycopg 3 driver, for example:

```text
postgresql+psycopg://<user>:<password>@localhost:5432/<database>
```

`DATABASE_URL` is optional for starting the database-independent API liveness endpoint. `/ready` returns HTTP 503 until PostgreSQL is configured and reachable. Development allows the local Vite origins (`localhost:5173` and `127.0.0.1:5173`) by default. `CORS_ORIGINS` overrides this with a comma-separated list of exact origins; set production origins explicitly.

Set a random `SECRET_KEY` of at least 32 characters in `.env`. Brevo settings are `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME`; the sender must be verified in Brevo. Never put provider credentials in frontend environment variables. For local exploration only, `DEV_OTP_BYPASS=true` plus six-digit `DEV_OTP_CODE` suppresses email and accepts that code only for a normally issued, valid OTP from loopback. Disable this mode after testing; application configuration rejects it outside `ENVIRONMENT=development`.

```powershell
uv run alembic -c backend/alembic.ini upgrade head
```

Install frontend dependencies:

```powershell
cd frontend
npm ci
```

The frontend defaults its API base URL to `http://127.0.0.1:8000`. To override it, create `frontend/.env.local` from `frontend/.env.example` and set `VITE_API_BASE_URL`.

## Run locally

Start the backend from the repository root:

```powershell
uv run uvicorn backend.app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`. FastAPI's interactive docs are at `http://127.0.0.1:8000/docs`; liveness is `GET /health`, database readiness is `GET /ready`, and versioned API liveness is `GET /api/v1/health`.

In another terminal, start the frontend:

```powershell
cd frontend
npm run dev
```

Vite prints the local frontend URL when it starts.

## Verification

Run backend tests from the repository root:

```powershell
uv run pytest -q
```

Run frontend checks from `frontend/`:

```powershell
npm run build
npm run lint
npm run typecheck
npm run test
```

The backend suite covers auth and product workflows with mocked email delivery and isolated databases. These checks are not browser-to-PostgreSQL end-to-end tests. Real Brevo inbox delivery requires an accepted API key and a controlled recipient.

## Database safety

The configured development database was checked before applying the additive product migration `eff0170fdee4`; Alembic reports no schema drift. Do not use `create_all`, reset the database, or skip migration review in other environments.

## Repository layout

```text
backend/       FastAPI application, SQLAlchemy setup, migrations, and tests
frontend/      React/TypeScript application and frontend tests
ai/            Reserved for later optional AI capabilities
docs/          Product specifications and operational project records
```
