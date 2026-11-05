import asyncio
import httpx
import pytest

from backend.app.services import email


def test_brevo_request_has_sender_template_and_api_header(monkeypatch):
    async_client = httpx.AsyncClient
    monkeypatch.setattr(email.settings, "brevo_api_key", "test-key")
    monkeypatch.setattr(email.settings, "brevo_sender_email", "wolfstrix360@gmail.com")
    monkeypatch.setattr(email.settings, "brevo_sender_name", "SplitMateAi")
    seen = {}

    def handler(request):
        seen["headers"] = request.headers
        import json
        seen["payload"] = json.loads(request.content)
        return httpx.Response(201, json={"messageId": "provider-id"})

    monkeypatch.setattr(email.httpx, "AsyncClient", lambda **kwargs: async_client(transport=httpx.MockTransport(handler), **kwargs))
    subject, html, plain = email.auth_email_content("EMAIL_VERIFICATION", "123456", 5)
    result = asyncio.run(email.send_transactional_email("person@example.com", subject, html, plain))
    assert result.accepted
    assert seen["headers"]["api-key"] == "test-key"
    assert seen["headers"]["accept"] == "application/json"
    assert seen["headers"]["content-type"] == "application/json"
    assert seen["payload"]["sender"] == {"name": "SplitMateAi", "email": "wolfstrix360@gmail.com"}
    assert "123456" in seen["payload"]["htmlContent"]
    assert "123456" in seen["payload"]["textContent"]
    assert result.message_id == "provider-id"
    assert result.http_status == 201


def test_missing_brevo_key_fails_without_request(monkeypatch):
    monkeypatch.setattr(email.settings, "brevo_api_key", None)
    with pytest.raises(email.EmailConfigurationError):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))


def test_missing_or_invalid_sender_fails_before_request(monkeypatch):
    monkeypatch.setattr(email.settings, "brevo_api_key", "test-key")
    monkeypatch.setattr(email.settings, "brevo_sender_email", None)
    with pytest.raises(email.EmailConfigurationError, match="BREVO_SENDER_EMAIL"):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))
    monkeypatch.setattr(email.settings, "brevo_sender_email", "not-an-email")
    with pytest.raises(email.EmailConfigurationError, match="valid email address"):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))


@pytest.mark.parametrize(("status_code", "category"), [
    (400, "invalid_request_or_sender"),
    (401, "invalid_api_key_or_ip_authorization"),
    (403, "forbidden_or_ip_restriction"),
    (429, "rate_limited"),
    (503, "brevo_server_error"),
])
def test_brevo_http_failures_are_not_reported_as_success(monkeypatch, status_code, category):
    async_client = httpx.AsyncClient
    monkeypatch.setattr(email.settings, "brevo_api_key", "test-key")
    monkeypatch.setattr(email.settings, "brevo_sender_email", "sender@example.com")
    monkeypatch.setattr(email.httpx, "AsyncClient", lambda **kwargs: async_client(
        transport=httpx.MockTransport(lambda _request: httpx.Response(status_code, text="sensitive provider response")), **kwargs))
    with pytest.raises(email.EmailDeliveryError, match=category):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))


def test_unexpected_brevo_success_body_is_not_reported_as_accepted(monkeypatch):
    async_client = httpx.AsyncClient
    monkeypatch.setattr(email.settings, "brevo_api_key", "test-key")
    monkeypatch.setattr(email.settings, "brevo_sender_email", "sender@example.com")
    monkeypatch.setattr(email.httpx, "AsyncClient", lambda **kwargs: async_client(
        transport=httpx.MockTransport(lambda _request: httpx.Response(201, json={"unexpected": True})), **kwargs))
    with pytest.raises(email.EmailDeliveryError, match="unexpected response"):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))


def test_provider_error_and_timeout_are_safe(monkeypatch):
    async_client = httpx.AsyncClient
    monkeypatch.setattr(email.settings, "brevo_api_key", "test-key")
    monkeypatch.setattr(email.httpx, "AsyncClient", lambda **kwargs: async_client(transport=httpx.MockTransport(lambda _request: httpx.Response(401, text="secret detail")), **kwargs))
    with pytest.raises(email.EmailDeliveryError, match="rejected"):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))

    def timeout(_request):
        raise httpx.ReadTimeout("private details")
    monkeypatch.setattr(email.httpx, "AsyncClient", lambda **kwargs: async_client(transport=httpx.MockTransport(timeout), **kwargs))
    with pytest.raises(email.EmailDeliveryError, match="timed out"):
        asyncio.run(email.send_transactional_email("person@example.com", "subject", "html", "text"))
