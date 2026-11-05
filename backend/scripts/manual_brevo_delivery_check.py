"""Send one explicit manual test message through Brevo's Email API.

Run with BREVO_TEST_RECIPIENT set to an inbox you control:
    uv run python backend/scripts/manual_brevo_delivery_check.py

This script is outside backend/tests so normal pytest runs never send email.
"""
import asyncio
import os
import sys

from backend.app.services.email import EmailConfigurationError, EmailDeliveryError, send_transactional_email


async def main() -> int:
    recipient = (os.environ.get("BREVO_TEST_RECIPIENT") or "").strip()
    if not recipient:
        print("Set BREVO_TEST_RECIPIENT to an inbox you control before running this check.", file=sys.stderr)
        return 2
    try:
        result = await send_transactional_email(
            recipient,
            "SplitMate AI Brevo delivery check",
            "<html><body><h1>SplitMate AI</h1><p>Manual Brevo Email API test.</p></body></html>",
            "SplitMate AI manual Brevo Email API test.",
            operation="manual_delivery_check",
        )
    except (EmailConfigurationError, EmailDeliveryError) as exc:
        print(f"Brevo email request failed: {exc}", file=sys.stderr)
        return 1
    print(f"Brevo accepted the test email. Message ID: {result.message_id}; HTTP {result.http_status}.")
    print("Check Brevo transactional logs and the recipient inbox to confirm delivery.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
