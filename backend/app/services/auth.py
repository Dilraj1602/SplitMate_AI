import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models import AuthOtp, AuthOtpIpRequest, User

password_hash = PasswordHash.recommended()
EMAIL_VERIFICATION = "EMAIL_VERIFICATION"
PASSWORD_RESET = "PASSWORD_RESET"
PASSWORD_RESET_SESSION_MINUTES = 15
OTP_IP_RATE_LIMIT_PER_HOUR = 30


class OtpRateLimitError(Exception):
    pass


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)


def make_access_token(user: User) -> str:
    if not settings.secret_key:
        raise RuntimeError("Authentication signing key is not configured")
    now = datetime.now(UTC)
    return jwt.encode({"sub": str(user.id), "iat": now, "exp": now + timedelta(minutes=settings.access_token_expiry_minutes), "ver": user.auth_token_version or 0}, settings.secret_key, algorithm="HS256")


def _otp_hash(email: str, purpose: str, code: str) -> str:
    if not settings.secret_key:
        raise RuntimeError("Authentication signing key is not configured")
    payload = f"{email.lower()}:{purpose}:{code}".encode()
    return hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).hexdigest()


def _reset_token_hash(token: str) -> str:
    if not settings.secret_key:
        raise RuntimeError("Authentication signing key is not configured")
    return hmac.new(settings.secret_key.encode(), f"PASSWORD_RESET_SESSION:{token}".encode(), hashlib.sha256).hexdigest()


def record_password_reset_request_ip(db: Session, ip_address: str) -> None:
    """Apply a shared database-backed hourly limit without retaining raw IPs."""
    if not settings.secret_key:
        raise RuntimeError("Authentication signing key is not configured")
    now = datetime.now(UTC)
    ip_hash = hmac.new(settings.secret_key.encode(), ip_address.encode(), hashlib.sha256).hexdigest()
    since = now - timedelta(hours=1)
    db.execute(delete(AuthOtpIpRequest).where(AuthOtpIpRequest.created_at < now - timedelta(days=1)))
    recent = db.scalars(select(AuthOtpIpRequest.id).where(
        AuthOtpIpRequest.ip_hash == ip_hash,
        AuthOtpIpRequest.purpose == PASSWORD_RESET,
        AuthOtpIpRequest.created_at >= since,
    ).limit(OTP_IP_RATE_LIMIT_PER_HOUR).with_for_update()).all()
    if len(recent) >= OTP_IP_RATE_LIMIT_PER_HOUR:
        db.commit()
        raise OtpRateLimitError
    db.add(AuthOtpIpRequest(ip_hash=ip_hash, purpose=PASSWORD_RESET))
    db.commit()


def issue_otp(db: Session, user: User, purpose: str, *, commit: bool = True) -> str:
    now = datetime.now(UTC)
    # Serialize issuances for an account so simultaneous requests cannot leave
    # multiple newly-created codes usable or bypass the per-address limits.
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    recent = db.scalars(select(AuthOtp).where(AuthOtp.email == user.email, AuthOtp.purpose == purpose, AuthOtp.created_at >= now - timedelta(hours=1))).all()
    if len(recent) >= settings.otp_rate_limit_per_hour:
        raise OtpRateLimitError
    latest = max(recent, key=lambda item: item.created_at, default=None)
    if latest:
        created = latest.created_at if latest.created_at.tzinfo else latest.created_at.replace(tzinfo=UTC)
        if (now - created).total_seconds() < settings.otp_resend_cooldown_seconds:
            raise OtpRateLimitError
    db.query(AuthOtp).filter(AuthOtp.email == user.email, AuthOtp.purpose == purpose, AuthOtp.consumed_at.is_(None), AuthOtp.invalidated_at.is_(None)).update({AuthOtp.invalidated_at: now}, synchronize_session=False)
    code = (
        settings.dev_otp_code
        if settings.dev_otp_bypass and settings.environment.lower() == "development"
        else f"{secrets.randbelow(1_000_000):06d}"
    )
    db.add(AuthOtp(user_id=user.id, email=user.email, purpose=purpose, code_hash=_otp_hash(user.email, purpose, code), expires_at=now + timedelta(minutes=settings.otp_expiry_minutes)))
    db.flush()
    if commit:
        db.commit()
    return code


