from pathlib import Path

import pytest
from pydantic import ValidationError
from alembic.config import Config
from alembic.script import ScriptDirectory

from backend.app import dependencies as db_dependencies
from backend.app import main as main_module
from backend.app.config import Settings
from backend.app.dependencies import get_db
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_settings_can_load_database_url_from_environment(monkeypatch) -> None:
    database_url = "postgresql+psycopg://test:test@localhost/test_db"
    monkeypatch.setenv("DATABASE_URL", database_url)

    configured = Settings(_env_file=None)

    assert configured.database_url == database_url


def test_settings_parse_comma_separated_cors_origins(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example, http://localhost:5173")

    configured = Settings(_env_file=None)

    assert configured.cors_origins == [
        "https://app.example",
        "http://localhost:5173",
    ]


def test_settings_allow_database_independent_app_configuration() -> None:
    configured = Settings(_env_file=None)

    assert configured.database_url is None


def test_development_settings_default_to_local_vite_cors_origins() -> None:
    configured = Settings(_env_file=None)

    assert configured.effective_cors_origins == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def test_production_settings_do_not_infer_cors_origins() -> None:
    configured = Settings(_env_file=None, environment="production")

    assert configured.effective_cors_origins == []


def test_development_otp_cannot_be_enabled_in_production() -> None:
    with pytest.raises(ValidationError, match="only allowed when ENVIRONMENT=development"):
        Settings(_env_file=None, environment="production", dev_otp_bypass=True, dev_otp_code="444444")


def test_request_database_dependency_closes_session(monkeypatch) -> None:
    class FakeSession:
        closed = False

        def close(self) -> None:
            self.closed = True

    fake_session = FakeSession()
    monkeypatch.setattr(db_dependencies, "SessionLocal", lambda: fake_session)

    dependency = get_db()
    yielded = next(dependency)

    assert isinstance(yielded, FakeSession)

    with pytest.raises(RuntimeError, match="request failed"):
        dependency.throw(RuntimeError("request failed"))

    assert fake_session.closed


def test_alembic_uses_backend_migrations_and_registered_model_metadata() -> None:
    config = Config(str(PROJECT_ROOT / "backend" / "alembic.ini"))
    script_directory = ScriptDirectory.from_config(config)

    assert Path(script_directory.dir).resolve() == (
        PROJECT_ROOT / "backend" / "migrations"
    ).resolve()

    import backend.app.models  # noqa: F401 — model package populates shared Base metadata.
    from backend.app.db.session import Base

    assert "users" in Base.metadata.tables


def test_readiness_returns_unavailable_without_database(monkeypatch) -> None:
    monkeypatch.setattr(main_module, "engine", None)

    response = TestClient(main_module.app).get("/ready")

    assert response.status_code == 503
    assert response.json()["detail"] == "Database is not configured."


def test_readiness_executes_read_only_database_probe(monkeypatch) -> None:
    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement):
            assert str(statement) == "SELECT 1"

    class FakeEngine:
        def connect(self):
            return FakeConnection()

    monkeypatch.setattr(main_module, "engine", FakeEngine())

    response = TestClient(main_module.app).get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_versioned_health_and_openapi_are_registered() -> None:
    client = TestClient(main_module.app)

    response = client.get("/api/v1/health")
    schema = client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["api_version"] == "v1"
    assert "/api/v1/health" in schema.json()["paths"]


def test_development_cors_handles_registration_preflight() -> None:
    client = TestClient(main_module.app)

    response = client.options(
        "/api/v1/auth/register",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
