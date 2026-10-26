from collections.abc import Generator
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.dependencies import get_db
from backend.app.main import app
from backend.app.models import Expense, Group, Membership, User
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
        assert client.get("/api/v1/dashboard", headers=alice_headers).json()["summary"]["expense_count"] == 1
        all_expenses = client.get("/api/v1/expenses", headers=alice_headers)
        assert all_expenses.status_code == 200
        assert all_expenses.json()["data"][0]["group_name"] == "Weekend"

        balances = client.get(f"/api/v1/groups/{group_id}/balances", headers=alice_headers)
        assert balances.status_code == 200
        assert {row["username"]: row["net_amount"] for row in balances.json()["data"]} == {"alice": "50.00", "bob": "-50.00", "carol": "0.00"}
        personal_balances = client.get("/api/v1/balances", headers=alice_headers)
        assert personal_balances.json()["data"][0]["net_amount"] == "50.00"

        bob_options = client.get(f"/api/v1/groups/{group_id}/settlement-options", headers=bob_headers)
        assert bob_options.status_code == 200
        assert bob_options.json()["data"] == [{
            "user_id": str(alice_id), "username": "alice", "display_name": "Alice", "currency": "INR",
            "outstanding_amount": "50.00", "pending_amount": "0.00", "available_amount": "50.00",
        }]
        assert client.get(f"/api/v1/groups/{group_id}/settlement-options", headers=alice_headers).json()["data"] == []
        excessive = client.post(f"/api/v1/groups/{group_id}/settlements", headers=bob_headers, json={
            "recipient_user_id": str(alice_id), "amount": "50.01",
        })
        assert excessive.status_code == 422

        settlement_response = client.post(f"/api/v1/groups/{group_id}/settlements", headers=bob_headers, json={
            "recipient_user_id": str(alice_id), "amount": "20.00",
        })
        assert settlement_response.status_code == 201, settlement_response.text
        settlement_id = settlement_response.json()["data"]["id"]
        after_partial_proposal = client.get(f"/api/v1/groups/{group_id}/settlement-options", headers=bob_headers).json()["data"]
        assert after_partial_proposal[0]["outstanding_amount"] == "50.00"
        assert after_partial_proposal[0]["pending_amount"] == "20.00"
        assert after_partial_proposal[0]["available_amount"] == "30.00"
        second_proposal = client.post(f"/api/v1/groups/{group_id}/settlements", headers=bob_headers, json={
            "recipient_user_id": str(alice_id), "amount": "30.00",
        })
        assert second_proposal.status_code == 201, second_proposal.text
        assert client.get("/api/v1/settlements", headers=bob_headers).status_code == 200
        assert client.get(f"/api/v1/settlements/{settlement_id}", headers=alice_headers).status_code == 200
        # A pending settlement leaves balances unchanged until the recipient confirms it.
        assert client.get(f"/api/v1/groups/{group_id}/balances", headers=bob_headers).json()["data"] == balances.json()["data"]
        confirmed = client.post(f"/api/v1/settlements/{settlement_id}/confirm", headers=alice_headers)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["data"]["status"] == "confirmed"
        after_first_confirmation = client.get(f"/api/v1/groups/{group_id}/balances", headers=alice_headers).json()["data"]
        assert {row["username"]: row["net_amount"] for row in after_first_confirmation} == {"alice": "30.00", "bob": "-30.00", "carol": "0.00"}
        second_confirmed = client.post(f"/api/v1/settlements/{second_proposal.json()['data']['id']}/confirm", headers=alice_headers)
        assert second_confirmed.status_code == 200
        assert all(row["net_amount"] == "0.00" for row in client.get(f"/api/v1/groups/{group_id}/balances", headers=alice_headers).json()["data"])
        assert client.get("/api/v1/dashboard", headers=alice_headers).json()["summary"]["expense_count"] == 1
        voided = client.post(f"/api/v1/expenses/{expense['id']}/void", headers=alice_headers)
        assert voided.status_code == 200
        assert client.get("/api/v1/dashboard", headers=alice_headers).json()["summary"]["expense_count"] == 0

        bob_notifications = client.get("/api/v1/notifications", headers=bob_headers)
        assert bob_notifications.status_code == 200
        assert bob_notifications.json()["pagination"]["total"] >= 1
        assert client.get("/api/v1/activity", headers=alice_headers).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}", headers=bob_headers).status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_dashboard_counts_only_active_expenses_in_active_accessible_groups(monkeypatch):
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
            session.add(alice)
            session.flush()
            groups = [
                Group(name="First", currency="INR", status="active", created_by_user_id=alice.id),
                Group(name="Second", currency="USD", status="active", created_by_user_id=alice.id),
                Group(name="Archived", currency="INR", status="archived", created_by_user_id=alice.id),
                Group(name="Former access", currency="INR", status="active", created_by_user_id=alice.id),
            ]
            session.add_all(groups)
            session.flush()
            for group, membership_status in zip(groups, ("active", "active", "active", "left")):
                session.add(Membership(group_id=group.id, user_id=alice.id, role="admin", status=membership_status))
            session.add_all([
                Expense(group_id=groups[0].id, paid_by_user_id=alice.id, created_by_user_id=alice.id, description="Dinner", expense_date=date(2026, 10, 20), currency="INR", total_amount=Decimal("100.00"), split_type="equal", status="active"),
                Expense(group_id=groups[1].id, paid_by_user_id=alice.id, created_by_user_id=alice.id, description="Taxi", expense_date=date(2026, 10, 21), currency="USD", total_amount=Decimal("25.00"), split_type="equal", status="active"),
                Expense(group_id=groups[2].id, paid_by_user_id=alice.id, created_by_user_id=alice.id, description="Old trip", expense_date=date(2026, 10, 22), currency="INR", total_amount=Decimal("40.00"), split_type="equal", status="active"),
                Expense(group_id=groups[0].id, paid_by_user_id=alice.id, created_by_user_id=alice.id, description="Voided", expense_date=date(2026, 10, 23), currency="INR", total_amount=Decimal("10.00"), split_type="equal", status="voided"),
                Expense(group_id=groups[3].id, paid_by_user_id=alice.id, created_by_user_id=alice.id, description="No longer accessible", expense_date=date(2026, 10, 24), currency="INR", total_amount=Decimal("15.00"), split_type="equal", status="active"),
            ])
            session.commit()
            token = make_access_token(alice)

        response = TestClient(app).get("/api/v1/dashboard", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["summary"]["expense_count"] == 2
        assert {expense["description"] for expense in data["data"]} == {"Dinner", "Taxi"}
        all_expenses = TestClient(app).get("/api/v1/expenses", headers={"Authorization": f"Bearer {token}"})
        assert all_expenses.status_code == 200
        assert {expense["group_name"] for expense in all_expenses.json()["data"]} == {"First", "Second"}
        assert all_expenses.json()["pagination"]["total"] == 2
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_group_name_and_invitation_lifecycle(monkeypatch):
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
            users = [User(username=name, display_name=name.title(), email=f"{name}@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True) for name in ("alice", "bob", "carol")]
            session.add_all(users)
            session.commit()
            alice, bob, carol = users
            alice_token, bob_token, carol_token = (make_access_token(person) for person in users)

        client = TestClient(app)
        ah = {"Authorization": f"Bearer {alice_token}"}
        bh = {"Authorization": f"Bearer {bob_token}"}
        ch = {"Authorization": f"Bearer {carol_token}"}
        assert client.get("/api/v1/auth/me", headers=ah).status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 401

        group = client.post("/api/v1/groups", headers=ah, json={"name": "  Weekend  "})
        assert group.status_code == 201
        group_id = group.json()["data"]["id"]
        duplicate = client.post("/api/v1/groups", headers=ah, json={"name": "weekEND"})
        assert duplicate.status_code == 409
        # The duplicate scope is the owner; another user can use the same name.
        assert client.post("/api/v1/groups", headers=bh, json={"name": "Weekend"}).status_code == 201

        created = client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"email": "bob@example.com"})
        assert created.status_code == 201
        invitation_id = created.json()["data"]["id"]
        assert created.json()["data"]["status"] == "pending"
        assert client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"email": "bob@example.com"}).status_code == 409
        assert client.get("/api/v1/invitations", headers=bh).json()["data"][0]["id"] == invitation_id
        assert client.post(f"/api/v1/invitations/{invitation_id}/accept", headers=ch).status_code == 404
        accepted = client.post(f"/api/v1/invitations/{invitation_id}/accept", headers=bh)
        assert accepted.status_code == 200 and accepted.json()["data"]["status"] == "accepted"
        assert client.post(f"/api/v1/invitations/{invitation_id}/accept", headers=bh).status_code == 409
        assert client.get(f"/api/v1/groups/{group_id}/members", headers=bh).status_code == 200
        with Session(engine) as session:
            assert session.query(Membership).filter_by(group_id=UUID(group_id), user_id=users[1].id).count() == 1

        username_invite = client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"username": "CAROL"})
        assert username_invite.status_code == 201, username_invite.text
        username_invite_id = username_invite.json()["data"]["id"]
        assert client.get("/api/v1/invitations", headers=ch).json()["data"][0]["id"] == username_invite_id
        # Inviting the same account by email or username must hit the same duplicate guard.
        assert client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"email": "carol@example.com"}).status_code == 409
        username_declined = client.post(f"/api/v1/invitations/{username_invite_id}/decline", headers=ch)
        assert username_declined.status_code == 200 and username_declined.json()["data"]["status"] == "declined"
        assert client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"username": "unknown_user"}).status_code == 404

        declined = client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"email": "carol@example.com"})
        assert declined.status_code == 201
        decline_response = client.post(f"/api/v1/invitations/{declined.json()['data']['id']}/decline", headers=ch)
        assert decline_response.status_code == 200 and decline_response.json()["data"]["status"] == "declined"
        assert client.get(f"/api/v1/groups/{group_id}/members", headers=ch).status_code == 404
        assert client.post(f"/api/v1/groups/{group_id}/invitations", headers=ah, json={"email": "carol@example.com"}).status_code == 201
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
