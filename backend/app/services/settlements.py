"""Shared settlement proposal workflow used by API and AI confirmation."""
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from datetime import UTC, datetime
from backend.app.models import Group, Settlement, User


def create_settlement_proposal(
    db: Session, *, group_id: UUID, created_by_user_id: UUID, recipient_user_id: UUID,
    amount: Decimal, currency: str, idempotency_key: str,
) -> Settlement:
    """Propose an authenticated payer-to-recipient settlement, reserving available debt."""
    from backend.app.api.v1.endpoints.product import (
        _activity, _group, _membership, _notify, _pairwise_outstanding, _validate_members,
    )

    group = db.scalar(select(Group).where(Group.id == group_id).with_for_update())
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    if group.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This group is archived and cannot accept new changes.")
    _membership(db, group_id, created_by_user_id)
    _validate_members(db, group_id, [created_by_user_id, recipient_user_id])
    if recipient_user_id == created_by_user_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payer and recipient must be different users.")
    existing = db.scalar(select(Settlement).where(Settlement.group_id == group_id,
        Settlement.created_by_user_id == created_by_user_id, Settlement.idempotency_key == idempotency_key))
    if existing:
        return existing
    outstanding, pending = _pairwise_outstanding(db, group_id, created_by_user_id, recipient_user_id)
    available = max(Decimal("0.00"), outstanding - pending)
    if available <= Decimal("0.00"):
        raise HTTPException(status.HTTP_409_CONFLICT, "You have no outstanding amount to settle with this member.")
    if currency != group.currency:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Settlement currency must match the group currency.")
    if amount > available:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Amount exceeds the available outstanding balance of {currency} {available:.2f}.")
    item = Settlement(group_id=group_id, payer_user_id=created_by_user_id, recipient_user_id=recipient_user_id,
        created_by_user_id=created_by_user_id, amount=amount, currency=currency, idempotency_key=idempotency_key)
    db.add(item); db.flush()
    actor = db.get(User, created_by_user_id)
    _notify(db, recipient_user_id, "settlement", "Settlement proposed", f"{actor.display_name or actor.username} proposed {currency} {amount:.2f} for {group.name}.", group_id=group_id, entity_type="settlement", entity_id=item.id)
    _activity(db, group_id, created_by_user_id, "settlement_proposed", f"{actor.display_name or actor.username} proposed a settlement of {currency} {amount:.2f}.", "settlement", item.id)
    return item


def record_received_settlement(
    db: Session, *, group_id: UUID, actor_user_id: UUID, payer_user_id: UUID,
    amount: Decimal, currency: str, idempotency_key: str,
) -> Settlement:
    """Record a payment the authenticated recipient explicitly confirms receiving."""
    from backend.app.api.v1.endpoints.product import (
        _activity, _membership, _notify, _pairwise_outstanding, _validate_members,
    )

    group = db.scalar(select(Group).where(Group.id == group_id).with_for_update())
    if not group or group.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    _membership(db, group_id, actor_user_id)
    _validate_members(db, group_id, [payer_user_id, actor_user_id])
    if payer_user_id == actor_user_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payer and recipient must be different users.")
    existing = db.scalar(select(Settlement).where(Settlement.group_id == group_id,
        Settlement.created_by_user_id == actor_user_id, Settlement.idempotency_key == idempotency_key))
    if existing:
        return existing
    outstanding, pending = _pairwise_outstanding(db, group_id, payer_user_id, actor_user_id)
    available = max(Decimal("0.00"), outstanding - pending)
    if available <= Decimal("0.00"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This member has no outstanding amount to pay you.")
    if currency != group.currency:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Settlement currency must match the group currency.")
    if amount > available:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Amount exceeds the available outstanding balance of {currency} {available:.2f}.")
    item = Settlement(group_id=group_id, payer_user_id=payer_user_id, recipient_user_id=actor_user_id,
        created_by_user_id=actor_user_id, amount=amount, currency=currency, idempotency_key=idempotency_key,
        status="confirmed", responded_at=datetime.now(UTC))
    db.add(item); db.flush()
    actor = db.get(User, actor_user_id)
    _notify(db, payer_user_id, "settlement_response", "Payment recorded", f"{actor.display_name or actor.username} recorded receiving {currency} {amount:.2f} in {group.name}.", group_id=group_id, entity_type="settlement", entity_id=item.id)
    _activity(db, group_id, actor_user_id, "settlement_confirmed", f"{actor.display_name or actor.username} recorded receiving a settlement of {currency} {amount:.2f}.", "settlement", item.id)
    return item
