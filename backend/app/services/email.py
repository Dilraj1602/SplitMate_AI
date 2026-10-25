from dataclasses import dataclass

import httpx

from backend.app.config import settings

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


class EmailConfigurationError(Exception):
    pass


class EmailDeliveryError(Exception):
    pass


@dataclass(frozen=True)
class EmailResult:
    accepted: bool


def auth_email_content(purpose: str, code: str, expiry_minutes: int) -> tuple[str, str, str]:
    action = "verify your email address" if purpose == "EMAIL_VERIFICATION" else "reset your password"
    subject = "Verify your SplitMateAi email" if purpose == "EMAIL_VERIFICATION" else "Reset your SplitMateAi password"
    html = ("<div style='font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17211b'>"
            f"<h1>SplitMateAi</h1><p>Use this code to {action}:</p>"
            f"<p style='font-size:30px;font-weight:bold;letter-spacing:8px'>{code}</p>"
            f"<p>This code expires in {expiry_minutes} minutes. Do not share it with anyone.</p></div>")
    plain = f"Use this code to {action}: {code}. It expires in {expiry_minutes} minutes. Do not share it with anyone."
    return subject, html, plain


async def send_transactional_email(to_email: str, subject: str, html: str, text: str) -> EmailResult:
    if not settings.brevo_api_key:
        raise EmailConfigurationError("Email delivery is not configured.")
    payload = {
        "sender": {"name": settings.brevo_sender_name, "email": settings.brevo_sender_email},
        "to": [{"email": to_email}], "subject": subject, "htmlContent": html, "textContent": text,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            response = await client.post(BREVO_URL, headers={"api-key": settings.brevo_api_key}, json=payload)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Provider response bodies may contain recipient/message data; do not expose or log them.
        raise EmailDeliveryError("The email provider rejected the message.") from exc
    except httpx.HTTPError as exc:
        raise EmailDeliveryError("The email provider could not be reached.") from exc
    return EmailResult(accepted=True)


async def send_auth_code(to_email: str, purpose: str, code: str) -> EmailResult:
    subject, html, plain = auth_email_content(purpose, code, settings.otp_expiry_minutes)
    return await send_transactional_email(to_email, subject, html, plain)
