"""Brevo transactional email delivery using its HTTP Email API."""
from dataclasses import dataclass
import hashlib
import html
import logging
from time import monotonic

import httpx
from pydantic import EmailStr, TypeAdapter, ValidationError

from backend.app.config import settings

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
logger = logging.getLogger(__name__)
_email_adapter = TypeAdapter(EmailStr)


class EmailConfigurationError(Exception):
    pass


class EmailDeliveryError(Exception):
    pass


@dataclass(frozen=True)
class EmailResult:
    accepted: bool
    message_id: str
    http_status: int
    duration_ms: int


def _recipient_id(email_address: str) -> str:
    """Return a stable, non-reversible identifier without logging an address."""
    return hashlib.sha256(email_address.strip().lower().encode()).hexdigest()[:12]


def _validate_email(value: str | None, setting_name: str) -> str:
    if not value or not value.strip():
        raise EmailConfigurationError(f"{setting_name} must be configured before sending email.")
    try:
        return str(_email_adapter.validate_python(value.strip()))
    except ValidationError as exc:
        raise EmailConfigurationError(f"{setting_name} must be a valid email address.") from exc


def auth_email_content(purpose: str, code: str, expiry_minutes: int) -> tuple[str, str, str]:
    if purpose == "EMAIL_VERIFICATION":
        action = "verify your email address"
        subject = "Verify your SplitMate AI email"
        heading = "Confirm your email"
    elif purpose == "PASSWORD_RESET":
        action = "reset your password"
        subject = "Reset your SplitMate AI password"
        heading = "Reset your password"
    else:
        raise ValueError("Unsupported authentication email purpose.")

    safe_code = html.escape(code)
    content = (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'></head>"
        "<body style='margin:0;background:#f5f6f2;font-family:Arial,Helvetica,sans-serif;color:#17211b'>"
        "<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='background:#f5f6f2;padding:32px 12px'>"
        "<tr><td align='center'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' "
        "style='max-width:560px;background:#fff;border:1px solid #e2e5de;border-radius:14px'>"
        "<tr><td style='padding:28px 28px 8px'><div style='font-size:20px;font-weight:700;color:#23634f'>SplitMate AI</div>"
        f"<h1 style='margin:24px 0 10px;font-size:24px'>{heading}</h1>"
        f"<p style='margin:0;color:#58645d;line-height:1.6'>Use this code to {action}:</p>"
        "</td></tr><tr><td align='center' style='padding:18px 28px'>"
        f"<div style='display:inline-block;border-radius:10px;background:#eff5f1;padding:15px 24px;color:#23634f;"
        f"font-size:32px;font-weight:700;letter-spacing:8px'>{safe_code}</div>"
        "</td></tr><tr><td style='padding:4px 28px 28px;color:#58645d;font-size:14px;line-height:1.6'>"
        f"<p>This code expires in {expiry_minutes} minutes.</p>"
        "<p style='margin-bottom:0'>For your security, never share this code. If you did not request it, you can ignore this email.</p>"
        "</td></tr></table><p style='margin:16px 0 0;color:#7a847e;font-size:12px'>SplitMate AI · Shared expenses, made clear</p>"
        "</td></tr></table></body></html>"
    )
    plain = (
        f"SplitMate AI — {heading}. Use this code to {action}: {code}. "
        f"It expires in {expiry_minutes} minutes. Never share this code. "
        "If you did not request it, you can ignore this email."
    )
    return subject, content, plain


