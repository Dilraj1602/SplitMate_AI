import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models import AuthOtp, User

password_hash = PasswordHash.recommended()
EMAIL_VERIFICATION = "EMAIL_VERIFICATION"
PASSWORD_RESET = "PASSWORD_RESET"


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
    return jwt.encode({"sub": str(user.id), "iat": now, "exp": now + timedelta(minutes=settings.access_token_expiry_minutes)}, settings.secret_key, algorithm="HS256")


def _otp_hash(email: str, purpose: str, code: str) -> str:
    if not settings.secret_key:
        raise RuntimeError("Authentication signing key is not configured")
    payload = f"{email.lower()}:{purpose}:{code}".encode()
    return hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).hexdigest()


def issue_otp(db: Session, user: User, purpose: str) -> str:
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
    db.commit()
    return code


def consume_otp(db: Session, email: str, purpose: str, code: str, *, user_id=None) -> User | None:
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
    return user
