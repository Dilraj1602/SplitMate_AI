import ipaddress
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.dependencies import get_current_user, get_db
from backend.app.config import settings
from backend.app.models import User
from backend.app.schemas.auth import EmailOtpRequest, EmailRequest, LoginRequest, PasswordResetConfirm, RegisterRequest
from backend.app.services import auth as auth_service
from backend.app.services.auth import EMAIL_VERIFICATION, PASSWORD_RESET, OtpRateLimitError
from backend.app.services.email import EmailConfigurationError, EmailDeliveryError, send_auth_code

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)
RESET_COOKIE = "splitmate_password_reset"
RESET_COOKIE_PATH = "/api/v1/auth/password-reset"


@router.get("/me", summary="Restore the signed-in user")
def current_user(user: User = Depends(get_current_user)):
    return {"data": {"id": str(user.id), "email": user.email, "username": user.username, "display_name": user.display_name}}
def _require_reset_origin(request: Request) -> None:
    origin = request.headers.get("origin", "").rstrip("/")
    allowed = {value.rstrip("/") for value in settings.effective_cors_origins}
    if not origin or origin not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The password-reset request origin is not allowed.")


def _set_reset_cookie(response: Response, token: str) -> None:
    production = settings.environment.lower() == "production"
    response.set_cookie(
        RESET_COOKIE,
        token,
        max_age=auth_service.PASSWORD_RESET_SESSION_MINUTES * 60,
        httponly=True,
        secure=production or settings.environment.lower() != "development",
        samesite="none" if production or settings.environment.lower() != "development" else "lax",
        path=RESET_COOKIE_PATH,
    )


def _clear_reset_cookie(response: Response) -> None:
    production = settings.environment.lower() == "production"
    response.delete_cookie(
        RESET_COOKIE,
        path=RESET_COOKIE_PATH,
        httponly=True,
        secure=production or settings.environment.lower() != "development",
        samesite="none" if production or settings.environment.lower() != "development" else "lax",
    )


async def _send_code(db: Session, user: User, purpose: str) -> bool:
    try:
        # Keep the OTP and invalidation of its predecessor uncommitted until
        # Brevo accepts delivery. On provider failure, rollback preserves the
        # previous usable code and avoids consuming the resend window.
        code = auth_service.issue_otp(db, user, purpose, commit=False)
    except OtpRateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Please wait before requesting another code.") from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured.") from exc
    if settings.dev_otp_bypass and settings.environment.lower() == "development":
        # Local testing mode deliberately skips external delivery. The code is
        # still issued as a normal purpose-bound, expiring, single-use OTP.
        db.commit()
        return False
    try:
        await send_auth_code(user.email, purpose, code)
    except (EmailConfigurationError, EmailDeliveryError) as exc:
        db.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Email delivery is temporarily unavailable. Please try again later.") from exc
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("OTP persistence failed after provider acceptance", extra={
            "email_operation": purpose.lower(), "error_category": "otp_persistence_failure",
        })
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The email was accepted but the code could not be saved. Please request a new code.") from exc
    return True


def _prepare_registration_code(db: Session, user: User) -> str:
    """Persist an OTP before returning; email delivery runs after the response."""
    try:
        # Materialize the UUID and user row before the OTP service locks it.
        db.flush()
        code = auth_service.issue_otp(db, user, EMAIL_VERIFICATION, commit=False)
        db.commit()
        return code
    except OtpRateLimitError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Please wait before requesting another code.") from exc
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured.") from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with these details already exists.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Registration could not be completed. Please try again.") from exc