async def send_transactional_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str,
    *,
    operation: str = "transactional",
) -> EmailResult:
    recipient_id = _recipient_id(to_email)
    api_key = (settings.brevo_api_key or "").strip()
    try:
        sender_email = _validate_email(settings.brevo_sender_email, "BREVO_SENDER_EMAIL")
        recipient_email = _validate_email(to_email, "recipient email")
    except EmailConfigurationError as exc:
        logger.error("Transactional email configuration error", extra={
            "email_operation": operation, "recipient_id": recipient_id, "error_category": "invalid_configuration",
            "configuration_error": str(exc),
        })
        raise
    if not api_key:
        logger.error("Transactional email configuration error", extra={
            "email_operation": operation, "recipient_id": recipient_id, "error_category": "missing_api_key",
        })
        raise EmailConfigurationError("BREVO_API_KEY must be configured before sending email.")

    payload = {
        "sender": {"name": (settings.brevo_sender_name or "SplitMate AI").strip(), "email": sender_email},
        "to": [{"email": recipient_email}],
        "subject": subject,
        "htmlContent": html_content,
        "textContent": text_content,
    }
    headers = {"api-key": api_key, "accept": "application/json", "content-type": "application/json"}
    started = monotonic()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            response = await client.post(BREVO_URL, headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        duration_ms = int((monotonic() - started) * 1000)
        logger.error("Brevo email request timed out", extra={
            "email_operation": operation, "recipient_id": recipient_id, "duration_ms": duration_ms,
            "error_category": "timeout",
        })
        raise EmailDeliveryError("The email provider timed out. Please try again later.") from exc
    except httpx.HTTPError as exc:
        duration_ms = int((monotonic() - started) * 1000)
        logger.error("Brevo email request failed", extra={
            "email_operation": operation, "recipient_id": recipient_id, "duration_ms": duration_ms,
            "error_category": "network_error", "provider_exception_type": type(exc).__name__,
        })
        raise EmailDeliveryError("The email provider could not be reached. Please try again later.") from exc

    duration_ms = int((monotonic() - started) * 1000)
    if response.status_code != 201:
        status_code = response.status_code
        try:
            error_body = response.json()
            raw_provider_code = error_body.get("code") if isinstance(error_body, dict) else None
        except ValueError:
            raw_provider_code = None
        provider_code = "".join(character for character in raw_provider_code if character.isalnum() or character in "_.-")[:80] if isinstance(raw_provider_code, str) else None
        if status_code == 400:
            category = "invalid_request_or_sender"
        elif status_code == 401:
            category = "invalid_api_key_or_ip_authorization"
        elif status_code == 403:
            category = "forbidden_or_ip_restriction"
        elif status_code == 429:
            category = "rate_limited"
        elif status_code >= 500:
            category = "brevo_server_error"
        elif 200 <= status_code < 300:
            category = "unexpected_success_response"
        else:
            category = "provider_rejected"
        logger.error("Brevo rejected transactional email (HTTP %s, category=%s%s)",
                     status_code, category,
                     f", code={provider_code}" if provider_code else "", extra={
            "email_operation": operation, "recipient_id": recipient_id, "http_status": status_code,
            "duration_ms": duration_ms, "error_category": category, "provider_error_code": provider_code,
        })
        raise EmailDeliveryError(f"Brevo rejected the email request ({category}).")

    try:
        body = response.json()
        message_id = body.get("messageId") if isinstance(body, dict) else None
    except ValueError as exc:
        message_id = None
        parse_error = exc
    else:
        parse_error = None
    if not isinstance(message_id, str) or not message_id.strip():
        logger.error("Brevo returned an unexpected success response", extra={
            "email_operation": operation, "recipient_id": recipient_id, "http_status": response.status_code,
            "duration_ms": duration_ms, "error_category": "unexpected_response_format",
        })
        raise EmailDeliveryError("Brevo returned an unexpected response. Please try again later.") from parse_error

    logger.info("Brevo accepted transactional email", extra={
        "email_operation": operation, "recipient_id": recipient_id, "http_status": response.status_code,
        "message_id": message_id, "duration_ms": duration_ms, "delivery_state": "accepted_by_provider",
    })
    return EmailResult(accepted=True, message_id=message_id, http_status=response.status_code, duration_ms=duration_ms)


async def send_auth_code(to_email: str, purpose: str, code: str) -> EmailResult:
    subject, html_content, text_content = auth_email_content(purpose, code, settings.otp_expiry_minutes)
    return await send_transactional_email(to_email, subject, html_content, text_content, operation=purpose.lower())
