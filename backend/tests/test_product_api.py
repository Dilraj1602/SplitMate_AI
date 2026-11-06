from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from threading import Barrier
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.dependencies import get_db
from backend.app.main import app
from backend.app.models import Expense, Group, InviteLink, JoinCode, Membership, User
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
        assert group_response.json()["data"]["join_approval_required"] is False
        assert client.patch(f"/api/v1/groups/{group_id}", headers=alice_headers, json={"join_approval_required": True}).status_code == 200

        with Session(engine) as session:
            session.add(Membership(group_id=UUID(group_id), user_id=bob_id, role="member", status="active"))
            session.commit()

        link_response = client.get(f"/api/v1/groups/{group_id}/invite-links", headers=alice_headers)
        assert link_response.status_code == 200, link_response.text
        invite_url = link_response.json()["data"]["url"]
        token = invite_url.rsplit("/", 1)[-1]
        assert group_response.json()["data"]["invite_url"] == invite_url
        assert client.get(f"/api/v1/groups/{group_id}/invite-links", headers=alice_headers).json()["data"]["url"] == invite_url
        assert client.get(f"/api/v1/groups/{group_id}/invite-links", headers=bob_headers).json()["data"]["url"] == invite_url
        assert client.post(f"/api/v1/groups/{group_id}/invite-links", headers=alice_headers).status_code == 405
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
        analytics = client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution", headers=alice_headers)
        assert analytics.status_code == 200
        assert analytics.json()["data"]["total_expenses"] == "100.00"
        assert analytics.json()["data"]["member_count"] == 3
        assert {row["username"]: row["total_spent"] for row in analytics.json()["data"]["members"]} == {
            "alice": "100.00", "bob": "0.00", "carol": "0.00",
        }
        assert sum(row["percentage"] for row in analytics.json()["data"]["members"]) == 100
        assert client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution?start_date=2026-10-26&end_date=2026-10-26", headers=alice_headers).json()["data"]["total_expenses"] == "0.00"
        assert client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution?start_date=2026-10-26&end_date=2026-10-25", headers=alice_headers).status_code == 422
        assert client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution", headers=carol_headers).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution").status_code == 401
        second_expense = client.post(f"/api/v1/groups/{group_id}/expenses", headers=bob_headers, json={
            "description": "Taxi", "expense_date": "2026-10-25", "currency": "INR", "total_amount": "50.00",
            "paid_by_user_id": str(bob_id), "split_type": "equal",
            "splits": [{"user_id": str(alice_id), "amount": "25.00"}, {"user_id": str(bob_id), "amount": "25.00"}],
        })
        assert second_expense.status_code == 201
        distribution = client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution", headers=alice_headers).json()["data"]
        assert distribution["total_expenses"] == "150.00"
        assert {row["username"]: row["percentage"] for row in distribution["members"]} == {
            "alice": 100 / 1.5, "bob": 100 / 3, "carol": 0,
        }
        assert client.post(f"/api/v1/expenses/{second_expense.json()['data']['id']}/void", headers=bob_headers).status_code == 200
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
        assert client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution", headers=alice_headers).json()["data"]["total_expenses"] == "100.00"
        assert client.get("/api/v1/dashboard", headers=alice_headers).json()["summary"]["expense_count"] == 1
        voided = client.post(f"/api/v1/expenses/{expense['id']}/void", headers=alice_headers)
        assert voided.status_code == 200
        assert client.get("/api/v1/dashboard", headers=alice_headers).json()["summary"]["expense_count"] == 0
        zero_distribution = client.get(f"/api/v1/groups/{group_id}/analytics/expense-distribution", headers=alice_headers).json()["data"]
        assert zero_distribution["total_expenses"] == "0.00"
        assert all(row["percentage"] == 0 for row in zero_distribution["members"])

        bob_notifications = client.get("/api/v1/notifications", headers=bob_headers)
        assert bob_notifications.status_code == 200
        assert bob_notifications.json()["pagination"]["total"] >= 1
        assert client.get("/api/v1/activity", headers=alice_headers).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}", headers=bob_headers).status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_multi_user_invite_link_join_codes_approvals_and_member_controls(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    secret = "test-secret-key-that-is-at-least-32-bytes-long"
    monkeypatch.setattr("backend.app.dependencies.settings.secret_key", secret)
    monkeypatch.setattr("backend.app.services.auth.settings.secret_key", secret)
    monkeypatch.setattr("backend.app.api.v1.endpoints.product.settings.secret_key", secret)

    def override_db() -> Generator[Session, None, None]:
        with Session(engine, autoflush=False) as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    try:
        names = ("owner", "bob", "carol", "dave", "erin", "frank", "grace", "heidi")
        with Session(engine) as session:
            people = [User(username=name, display_name=name.title(), email=f"{name}@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True) for name in names]
            session.add_all(people)
            session.commit()
            tokens = {person.username: make_access_token(person) for person in people}

        client = TestClient(app)
        headers = {name: {"Authorization": f"Bearer {token}"} for name, token in tokens.items()}
        created_group = client.post("/api/v1/groups", headers=headers["owner"], json={"name": "Open group"})
        assert created_group.status_code == 201
        group_id = created_group.json()["data"]["id"]
        assert created_group.json()["data"]["join_approval_required"] is False

        initial_invite_url = created_group.json()["data"]["invite_url"]
        link = client.get(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"])
        assert link.status_code == 200
        token = link.json()["data"]["url"].rsplit("/", 1)[-1]
        assert link.json()["data"]["url"] == initial_invite_url
        assert client.get(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"]).json()["data"]["url"] == initial_invite_url
        for option in ("1_hour", "5_hours", "24_hours", "7_days", "never"):
            updated = client.patch(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"], json={"expiration_option": option})
            assert updated.status_code == 200
            persistent = client.get(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"]).json()["data"]
            assert persistent["expiration_option"] == option
            assert persistent["url"] == initial_invite_url
        assert client.patch(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"], json={"expiration_option": "1_hour"}).status_code == 200
        with Session(engine) as session:
            persistent_link = session.query(InviteLink).filter_by(group_id=UUID(group_id)).one()
            persistent_link.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            session.commit()
        assert client.get(f"/api/v1/invite-links/{token}/preview").status_code == 404
        assert client.patch(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"], json={"expiration_option": "never"}).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"]).json()["data"]["url"] == initial_invite_url
        assert client.get(f"/api/v1/invite-links/{token}/preview").status_code == 200
        assert client.get(f"/api/v1/invite-links/{token}/preview").json()["data"]["approval_required"] is False
        assert client.post(f"/api/v1/invite-links/{token}/join-requests", headers=headers["bob"]).json()["status"] == "joined"
        assert client.get(f"/api/v1/groups/{group_id}/invite-links", headers=headers["bob"]).json()["data"]["url"] == initial_invite_url
        assert client.patch(f"/api/v1/groups/{group_id}/invite-links", headers=headers["bob"], json={"expiration_option": "7_days"}).status_code == 403
        assert client.delete(f"/api/v1/groups/{group_id}/invite-links", headers=headers["bob"]).status_code == 403
        assert client.post(f"/api/v1/invite-links/{token}/join-requests", headers=headers["carol"]).json()["status"] == "joined"
        assert client.post(f"/api/v1/invite-links/{token}/join-requests", headers=headers["bob"]).json()["status"] == "already_member"
        assert client.patch(f"/api/v1/groups/{group_id}", headers=headers["owner"], json={"join_approval_required": True}).status_code == 200

        created_code = client.post(f"/api/v1/groups/{group_id}/join-codes", headers=headers["owner"])
        assert created_code.status_code == 201
        code = created_code.json()["data"]["code"]
        assert len(code) == 6 and code.isdigit()
        with Session(engine) as session:
            stored_code = session.query(JoinCode).one()
            assert stored_code.code_hash != code
            assert stored_code.encrypted_code != code
        code_state = client.get(f"/api/v1/groups/{group_id}/join-codes", headers=headers["owner"])
        assert code_state.json()["data"]["active"] is True
        assert code_state.json()["data"]["code"] == code
        code_expiry = datetime.fromisoformat(code_state.json()["data"]["expires_at"])
        if code_expiry.tzinfo is None:
            code_expiry = code_expiry.replace(tzinfo=UTC)
        remaining = code_expiry - datetime.now(UTC)
        assert timedelta(minutes=4) <= remaining <= timedelta(minutes=5)
        assert client.post(f"/api/v1/join-codes/join", headers=headers["dave"], json={"code": code.lower()}).json()["status"] == "joined"
        assert client.post(f"/api/v1/join-codes/join", headers=headers["heidi"], json={"code": code}).json()["status"] == "joined"
        assert client.post(f"/api/v1/join-codes/join", headers=headers["bob"], json={"code": code}).json()["status"] == "already_member"
        assert client.post("/api/v1/join-codes/join", headers=headers["frank"], json={"code": "999999"}).status_code == 404
        assert client.post(f"/api/v1/groups/{group_id}/join-codes", headers=headers["bob"]).status_code == 403
        assert client.get(f"/api/v1/groups/{group_id}/join-codes", headers=headers["bob"]).status_code == 403
        assert client.delete(f"/api/v1/groups/{group_id}/join-codes", headers=headers["bob"]).status_code == 403
        with Session(engine) as session:
            stored_code = session.query(JoinCode).one()
            stored_code.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            session.commit()
        assert client.post("/api/v1/join-codes/join", headers=headers["frank"], json={"code": code}).status_code == 404
        assert client.get(f"/api/v1/groups/{group_id}/join-codes", headers=headers["owner"]).json()["data"]["active"] is False
        code = client.post(f"/api/v1/groups/{group_id}/join-codes", headers=headers["owner"]).json()["data"]["code"]
        assert client.delete(f"/api/v1/groups/{group_id}/join-codes", headers=headers["owner"]).status_code == 200
        assert client.post("/api/v1/join-codes/join", headers=headers["frank"], json={"code": code}).status_code == 404

        assert client.patch(f"/api/v1/groups/{group_id}", headers=headers["owner"], json={"join_approval_required": True}).status_code == 200
        approval_link = client.get(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"])
        approval_token = approval_link.json()["data"]["url"].rsplit("/", 1)[-1]
        assert approval_link.json()["data"]["url"] == initial_invite_url
        assert client.get(f"/api/v1/invite-links/{approval_token}/preview").json()["data"]["approval_required"] is True
        for person in ("erin", "frank", "grace"):
            joined = client.post(f"/api/v1/invite-links/{approval_token}/join-requests", headers=headers[person])
            assert joined.status_code == 202 and joined.json()["status"] == "pending"
        assert client.patch(f"/api/v1/groups/{group_id}", headers=headers["owner"], json={"join_approval_required": False}).status_code == 200
        requests = client.get(f"/api/v1/groups/{group_id}/join-requests", headers=headers["owner"]).json()["data"]
        request_ids = {row["username"]: row["id"] for row in requests}
        assert client.post(f"/api/v1/groups/{group_id}/join-requests/{request_ids['erin']}/approve", headers=headers["owner"]).status_code == 200
        assert client.post(f"/api/v1/groups/{group_id}/join-requests/{request_ids['frank']}/reject", headers=headers["owner"]).status_code == 200
        assert client.post(f"/api/v1/groups/{group_id}/join-requests/approve-all", headers=headers["owner"]).json()["data"]["approved"] == 1
        assert client.get(f"/api/v1/groups/{group_id}/members", headers=headers["erin"]).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}/members", headers=headers["frank"]).status_code == 404

        assert client.delete(f"/api/v1/groups/{group_id}/invite-links", headers=headers["owner"]).status_code == 200
        assert client.get(f"/api/v1/invite-links/{approval_token}/preview").status_code == 404
        assert client.post(f"/api/v1/invite-links/{approval_token}/join-requests", headers=headers["frank"]).status_code == 404
        assert client.delete(f"/api/v1/groups/{group_id}/members/{people[2].id}", headers=headers["owner"]).status_code == 200
        assert client.get(f"/api/v1/groups/{group_id}/members", headers=headers["carol"]).status_code == 404
        assert client.delete(f"/api/v1/groups/{group_id}/members/{people[0].id}", headers=headers["owner"]).status_code == 409
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_simultaneous_group_join_requests_are_recorded_once_per_user(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'concurrent-joins.sqlite'}", connect_args={"check_same_thread": False, "timeout": 30})
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
            people = [User(username=name, display_name=name.title(), email=f"{name}@example.com", hashed_password=hash_password("password123"), is_active=True, is_email_verified=True) for name in ("owner", "bob", "carol")]
            session.add_all(people)
            session.commit()
            tokens = [make_access_token(person) for person in people]
        client = TestClient(app)
        owner_headers = {"Authorization": f"Bearer {tokens[0]}"}
        group = client.post("/api/v1/groups", headers=owner_headers, json={"name": "Concurrent join"}).json()["data"]
        group_id = group["id"]
        assert client.patch(f"/api/v1/groups/{group_id}", headers=owner_headers, json={"join_approval_required": True}).status_code == 200
        invite = client.get(f"/api/v1/groups/{group_id}/invite-links", headers=owner_headers).json()["data"]["url"]
        token = invite.rsplit("/", 1)[-1]
        barrier = Barrier(2)

        def request_join(access_token: str) -> int:
            barrier.wait(timeout=5)
            response = TestClient(app).post(f"/api/v1/invite-links/{token}/join-requests", headers={"Authorization": f"Bearer {access_token}"})
            return response.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(request_join, tokens[1:]))
        assert statuses == [202, 202]
        requests = client.get(f"/api/v1/groups/{group_id}/join-requests", headers=owner_headers)
        assert len(requests.json()["data"]) == 2
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