async def _deliver_registration_code(email: str, code: str) -> None:
    try:
        await send_auth_code(email, EMAIL_VERIFICATION, code)
    except (EmailConfigurationError, EmailDeliveryError):
        # The account and OTP are committed. A user can request another code;
        # provider latency or downtime must not hold the registration request open.
        logger.exception("Registration verification email delivery failed", extra={
            "email_operation": "email_verification", "error_category": "background_delivery_failure",
        })


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
def register(payload: RegisterRequest, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
            if settings.dev_otp_bypass and settings.environment.lower() == "development":
                _prepare_registration_code(db, existing)
                db.close()
                return {
                    "message": "Local development OTP is enabled; email was not sent. Enter the configured development code.",
                    "expires_in_seconds": auth_service.settings.otp_expiry_minutes * 60,
                }
            code = _prepare_registration_code(db, existing)
            email_to_deliver = existing.email
            db.close()
            background_tasks.add_task(_deliver_registration_code, email_to_deliver, code)
            return {
                "message": "Registration is pending email verification. Check your email for the code.",
                "expires_in_seconds": auth_service.settings.otp_expiry_minutes * 60,
            }
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with these details already exists.")
    user = User(email=email, username=username, display_name=payload.display_name.strip(), hashed_password=auth_service.hash_password(payload.password), is_active=False, is_email_verified=False)
    db.add(user)
    # The user row and initial OTP commit together, so a failed OTP write cannot
    # leave an account that cannot complete verification.
    code = _prepare_registration_code(db, user)
    email_to_deliver = user.email
    db.close()
    email_sent = not (settings.dev_otp_bypass and settings.environment.lower() == "development")
    if email_sent:
        background_tasks.add_task(_deliver_registration_code, email_to_deliver, code)
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
    email = str(payload.email).strip().lower()
    client_ip = request.client.host if request.client else "unknown"
    if settings.dev_otp_bypass:
        _require_loopback_for_dev_otp(request)
    try:
        auth_service.record_password_reset_request_ip(db, client_ip)
    except OtpRateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many password-reset requests. Please try again later.") from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured.") from exc
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This email isn't registered.")
    if not user.is_active or not user.is_email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account can't reset its password.")
    email_sent = await _send_code(db, user, PASSWORD_RESET)
    return {
        "message": "Local development code is ready; email was not sent." if not email_sent else "Verification code sent.",
        "expires_in_seconds": auth_service.settings.otp_expiry_minutes * 60,
        "resend_after_seconds": auth_service.settings.otp_resend_cooldown_seconds,
    }


@router.post("/password-reset/verify", summary="Verify a password-reset OTP and establish a reset session")
def verify_password_reset_code(payload: EmailOtpRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    _require_reset_origin(request)
    _require_loopback_for_dev_otp(request)
    token = auth_service.issue_password_reset_session(db, str(payload.email).strip().lower(), payload.code)
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The code is invalid or expired.")
    _set_reset_cookie(response, token)
    return {"data": {"valid": True, "expires_in_seconds": auth_service.PASSWORD_RESET_SESSION_MINUTES * 60}}


@router.get("/password-reset/session", summary="Check the current password-reset session")
def check_password_reset_session(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(RESET_COOKIE)
    if token and auth_service.get_password_reset_session(db, token):
        return {"data": {"valid": True}}
    response = JSONResponse({"detail": "The password-reset session is invalid or expired."}, status_code=status.HTTP_401_UNAUTHORIZED)
    _clear_reset_cookie(response)
    return response


@router.post("/password-reset/session/revoke", summary="Revoke the current password-reset session")
def revoke_password_reset_session(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_reset_origin(request)
    token = request.cookies.get(RESET_COOKIE)
    if token:
        try:
            auth_service.revoke_password_reset_session(db, token)
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The reset session could not be cleared. Please try again.") from exc
    _clear_reset_cookie(response)
    return {"data": {"revoked": True}}


@router.post("/password-reset/confirm", summary="Set a new password using the reset session")
def confirm_password_reset(payload: PasswordResetConfirm, request: Request, db: Session = Depends(get_db)):
    _require_reset_origin(request)
    token = request.cookies.get(RESET_COOKIE)
    if not token:
        response = JSONResponse({"detail": "The password-reset session is invalid or expired. Start again."}, status_code=status.HTTP_401_UNAUTHORIZED)
        _clear_reset_cookie(response)
        return response
    try:
        user = auth_service.complete_password_reset(db, token, payload.new_password)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("Password reset database transaction failed", extra={"error_category": "password_reset_database_failure"})
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The password could not be updated. Please try again.") from exc
    if not user:
        response = JSONResponse({"detail": "The password-reset session is invalid or expired. Start again."}, status_code=status.HTTP_401_UNAUTHORIZED)
        _clear_reset_cookie(response)
        return response
    response = Response(content='{"message":"Password updated successfully."}', media_type="application/json")
    _clear_reset_cookie(response)
    return response


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
