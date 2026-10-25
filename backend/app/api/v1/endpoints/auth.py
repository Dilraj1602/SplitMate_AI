import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.dependencies import get_db
from backend.app.config import settings
from backend.app.models import AuthOtp, User
from backend.app.schemas.auth import EmailOtpRequest, EmailRequest, LoginRequest, PasswordResetRequest, RegisterRequest
from backend.app.services import auth as auth_service
from backend.app.services.auth import EMAIL_VERIFICATION, PASSWORD_RESET, OtpRateLimitError
from backend.app.services.email import EmailConfigurationError, EmailDeliveryError, send_auth_code

router = APIRouter(prefix="/auth", tags=["Authentication"])
GENERIC_RESET = {"message": "If an eligible account matches, an email will be sent if delivery succeeds. If no email arrives, try again later."}


async def _send_code(db: Session, user: User, purpose: str) -> bool:
    try:
        code = auth_service.issue_otp(db, user, purpose)
    except OtpRateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Please wait before requesting another code.") from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured.") from exc
    if settings.dev_otp_bypass and settings.environment.lower() == "development":
        # Local testing mode deliberately skips external delivery. The code is
        # still issued as a normal purpose-bound, expiring, single-use OTP.
        return False
    try:
        await send_auth_code(user.email, purpose, code)
    except (EmailConfigurationError, EmailDeliveryError) as exc:
        otp = db.scalar(select(AuthOtp).where(
            AuthOtp.email == user.email,
            AuthOtp.purpose == purpose,
            AuthOtp.consumed_at.is_(None),
        ).order_by(AuthOtp.created_at.desc()))
        if otp:
            from datetime import UTC, datetime
            otp.invalidated_at = datetime.now(UTC)
            db.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Email delivery is temporarily unavailable. Please try again later.") from exc
    return True


def _require_loopback_for_dev_otp(request: Request) -> None:
    if not settings.dev_otp_bypass:
        return
    host = request.client.host if request.client else ""
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if settings.environment.lower() != "development" or not loopback:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Development OTP is only available from localhost.")


@router.post("/register", status_code=status.HTTP_202_ACCEPTED, summary="Register and send an email verification code")
async def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    _require_loopback_for_dev_otp(request)
    email = str(payload.email).strip().lower()
    username = payload.username.strip().lower()
    existing = db.scalar(select(User).where((func.lower(User.email) == email) | (func.lower(User.username) == username)))
    if existing:
        same_identity = existing.email.lower() == email and existing.username.lower() == username
        password_matches = bool(
            same_identity
            and not existing.is_email_verified
            and existing.hashed_password
            and auth_service.verify_password(payload.password, existing.hashed_password)
        )
        if password_matches:
            # A cooldown means no new email was attempted. Return 429 instead
            # of a success that would send the UI to an OTP form without a code.
            email_sent = await _send_code(db, existing, EMAIL_VERIFICATION)
            return {
                "message": (
                    "Registration is pending email verification. Check your email for the code."
                    if email_sent
                    else "Local development OTP is enabled; email was not sent. Enter the configured development code."
                ),
                "expires_in_seconds": auth_service.settings.otp_expiry_minutes * 60,
            }
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with these details already exists.")
    user = User(email=email, username=username, display_name=payload.display_name.strip(), hashed_password=auth_service.hash_password(payload.password), is_active=False, is_email_verified=False)
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with these details already exists.") from exc
    email_sent = await _send_code(db, user, EMAIL_VERIFICATION)
    return {
        "message": (
            "Registration started. Check your email for a verification code."
            if email_sent
            else "Local development OTP is enabled; email was not sent. Enter the configured development code."
        ),
        "expires_in_seconds": auth_service.settings.otp_expiry_minutes * 60,
    }


@router.post("/verify-email", summary="Verify an account email using a one-time code")
def verify_email(payload: EmailOtpRequest, request: Request, db: Session = Depends(get_db)):
    _require_loopback_for_dev_otp(request)
    email = str(payload.email).lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email).with_for_update())
    if not user or user.is_email_verified:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The code is invalid or expired.")
    verified = auth_service.consume_otp(db, email, EMAIL_VERIFICATION, payload.code, user_id=user.id)
    if not verified:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The code is invalid or expired.")
    verified.is_email_verified = True
    verified.is_active = True
    db.commit()
    return {"message": "Email verified. You can now sign in."}


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED, summary="Resend an email verification code")
async def resend_verification(payload: EmailRequest, request: Request, db: Session = Depends(get_db)):
    _require_loopback_for_dev_otp(request)
    user = db.scalar(select(User).where(func.lower(User.email) == str(payload.email).lower()))
    if settings.dev_otp_bypass:
        if user and not user.is_email_verified:
            await _send_code(db, user, EMAIL_VERIFICATION)
            return {"message": "Local development code is ready. Email is disabled in this mode."}
        return {"message": "If an unverified account matches, follow the local development verification flow."}
    if user and not user.is_email_verified:
        try:
            await _send_code(db, user, EMAIL_VERIFICATION)
        except HTTPException as exc:
            if exc.status_code not in (status.HTTP_429_TOO_MANY_REQUESTS, status.HTTP_503_SERVICE_UNAVAILABLE):
                raise
    return {"message": "If an unverified account matches, an email will be sent if delivery succeeds. If no email arrives, try again later."}


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED, summary="Request a password reset code")
async def request_password_reset(payload: EmailRequest, request: Request, db: Session = Depends(get_db)):
    # Development test codes are accepted only from local clients.
    if settings.dev_otp_bypass:
        _require_loopback_for_dev_otp(request)
        user = db.scalar(select(User).where(func.lower(User.email) == str(payload.email).lower()))
        if user and user.is_active and user.is_email_verified:
            await _send_code(db, user, PASSWORD_RESET)
            return {"message": "Local development code is ready. Email is disabled in this mode."}
        return GENERIC_RESET
    user = db.scalar(select(User).where(func.lower(User.email) == str(payload.email).lower()))
    if user and user.is_active and user.is_email_verified:
        try:
            await _send_code(db, user, PASSWORD_RESET)
        except HTTPException as exc:
            # Keep account existence private for reset requests, including cooldown/provider errors.
            if exc.status_code not in (status.HTTP_429_TOO_MANY_REQUESTS, status.HTTP_503_SERVICE_UNAVAILABLE):
                raise
    return GENERIC_RESET


@router.post("/password-reset/confirm", summary="Verify a reset code and set a new password")
def confirm_password_reset(payload: PasswordResetRequest, request: Request, db: Session = Depends(get_db)):
    _require_loopback_for_dev_otp(request)
    email = str(payload.email).lower()
    user = auth_service.consume_otp(db, email, PASSWORD_RESET, payload.code)
    if not user or not user.is_active or not user.is_email_verified:
        if user:
            db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The code is invalid or expired.")
    user.hashed_password = auth_service.hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated. Sign in with your new password."}


@router.post("/login", summary="Sign in with a verified account")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user or not user.hashed_password or not auth_service.verify_password(payload.password, user.hashed_password) or not user.is_active or not user.is_email_verified:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.", headers={"WWW-Authenticate": "Bearer"})
    try:
        token = auth_service.make_access_token(user)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured.") from exc
    return {"data": {"access_token": token, "token_type": "bearer"}}
