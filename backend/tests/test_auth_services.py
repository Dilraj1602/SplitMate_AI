from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.app.db.session import Base
from backend.app.models import AuthOtp, User
from backend.app.services import auth


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def _user(db):
    user = User(username="testuser", display_name="Test User", email="person@example.com", hashed_password="hash", is_active=False, is_email_verified=False)
    db.add(user); db.commit(); db.refresh(user)
    return user


def test_otp_is_hashed_bound_to_purpose_and_single_use(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth.settings, "dev_otp_bypass", False)
    user = _user(db)
    code = auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    row = db.query(AuthOtp).one()
    assert code not in row.code_hash
    assert auth.consume_otp(db, user.email, auth.PASSWORD_RESET, code) is None
    assert auth.consume_otp(db, user.email, auth.EMAIL_VERIFICATION, code, user_id=user.id) is user
    assert auth.consume_otp(db, user.email, auth.EMAIL_VERIFICATION, code, user_id=user.id) is None


def test_invalid_attempts_are_counted_and_code_expires(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth.settings, "dev_otp_bypass", False)
    monkeypatch.setattr(auth.settings, "otp_max_attempts", 2)
    user = _user(db)
    code = auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    assert auth.consume_otp(db, user.email, auth.EMAIL_VERIFICATION, "000000") is None
    row = db.query(AuthOtp).one()
    assert row.attempts == 1
    assert auth.consume_otp(db, user.email, auth.EMAIL_VERIFICATION, "000001") is None
    db.refresh(row)
    assert row.invalidated_at is not None

    code2 = auth.issue_otp(db, user, auth.PASSWORD_RESET)
    row2 = db.query(AuthOtp).filter_by(purpose=auth.PASSWORD_RESET).one()
    row2.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert auth.consume_otp(db, user.email, auth.PASSWORD_RESET, code2) is None
    db.refresh(row2)
    assert row2.invalidated_at is not None


def test_issuing_new_code_invalidates_previous_and_enforces_cooldown(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth.settings, "dev_otp_bypass", False)
    monkeypatch.setattr(auth.settings, "otp_resend_cooldown_seconds", 0)
    user = _user(db)
    auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    rows = db.query(AuthOtp).order_by(AuthOtp.created_at).all()
    assert rows[0].invalidated_at is not None
    assert rows[1].invalidated_at is None


def test_otp_cooldown_rejects_request_without_issuing_another_code(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth.settings, "dev_otp_bypass", False)
    monkeypatch.setattr(auth.settings, "otp_resend_cooldown_seconds", 60)
    user = _user(db)
    auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    with pytest.raises(auth.OtpRateLimitError):
        auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    assert db.query(AuthOtp).count() == 1


def test_local_dev_code_is_hashed_and_still_consumed_once(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr(auth.settings, "environment", "development")
    monkeypatch.setattr(auth.settings, "dev_otp_bypass", True)
    monkeypatch.setattr(auth.settings, "dev_otp_code", "444444")
    user = _user(db)
    auth.issue_otp(db, user, auth.EMAIL_VERIFICATION)
    row = db.query(AuthOtp).one()
    assert row.code_hash == auth._otp_hash(user.email, auth.EMAIL_VERIFICATION, "444444")
    assert auth.consume_otp(db, user.email, auth.PASSWORD_RESET, "444444") is None
    assert auth.consume_otp(db, user.email, auth.EMAIL_VERIFICATION, "444444", user_id=user.id) is user
    assert auth.consume_otp(db, user.email, auth.EMAIL_VERIFICATION, "444444", user_id=user.id) is None
