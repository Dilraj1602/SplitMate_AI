from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.api.v1.endpoints import auth as auth_routes
from backend.app.dependencies import get_db
from backend.app.main import app
from backend.app.db.session import Base
from backend.app.models import User
from backend.app.services.email import EmailDeliveryError


def test_registration_email_verification_login_and_password_reset(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    codes: dict[str, str] = {}
    monkeypatch.setattr(auth_routes.auth_service.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth_routes.auth_service.settings, "otp_resend_cooldown_seconds", 0)
    monkeypatch.setattr(auth_routes.auth_service.settings, "dev_otp_bypass", False)

    async def fake_send(email: str, purpose: str, code: str):
        codes[purpose] = code
        return None

    monkeypatch.setattr(auth_routes, "send_auth_code", fake_send)

    def override_db() -> Generator[Session, None, None]:
        with Session(engine, autoflush=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)
    try:
        registration = client.post("/api/v1/auth/register", json={
            "display_name": "Test Person", "username": "TESTPERSON", "email": "person@example.com", "password": "abcdef",
        })
        assert registration.status_code == 202
        repeated = client.post("/api/v1/auth/register", json={
            "display_name": "Changed name", "username": "TESTPERSON", "email": "person@example.com", "password": "abcdef",
        })
        assert repeated.status_code == 202
        with Session(engine) as session:
            assert session.query(User).count() == 1
            assert session.query(User).one().display_name == "Test Person"
        wrong_password_retry = client.post("/api/v1/auth/register", json={
            "display_name": "Test Person", "username": "TESTPERSON", "email": "person@example.com", "password": "different123",
        })
        assert wrong_password_retry.status_code == 409
        monkeypatch.setattr(auth_routes.auth_service.settings, "otp_resend_cooldown_seconds", 60)
        cooldown_retry = client.post("/api/v1/auth/register", json={
            "display_name": "Test Person", "username": "TESTPERSON", "email": "person@example.com", "password": "abcdef",
        })
        assert cooldown_retry.status_code == 429
        monkeypatch.setattr(auth_routes.auth_service.settings, "otp_resend_cooldown_seconds", 0)
        duplicate = client.post("/api/v1/auth/register", json={
            "display_name": "Other", "username": "other", "email": "PERSON@example.com", "password": "abcdef",
        })
        assert duplicate.status_code == 409

        login_data = {"email": "person@example.com", "password": "abcdef"}
        assert client.post("/api/v1/auth/login", json=login_data).status_code == 401
        verification = client.post("/api/v1/auth/verify-email", json={"email": "person@example.com", "code": codes["EMAIL_VERIFICATION"]})
        assert verification.status_code == 200
        assert client.post("/api/v1/auth/verify-email", json={"email": "person@example.com", "code": codes["EMAIL_VERIFICATION"]}).status_code == 400
        logged_in = client.post("/api/v1/auth/login", json=login_data)
        assert logged_in.status_code == 200
        assert logged_in.json()["data"]["access_token"]

        reset_request = client.post("/api/v1/auth/password-reset/request", json={"email": "person@example.com"})
        missing_request = client.post("/api/v1/auth/password-reset/request", json={"email": "missing@example.com"})
        assert reset_request.status_code == missing_request.status_code == 202
        assert reset_request.json() == missing_request.json()
        reset = client.post("/api/v1/auth/password-reset/confirm", json={
            "email": "person@example.com", "code": codes["PASSWORD_RESET"], "new_password": "newpass123",
        })
        assert reset.status_code == 200
        assert client.post("/api/v1/auth/login", json=login_data).status_code == 401
        assert client.post("/api/v1/auth/login", json={"email": "person@example.com", "password": "newpass123"}).status_code == 200
        with Session(engine) as session:
            user = session.query(User).one()
            assert user.is_active and user.is_email_verified
            assert user.hashed_password != "newpass123"
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_local_dev_otp_works_without_email_and_is_loopback_only(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(auth_routes.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth_routes.settings, "environment", "development")
    monkeypatch.setattr(auth_routes.settings, "dev_otp_bypass", True)
    monkeypatch.setattr(auth_routes.settings, "dev_otp_code", "444444")

    async def must_not_send(*_args, **_kwargs):
        raise AssertionError("Local dev OTP mode must not call the email provider")

    monkeypatch.setattr(auth_routes, "send_auth_code", must_not_send)

    def override_db() -> Generator[Session, None, None]:
        with Session(engine, autoflush=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        local = TestClient(app, client=("127.0.0.1", 50000))
        remote = TestClient(app, client=("192.0.2.10", 50001))
        remote_registration = remote.post("/api/v1/auth/register", json={
            "display_name": "Dev Person", "username": "devperson", "email": "dev@example.com", "password": "abcdef",
        })
        assert remote_registration.status_code == 403
        registration = local.post("/api/v1/auth/register", json={
            "display_name": "Dev Person", "username": "devperson", "email": "dev@example.com", "password": "abcdef",
        })
        assert registration.status_code == 202
        assert "email was not sent" in registration.json()["message"]
        assert remote.post("/api/v1/auth/verify-email", json={"email": "dev@example.com", "code": "444444"}).status_code == 403
        verified = local.post("/api/v1/auth/verify-email", json={"email": "dev@example.com", "code": "444444"})
        assert verified.status_code == 200
        with Session(engine) as session:
            user = session.query(User).one()
            assert user.is_active and user.is_email_verified
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