def consume_otp_record(db: Session, email: str, purpose: str, code: str, *, user_id=None) -> tuple[AuthOtp, User] | None:
    now = datetime.now(UTC)
    query = select(AuthOtp).where(AuthOtp.email == email.lower(), AuthOtp.purpose == purpose, AuthOtp.consumed_at.is_(None), AuthOtp.invalidated_at.is_(None)).order_by(AuthOtp.created_at.desc()).with_for_update()
    otp = db.scalar(query)
    if otp is None:
        return None
    expires = otp.expires_at if otp.expires_at.tzinfo else otp.expires_at.replace(tzinfo=UTC)
    if expires <= now or (user_id is not None and otp.user_id != user_id):
        otp.invalidated_at = now
        db.commit()
        return None
    if otp.attempts >= settings.otp_max_attempts:
        otp.invalidated_at = now
        db.commit()
        return None
    if not hmac.compare_digest(otp.code_hash, _otp_hash(email.lower(), purpose, code)):
        otp.attempts += 1
        if otp.attempts >= settings.otp_max_attempts:
            otp.invalidated_at = now
        db.commit()
        return None
    user = db.get(User, otp.user_id)
    if user is None or user.email.lower() != email.lower():
        otp.invalidated_at = now
        db.commit()
        return None
    otp.consumed_at = now
    db.flush()
    return otp, user


def consume_otp(db: Session, email: str, purpose: str, code: str, *, user_id=None) -> User | None:
    consumed = consume_otp_record(db, email, purpose, code, user_id=user_id)
    return consumed[1] if consumed else None


def issue_password_reset_session(db: Session, email: str, code: str) -> str | None:
    consumed = consume_otp_record(db, email.lower(), PASSWORD_RESET, code)
    if not consumed:
        return None
    otp, user = consumed
    if not user.is_active or not user.is_email_verified:
        otp.invalidated_at = datetime.now(UTC)
        db.commit()
        return None
    token = secrets.token_urlsafe(32)
    otp.reset_token_hash = _reset_token_hash(token)
    otp.reset_expires_at = datetime.now(UTC) + timedelta(minutes=PASSWORD_RESET_SESSION_MINUTES)
    db.commit()
    return token


def get_password_reset_session(db: Session, token: str) -> tuple[AuthOtp, User] | None:
    now = datetime.now(UTC)
    otp = db.scalar(select(AuthOtp).where(
        AuthOtp.purpose == PASSWORD_RESET,
        AuthOtp.reset_token_hash == _reset_token_hash(token),
        AuthOtp.reset_used_at.is_(None),
        AuthOtp.invalidated_at.is_(None),
    ))
    if not otp:
        return None
    expires = otp.reset_expires_at
    if not expires or (expires if expires.tzinfo else expires.replace(tzinfo=UTC)) <= now:
        return None
    user = db.get(User, otp.user_id)
    if not user or not user.is_active or not user.is_email_verified:
        return None
    return otp, user


def revoke_password_reset_session(db: Session, token: str) -> None:
    now = datetime.now(UTC)
    db.execute(update(AuthOtp).where(
        AuthOtp.purpose == PASSWORD_RESET,
        AuthOtp.reset_token_hash == _reset_token_hash(token),
        AuthOtp.reset_used_at.is_(None),
    ).values(reset_used_at=now, invalidated_at=now).execution_options(synchronize_session=False))
    db.commit()


def complete_password_reset(db: Session, token: str, new_password: str) -> User | None:
    now = datetime.now(UTC)
    token_hash = _reset_token_hash(token)
    otp = db.scalar(select(AuthOtp).where(
        AuthOtp.purpose == PASSWORD_RESET,
        AuthOtp.reset_token_hash == token_hash,
        AuthOtp.reset_used_at.is_(None),
        AuthOtp.invalidated_at.is_(None),
    ).with_for_update())
    if not otp or not otp.reset_expires_at:
        return None
    expires = otp.reset_expires_at if otp.reset_expires_at.tzinfo else otp.reset_expires_at.replace(tzinfo=UTC)
    if expires <= now:
        return None
    user = db.scalar(select(User).where(User.id == otp.user_id).with_for_update())
    if not user or not user.is_active or not user.is_email_verified:
        return None
    claimed = db.execute(update(AuthOtp).where(
        AuthOtp.id == otp.id,
        AuthOtp.reset_token_hash == token_hash,
        AuthOtp.reset_used_at.is_(None),
        AuthOtp.invalidated_at.is_(None),
        AuthOtp.reset_expires_at > now,
    ).values(reset_used_at=now, invalidated_at=now).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        return None
    user.hashed_password = hash_password(new_password)
    user.auth_token_version = (user.auth_token_version or 0) + 1
    db.query(AuthOtp).filter(
        AuthOtp.user_id == user.id,
        AuthOtp.purpose == PASSWORD_RESET,
        AuthOtp.invalidated_at.is_(None),
    ).update({AuthOtp.invalidated_at: now}, synchronize_session=False)
    db.commit()
    return user
