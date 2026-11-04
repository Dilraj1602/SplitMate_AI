from collections.abc import Generator
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.dependencies import get_db
from backend.app.main import app
from backend.app.models import AutopayOccurrence, AutopayReminderLog, Expense, Membership, User
from backend.app.services.auth import hash_password, make_access_token
from backend.app.services.autopay import process_autopays


def test_autopay_approval_controls_generation_and_reminder_idempotency(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    secret = "test-secret-key-that-is-at-least-32-bytes-long"
    monkeypatch.setattr("backend.app.dependencies.settings.secret_key", secret)
    monkeypatch.setattr("backend.app.services.auth.settings.secret_key", secret)

    def override_db() -> Generator[Session, None, None]:
        with Session(engine, autoflush=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with Session(engine) as session:
            alice = User(username="autopay_alice", display_name="Alice", email="autopay_alice@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True)
            bob = User(username="autopay_bob", display_name="Bob", email="autopay_bob@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True)
            session.add_all([alice, bob]); session.commit()
            alice_id, bob_id = alice.id, bob.id
            alice_token, bob_token = make_access_token(alice), make_access_token(bob)
        client = TestClient(app)
        alice_headers = {"Authorization": f"Bearer {alice_token}"}
        bob_headers = {"Authorization": f"Bearer {bob_token}"}
        group_response = client.post("/api/v1/groups", headers=alice_headers, json={"name": "Autopay Test"})
        assert group_response.status_code == 201
        group_id = UUID(group_response.json()["data"]["id"])
        with Session(engine) as session:
            session.add(Membership(group_id=group_id, user_id=bob_id, role="member", status="active")); session.commit()

        schedule_date = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        created = client.post(f"/api/v1/groups/{group_id}/autopays", headers=alice_headers, json={
            "description": "Internet", "amount": "1200.00", "currency": "INR", "payer_user_id": str(alice_id),
            "split_type": "equal", "splits": [{"user_id": str(alice_id), "amount": "0"}, {"user_id": str(bob_id), "amount": "0"}],
            "frequency": "monthly", "repeat_interval": 1, "start_date": schedule_date.isoformat(), "timezone": "Asia/Kolkata",
        })
        assert created.status_code == 201, created.text
        autopay_id = UUID(created.json()["data"]["id"])
        invitation = next(item for item in client.get("/api/v1/notifications", headers=bob_headers).json()["data"]
            if item["related_entity_id"] == str(autopay_id))
        assert invitation["related_entity_status"] == "pending"
        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(Expense)) == 0

        assert client.post(f"/api/v1/autopays/{autopay_id}/accept", headers=bob_headers).status_code == 200
        answered_invitation = next(item for item in client.get("/api/v1/notifications", headers=bob_headers).json()["data"]
            if item["id"] == invitation["id"])
        assert answered_invitation["related_entity_status"] == "accepted"
        assert answered_invitation["is_read"] is True
        assert client.post(f"/api/v1/autopays/{autopay_id}/accept", headers=bob_headers).status_code == 409
        assert client.post(f"/api/v1/autopays/{autopay_id}/pause", headers=bob_headers).status_code == 200
        with Session(engine) as session:
            process_autopays(session)
            assert session.scalar(select(func.count()).select_from(Expense)) == 0
        assert client.post(f"/api/v1/autopays/{autopay_id}/resume", headers=bob_headers).status_code == 200
        with Session(engine) as session:
            process_autopays(session)
            process_autopays(session)
            assert session.scalar(select(func.count()).select_from(Expense)) == 1
            assert session.scalar(select(func.count()).select_from(AutopayOccurrence).where(AutopayOccurrence.status == "processed")) == 1
            assert session.scalar(select(func.count()).select_from(AutopayReminderLog).where(AutopayReminderLog.reminder_type == "due_today")) == 2
        assert client.post(f"/api/v1/autopays/{autopay_id}/delete", headers=bob_headers).status_code == 200
        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(Expense)) == 1
        declined = client.post(f"/api/v1/groups/{group_id}/autopays", headers=alice_headers, json={
            "description": "Cloud storage", "amount": "100.00", "currency": "INR", "payer_user_id": str(alice_id),
            "split_type": "equal", "splits": [{"user_id": str(alice_id), "amount": "0"}, {"user_id": str(bob_id), "amount": "0"}],
            "frequency": "weekly", "repeat_interval": 1, "start_date": schedule_date.isoformat(), "timezone": "Asia/Kolkata",
        })
        declined_id = declined.json()["data"]["id"]
        response = client.post(f"/api/v1/autopays/{declined_id}/decline", headers=bob_headers)
        assert response.status_code == 200
        assert response.json()["data"]["status"] == "declined"
        declined_invitation = next(item for item in client.get("/api/v1/notifications", headers=bob_headers).json()["data"]
            if item["related_entity_id"] == declined_id)
        assert declined_invitation["related_entity_status"] == "declined"
        assert declined_invitation["is_read"] is True
        with Session(engine) as session:
            process_autopays(session)
            assert session.scalar(select(func.count()).select_from(Expense)) == 1
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()
