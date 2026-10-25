from collections.abc import Generator
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.dependencies import get_db
from backend.app.main import app
from backend.app.models import Membership, User
from backend.app.services.auth import hash_password, make_access_token


def test_group_expense_balance_settlement_and_notifications(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr("backend.app.dependencies.settings.secret_key", "test-secret-key-that-is-at-least-32-bytes-long")
    monkeypatch.setattr("backend.app.services.auth.settings.secret_key", "test-secret-key-that-is-at-least-32-bytes-long")

    def override_db() -> Generator[Session, None, None]:
        with Session(engine, autoflush=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with Session(engine) as session:
            alice = User(username="alice", display_name="Alice", email="alice@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True)
            bob = User(username="bob", display_name="Bob", email="bob@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True)
            carol = User(username="carol", display_name="Carol", email="carol@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True)
            session.add_all([alice, bob, carol])
            session.commit()
            alice_id, bob_id = alice.id, bob.id
            alice_token, bob_token, carol_token = make_access_token(alice), make_access_token(bob), make_access_token(carol)

        client = TestClient(app)
        assert client.get("/api/v1/dashboard").status_code == 401
        alice_headers = {"Authorization": f"Bearer {alice_token}"}
        bob_headers = {"Authorization": f"Bearer {bob_token}"}
        carol_headers = {"Authorization": f"Bearer {carol_token}"}
        group_response = client.post("/api/v1/groups", headers=alice_headers, json={"name": "Weekend", "description": "Trip"})
        assert group_response.status_code == 201, group_response.text
        group_id = group_response.json()["data"]["id"]

        with Session(engine) as session:
            session.add(Membership(group_id=UUID(group_id), user_id=bob_id, role="member", status="active"))
            session.commit()

        link_response = client.post(f"/api/v1/groups/{group_id}/invite-links", headers=alice_headers)
        assert link_response.status_code == 201, link_response.text
        invite_url = link_response.json()["data"]["url"]
        token = invite_url.rsplit("/", 1)[-1]
        assert client.get(f"/api/v1/invite-links/{token}/preview").status_code == 200
        join_request = client.post(f"/api/v1/invite-links/{token}/join-requests", headers=carol_headers)
        assert join_request.status_code == 202, join_request.text
        requests = client.get(f"/api/v1/groups/{group_id}/join-requests", headers=alice_headers)
        assert requests.status_code == 200 and len(requests.json()["data"]) == 1
        request_id = requests.json()["data"][0]["id"]
        approved = client.post(f"/api/v1/groups/{group_id}/join-requests/{request_id}/approve", headers=alice_headers)
        assert approved.status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}/members", headers=carol_headers).status_code == 200

        expense_response = client.post(f"/api/v1/groups/{group_id}/expenses", headers=alice_headers, json={
            "description": "Dinner", "expense_date": "2026-10-25", "currency": "INR", "total_amount": "100.00",
            "paid_by_user_id": str(alice_id), "split_type": "equal",
            "splits": [{"user_id": str(alice_id), "amount": "0.00"}, {"user_id": str(bob_id), "amount": "0.00"}],
        })
        assert expense_response.status_code == 201, expense_response.text
        expense = expense_response.json()["data"]
        assert [part["amount"] for part in expense["splits"]] == ["50.00", "50.00"]

        balances = client.get(f"/api/v1/groups/{group_id}/balances", headers=alice_headers)
        assert balances.status_code == 200
        assert {row["username"]: row["net_amount"] for row in balances.json()["data"]} == {"alice": "50.00", "bob": "-50.00", "carol": "0.00"}
        personal_balances = client.get("/api/v1/balances", headers=alice_headers)
        assert personal_balances.json()["data"][0]["net_amount"] == "50.00"

        settlement_response = client.post(f"/api/v1/groups/{group_id}/settlements", headers=bob_headers, json={
            "recipient_user_id": str(alice_id), "amount": "50.00",
        })
        assert settlement_response.status_code == 201, settlement_response.text
        settlement_id = settlement_response.json()["data"]["id"]
        assert client.get("/api/v1/settlements", headers=bob_headers).status_code == 200
        assert client.get(f"/api/v1/settlements/{settlement_id}", headers=alice_headers).status_code == 200
        # A pending settlement leaves balances unchanged until the recipient confirms it.
        assert client.get(f"/api/v1/groups/{group_id}/balances", headers=bob_headers).json()["data"] == balances.json()["data"]
        confirmed = client.post(f"/api/v1/settlements/{settlement_id}/confirm", headers=alice_headers)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["data"]["status"] == "confirmed"
        assert all(row["net_amount"] == "0.00" for row in client.get(f"/api/v1/groups/{group_id}/balances", headers=alice_headers).json()["data"])

        bob_notifications = client.get("/api/v1/notifications", headers=bob_headers)
        assert bob_notifications.status_code == 200
        assert bob_notifications.json()["pagination"]["total"] >= 1
        assert client.get("/api/v1/activity", headers=alice_headers).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}", headers=bob_headers).status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
