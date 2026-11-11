from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.db.session import Base
from backend.app.models import Group, Membership, User
from pydantic import ValidationError
from decimal import Decimal

from backend.app.services.ai import AGENT_PERSONAS, INTENT_AGENT, AgentResult, AgentTask, ExpenseArguments, IntentClassification, _resolve_group, _resolve_member, build_graph


def test_supervisor_routes_to_specialists_with_validated_handoff_contract():
    assert INTENT_AGENT["CREATE_EXPENSE"] == "expense"
    assert INTENT_AGENT["CREATE_SETTLEMENT"] == "settlement"
    assert INTENT_AGENT["GET_GROUP_BALANCE"] == "balance"
    assert INTENT_AGENT["GET_EXPENSE_HISTORY"] == "insights"
    assert INTENT_AGENT["GENERAL_QUESTION"] == "knowledge"
    assert all(persona["instructions"] and persona["tools"] for persona in AGENT_PERSONAS.values())

    task = AgentTask(agent="expense", intent="CREATE_EXPENSE", user_text="Add dinner")
    assert task.agent == "expense"
    result = AgentResult(agent="expense", intent=task.intent, succeeded=True,
                         result={"message": "Which group?", "missing_fields": ["group_name"]},
                         clarification_required=True, task_complete=False)
    assert AgentResult.model_validate(result.model_dump()).clarification_required
    try:
        AgentResult.model_validate({"agent": "expense", "intent": "CREATE_EXPENSE", "succeeded": True, "result": {}, "unexpected": True})
    except ValidationError:
        pass
    else:
        raise AssertionError("Malformed specialist output must fail validation")


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


def test_everyone_expense_uses_authenticated_group_members_without_llm_names(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            users = [User(username=name.lower(), display_name=name, email=f"{name.lower()}@all.test", is_active=True, is_email_verified=True)
                     for name in ["Ravindra", "Member 2", "Member 3", "Member 4"]]
            db.add_all(users); db.flush()
            group = Group(name="Dil_Ravindra", normalized_name="dil_ravindra", currency="INR", status="active", created_by_user_id=users[0].id)
            db.add(group); db.flush()
            db.add_all([Membership(group_id=group.id, user_id=user.id, status="active") for user in users]); db.commit()

            class FakeStructuredModel:
                schema = None
                def with_structured_output(self, schema): self.schema = schema; return self
                def with_retry(self, **_kwargs): return self
                def invoke(self, _messages):
                    if self.schema is IntentClassification:
                        return IntentClassification(intent="CREATE_EXPENSE")
                    # Simulate Qwen failing to resolve the natural-language "all members" phrase.
                    return ExpenseArguments(group_name="dil_ravindra", amount=Decimal("1200"), payer_is_user=True,
                                            participant_mode=None, participants=None, split_type="equal")

            monkeypatch.setattr("backend.app.services.ai._model", FakeStructuredModel)
            text = "Add 1200 in dil_ravindra group which is paid by me. Split equally among all the members of the group."
            result = build_graph(db).invoke({"user_text": text, "authenticated_user_id": str(users[0].id)})["response"]
            assert result["confirmation_required"] is True
            preview = result["action_preview"]
            assert preview["group"] == "Dil_Ravindra"
            assert preview["payer"] == "Ravindra"
            assert preview["description"] == "Group expense"
            assert len(preview["participants"]) == 4
            assert {item["amount"] for item in preview["participants"]} == {"300.00"}
    finally:
        engine.dispose()
