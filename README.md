# SplitMate AI

SplitMate AI is an expense-sharing application in active development. The repository currently contains a React/TypeScript frontend scaffold and a FastAPI backend foundation. Product workflows such as authentication, groups, invitations, expenses, balances, and settlements are not yet implemented end to end.

## Current status

- Frontend: Vite development/build setup, responsive screens and routes, API client, and deterministic client-side INR split preview.
- Backend: FastAPI liveness/readiness endpoints, environment-based configuration, SQLAlchemy session setup, PostgreSQL connectivity, and versioned API health route.
- Database: SQLAlchemy `User` model and Alembic environment are present. There are currently no migration revisions. Do not run a migration against a database until a reviewed revision exists.
- Tests: backend pytest suite and frontend Vitest suite cover the current foundation; they do not validate complete product workflows.

See [the project audit](docs/PROJECT_AUDIT.md), [implementation log](docs/IMPLEMENTATION_LOG.md), [project decisions](docs/PROJECT_DECISIONS.md), [known issues](docs/KNOWN_ISSUES_AND_FIXES.md), and [test report](docs/TEST_REPORT.md) for verified status and open decisions. Product and architecture specifications are also in `docs/`.

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

These checks validate the implemented scaffold and foundation only. They are not end-to-end application tests.

## Database safety

The configured development database has been checked with read-only queries. Alembic currently detects the model's missing table/indexes, and there are no migration revisions yet. No schema migration is ready to apply. Do not use `create_all`, reset the database, or apply schema changes to an existing database as a substitute for a reviewed migration.

## Repository layout

```text
backend/       FastAPI application, SQLAlchemy setup, migrations, and tests
frontend/      React/TypeScript application and frontend tests
ai/            Reserved for later optional AI capabilities
docs/          Product specifications and operational project records
```
