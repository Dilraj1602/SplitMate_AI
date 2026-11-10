from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.dependencies import get_db
from backend.app.main import app
from backend.app.models import AIPendingAction, Expense, Group, Membership, User
from backend.app.services.auth import make_access_token


def test_ai_pending_expense_requires_auth_and_confirmation_is_idempotent(monkeypatch):
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
            alice = User(username="alice", display_name="Alice", email="alice@example.com", is_active=True, is_email_verified=True)
            bob = User(username="bob", display_name="Bob", email="bob@example.com", is_active=True, is_email_verified=True)
            session.add_all([alice, bob]); session.flush()
            group = Group(name="Trip", normalized_name="trip", currency="INR", status="active", created_by_user_id=alice.id)
            session.add(group); session.flush()
            session.add_all([Membership(group_id=group.id, user_id=alice.id, status="active"), Membership(group_id=group.id, user_id=bob.id, status="active")])
            action = AIPendingAction(user_id=alice.id, action_type="CREATE_EXPENSE", idempotency_key=str(uuid4()),
                payload=f'{{"group_id":"{group.id}","expense":{{"description":"Dinner","expense_date":"{date.today().isoformat()}","currency":"INR","total_amount":"120.00","paid_by_user_id":"{alice.id}","split_type":"equal","splits":[{{"user_id":"{alice.id}","amount":"0"}},{{"user_id":"{bob.id}","amount":"0"}}]}}}}',
                preview="{}", status="pending", expires_at=datetime.now(UTC)+timedelta(minutes=10))
            session.add(action); session.commit()
            action_id, alice_id, group_id = action.id, alice.id, group.id
            alice_headers = {"Authorization": f"Bearer {make_access_token(alice)}"}
            bob_headers = {"Authorization": f"Bearer {make_access_token(bob)}"}

        client = TestClient(app)
        assert client.post(f"/api/v1/ai/actions/{action_id}/confirm").status_code == 401
        assert client.post(f"/api/v1/ai/actions/{action_id}/confirm", headers=bob_headers).status_code == 404
        first = client.post(f"/api/v1/ai/actions/{action_id}/confirm", headers=alice_headers)
        assert first.status_code == 200, first.text
        assert first.json()["data"]["result"]["total_amount"] == "120.00"
        assert first.json()["data"]["result"]["splits"]
        second = client.post(f"/api/v1/ai/actions/{action_id}/confirm", headers=alice_headers)
        assert second.status_code == 200 and second.json()["data"]["duplicate"] is True
        with Session(engine) as session:
            assert len(session.scalars(select(Expense)).all()) == 1
            assert session.get(AIPendingAction, action_id).user_id == alice_id
            cancelled = AIPendingAction(user_id=alice_id, action_type="CREATE_EXPENSE", idempotency_key=str(uuid4()),
                payload=f'{{"group_id":"{group_id}","expense":{{"description":"Cancelled","expense_date":"{date.today().isoformat()}","currency":"INR","total_amount":"20.00","paid_by_user_id":"{alice_id}","split_type":"equal","splits":[{{"user_id":"{alice_id}","amount":"0"}}]}}}}',
                preview="{}", status="pending", expires_at=datetime.now(UTC)+timedelta(minutes=10))
            session.add(cancelled); session.commit(); cancelled_id = cancelled.id
        assert client.post(f"/api/v1/ai/actions/{cancelled_id}/cancel", headers=alice_headers).json()["data"]["status"] == "cancelled"
        assert client.post(f"/api/v1/ai/actions/{cancelled_id}/confirm", headers=alice_headers).status_code == 409
        with Session(engine) as session:
            assert len(session.scalars(select(Expense)).all()) == 1
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
