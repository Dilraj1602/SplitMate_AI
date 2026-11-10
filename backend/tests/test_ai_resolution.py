from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.models import Group, Membership, User
from backend.app.services.ai import _resolve_group, _resolve_member


def test_ai_resolution_requires_choices_for_ambiguous_groups_and_members():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            alice = User(username="alice", display_name="Alice", email="alice@resolve.test", is_active=True, is_email_verified=True)
            owner = User(username="owner", display_name="Owner", email="owner@resolve.test", is_active=True, is_email_verified=True)
            rahul_one = User(username="rahul1", display_name="Rahul", email="rahul1@resolve.test", is_active=True, is_email_verified=True)
            rahul_two = User(username="rahul2", display_name="Rahul", email="rahul2@resolve.test", is_active=True, is_email_verified=True)
            db.add_all([alice, owner, rahul_one, rahul_two]); db.flush()
            first = Group(name="Trip", normalized_name="trip", currency="INR", status="active", created_by_user_id=alice.id)
            second = Group(name="Trip", normalized_name="trip", currency="INR", status="active", created_by_user_id=owner.id)
            db.add_all([first, second]); db.flush()
            db.add_all([
                Membership(group_id=first.id, user_id=alice.id, status="active"),
                Membership(group_id=first.id, user_id=rahul_one.id, status="active"),
                Membership(group_id=first.id, user_id=rahul_two.id, status="active"),
                Membership(group_id=second.id, user_id=alice.id, status="active"),
            ])
            db.commit()
            group, choices = _resolve_group(db, alice.id, "Trip")
            assert group is None and len(choices) == 2
            member, unresolved, ambiguous = _resolve_member([alice, rahul_one, rahul_two], "Rahul", alice.id)
            assert member is None and not unresolved and len(ambiguous) == 1
            assert {person["name"] for person in ambiguous[0]["members"]} == {"Rahul"}
    finally:
        engine.dispose()
