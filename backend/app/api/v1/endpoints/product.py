import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, ROUND_DOWN
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.dependencies import get_current_user, get_db
from backend.app.models import (
    ActivityEvent,
    Expense,
    ExpenseSplit,
    Group,
    Invitation,
    InviteLink,
    JoinRequest,
    Membership,
    Notification,
    Settlement,
    User,
)
from backend.app.schemas.product import (
    ChangePassword,
    ExpenseCreate,
    ExpensePatch,
    GroupCreate,
    GroupPatch,
    InvitationCreate,
    ProfilePatch,
    SettlementCreate,
)
from backend.app.services.auth import hash_password, verify_password

router = APIRouter(tags=["Application"])
INR = "INR"
ZERO = Decimal("0.00")
CENT = Decimal("0.01")


def _money(value: Decimal) -> str:
    return format(value.quantize(CENT), ".2f")


def _collection(items: list[dict], total: int, limit: int, offset: int) -> dict:
    return {"data": items, "pagination": {"limit": limit, "offset": offset, "total": total}}


def _membership(db: Session, group_id: UUID, user_id: UUID) -> Membership:
    member = db.scalar(select(Membership).where(
        Membership.group_id == group_id,
        Membership.user_id == user_id,
        Membership.status == "active",
    ))
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    return member


def _require_admin(db: Session, group_id: UUID, user_id: UUID) -> Membership:
    member = _membership(db, group_id, user_id)
    if member.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Group administrator access is required.")
    return member


def _group(db: Session, group_id: UUID) -> Group:
    group = db.get(Group, group_id)
    if not group:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found.")
    return group


def _notify(
    db: Session,
    user_id: UUID,
    notification_type: str,
    title: str,
    body: str,
    *,
    group_id: UUID | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
) -> None:
    db.add(Notification(
        user_id=user_id,
        group_id=group_id,
        type=notification_type,
        title=title,
        body=body,
        related_entity_type=entity_type,
        related_entity_id=entity_id,
    ))


def _activity(
    db: Session,
    group_id: UUID,
    actor_id: UUID | None,
    event_type: str,
    description: str,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
) -> None:
    db.add(ActivityEvent(
        group_id=group_id,
        actor_user_id=actor_id,
        event_type=event_type,
        description=description,
        entity_type=entity_type,
        entity_id=entity_id,
    ))


def _active_member_ids(db: Session, group_id: UUID) -> list[UUID]:
    return list(db.scalars(select(Membership.user_id).where(
        Membership.group_id == group_id, Membership.status == "active",
    )).all())


def _serialize_group(db: Session, group: Group) -> dict:
    member_count = db.scalar(select(func.count()).select_from(Membership).where(
        Membership.group_id == group.id, Membership.status == "active",
    )) or 0
    return {
        "id": str(group.id), "name": group.name, "description": group.description,
        "currency": group.currency, "status": group.status, "member_count": member_count,
        "created_at": group.created_at.isoformat(),
    }


def _serialize_invitation(db: Session, item: Invitation) -> dict:
    group = db.get(Group, item.group_id)
    inviter = db.get(User, item.inviter_user_id)
    current_status = item.status
    if current_status == "pending" and _utc(item.expires_at) <= datetime.now(UTC):
        current_status = "expired"
        item.status = "expired"
    return {
        "id": str(item.id), "group_id": str(item.group_id),
        "group_name": group.name if group else "Group",
        "inviter_name": (inviter.display_name or inviter.username) if inviter else "A member",
        "status": current_status, "expires_at": item.expires_at.isoformat(),
        "created_at": item.created_at.isoformat(),
    }


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _serialize_expense(db: Session, expense: Expense) -> dict:
    payer = db.get(User, expense.paid_by_user_id)
    splits = db.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == expense.id).order_by(ExpenseSplit.user_id)).all()
    split_data = []
    for split in splits:
        user = db.get(User, split.user_id)
        split_data.append({
            "user_id": str(split.user_id), "username": user.username if user else None,
            "display_name": user.display_name if user else None, "amount": _money(split.amount),
        })
    return {
        "id": str(expense.id), "group_id": str(expense.group_id),
        "description": expense.description, "expense_date": expense.expense_date.isoformat(),
        "currency": expense.currency, "total_amount": _money(expense.total_amount),
        "paid_by_user_id": str(expense.paid_by_user_id),
        "payer_name": (payer.display_name or payer.username) if payer else None,
        "split_type": expense.split_type, "splits": split_data, "status": expense.status,
        "created_at": expense.created_at.isoformat(), "updated_at": expense.updated_at.isoformat(),
    }


def _serialize_settlement(db: Session, item: Settlement) -> dict:
    payer = db.get(User, item.payer_user_id)
    recipient = db.get(User, item.recipient_user_id)
    return {
        "id": str(item.id), "group_id": str(item.group_id),
        "payer_user_id": str(item.payer_user_id), "recipient_user_id": str(item.recipient_user_id),
        "payer_name": (payer.display_name or payer.username) if payer else "Payer",
        "recipient_name": (recipient.display_name or recipient.username) if recipient else "Recipient",
        "amount": _money(item.amount), "currency": item.currency, "status": item.status,
        "created_at": item.created_at.isoformat(),
    }


def _require_active_group(db: Session, group_id: UUID) -> Group:
    group = _group(db, group_id)
    if group.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This group is archived and cannot accept new changes.")
    return group


def _validate_members(db: Session, group_id: UUID, ids: list[UUID]) -> None:
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Each group member may appear only once.")
    active = set(_active_member_ids(db, group_id))
    if not ids or any(user_id not in active for user_id in ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Every payer and participant must be an active group member.")


def _split_amounts(payload: ExpenseCreate) -> list[tuple[UUID, Decimal]]:
    total_paise = int(payload.total_amount * 100)
    ordered = sorted(payload.splits, key=lambda item: str(item.user_id))
    ids = [item.user_id for item in ordered]
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Each participant may appear only once.")
    if payload.split_type == "equal":
        base, remainder = divmod(total_paise, len(ordered))
        return [(item.user_id, Decimal(base + (i < remainder)) / 100) for i, item in enumerate(ordered)]
    if payload.split_type == "exact":
        if sum((item.amount for item in ordered), ZERO) != payload.total_amount:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Exact shares must add up to the full expense amount.")
        return [(item.user_id, item.amount) for item in ordered]
    if payload.percentages is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Percentage values are required for a percentage split.")
    percentage_by_id = {item.user_id: item.value for item in payload.percentages}
    if len(percentage_by_id) != len(payload.percentages) or set(percentage_by_id) != set(ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Percentage shares must match the selected participants exactly.")
    if sum(percentage_by_id.values(), Decimal(0)) != Decimal("100.00"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Percentages must total 100.00%.")
    paise = [(user_id, total_paise * int(percentage_by_id[user_id] * 100) // 10_000) for user_id in ids]
    remainder = total_paise - sum(value for _, value in paise)
    return [(user_id, Decimal(value + (i < remainder)) / 100) for i, (user_id, value) in enumerate(paise)]


def _group_net_balances(db: Session, group_id: UUID) -> dict[UUID, Decimal]:
    member_ids = _active_member_ids(db, group_id)
    balances = {user_id: ZERO for user_id in member_ids}
    expenses = db.scalars(select(Expense).where(Expense.group_id == group_id, Expense.status == "active")).all()
    for expense in expenses:
        balances[expense.paid_by_user_id] = balances.get(expense.paid_by_user_id, ZERO) + expense.total_amount
        for split in db.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == expense.id)).all():
            balances[split.user_id] = balances.get(split.user_id, ZERO) - split.amount
    confirmed = db.scalars(select(Settlement).where(Settlement.group_id == group_id, Settlement.status == "confirmed")).all()
    for settlement in confirmed:
        balances[settlement.payer_user_id] = balances.get(settlement.payer_user_id, ZERO) + settlement.amount
        balances[settlement.recipient_user_id] = balances.get(settlement.recipient_user_id, ZERO) - settlement.amount
    return balances


@router.get("/dashboard", summary="Get the signed-in user's dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = db.scalars(
        select(Group).join(Membership, Membership.group_id == Group.id)
        .where(Membership.user_id == user.id, Membership.status == "active")
        .order_by(Group.updated_at.desc())
    ).all()
    owed_by_you = ZERO
    owed_to_you = ZERO
    for group in groups:
        group_balances = _group_net_balances(db, group.id)
        user_group_balance = group_balances.get(user.id, ZERO)
        owed_by_you += abs(min(user_group_balance, ZERO))
        owed_to_you += max(user_group_balance, ZERO)
    recent = db.scalars(
        select(Expense).join(Membership, Membership.group_id == Expense.group_id)
        .where(Membership.user_id == user.id, Membership.status == "active", Expense.status == "active")
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc()).limit(8)
    ).all()
    expense_count = db.scalar(
        select(func.count()).select_from(Expense).join(Membership, Membership.group_id == Expense.group_id)
        .where(Membership.user_id == user.id, Membership.status == "active", Expense.status == "active")
    ) or 0
    summary = {
        "groups_count": len(groups), "expense_count": expense_count,
        "total_owed_by_you": _money(owed_by_you),
        "total_owed_to_you": _money(owed_to_you),
        "currency": INR,
    }
    return {
        "data": [_serialize_expense(db, item) for item in recent],
        "summary": summary,
        "groups": [_serialize_group(db, item) for item in groups[:8]],
    }


@router.get("/groups", summary="List the signed-in user's groups")
def list_groups(
    limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    query = select(Group).join(Membership, Membership.group_id == Group.id).where(
        Membership.user_id == user.id, Membership.status == "active",
    ).order_by(Group.updated_at.desc())
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    groups = db.scalars(query.limit(limit).offset(offset)).all()
    return _collection([_serialize_group(db, group) for group in groups], total, limit, offset)


@router.post("/groups", status_code=status.HTTP_201_CREATED, summary="Create an INR group")
def create_group(payload: GroupCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    group = Group(
        name=payload.name.strip(), description=payload.description.strip() if payload.description else None,
        currency=payload.currency, created_by_user_id=user.id,
    )
    db.add(group)
    db.flush()
    db.add(Membership(group_id=group.id, user_id=user.id, role="admin", status="active"))
    _activity(db, group.id, user.id, "group_created", f"{user.display_name or user.username} created {group.name}.", "group", group.id)
    db.commit()
    db.refresh(group)
    return {"data": _serialize_group(db, group)}


@router.get("/groups/{group_id}", summary="Get a group")
def get_group(group_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _membership(db, group_id, user.id)
    return {"data": _serialize_group(db, _group(db, group_id))}


@router.patch("/groups/{group_id}", summary="Update group settings")
def update_group(group_id: UUID, payload: GroupPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(db, group_id, user.id)
    group = _group(db, group_id)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        if key == "name" and value is not None:
            value = value.strip()
        if key == "description" and value is not None:
            value = value.strip()
        setattr(group, key, value)
    group.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(group)
    return {"data": _serialize_group(db, group)}


@router.get("/groups/{group_id}/members", summary="List active group members")
def list_members(group_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _membership(db, group_id, user.id)
    rows = db.execute(
        select(Membership, User).join(User, User.id == Membership.user_id)
        .where(Membership.group_id == group_id, Membership.status == "active")
        .order_by(Membership.joined_at)
    ).all()
    return {"data": [{
        "user_id": str(member.user_id), "username": person.username,
        "display_name": person.display_name, "role": member.role,
    } for member, person in rows]}


@router.post("/groups/{group_id}/invitations", status_code=status.HTTP_201_CREATED, summary="Invite a user by email or username")
def create_invitation(group_id: UUID, payload: InvitationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(db, group_id, user.id)
    group = _require_active_group(db, group_id)
    email = str(payload.email).lower() if payload.email else None
    username = payload.username.lower() if payload.username else None
    invitee = db.scalar(select(User).where(func.lower(User.email) == email)) if email else db.scalar(select(User).where(func.lower(User.username) == username))
    if invitee and db.scalar(select(Membership).where(Membership.group_id == group_id, Membership.user_id == invitee.id, Membership.status == "active")):
        raise HTTPException(status.HTTP_409_CONFLICT, "This user is already an active group member.")
    duplicate = db.scalar(select(Invitation).where(
        Invitation.group_id == group_id, Invitation.status == "pending",
        Invitation.expires_at > datetime.now(UTC),
        Invitation.invitee_user_id == (invitee.id if invitee else None),
        Invitation.invitee_email == (email if not invitee else None),
        Invitation.invitee_username == (username if not invitee else None),
    ))
    if duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT, "A pending invitation already exists for this user.")
    if username and not invitee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account matches that username.")
    invitation = Invitation(
        group_id=group_id, inviter_user_id=user.id,
        invitee_user_id=invitee.id if invitee else None,
        invitee_email=email, invitee_username=username,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(invitation)
    db.flush()
    if invitee:
        _notify(db, invitee.id, "invitation", "Group invitation", f"{user.display_name or user.username} invited you to {group.name}.", group_id=group_id, entity_type="invitation", entity_id=invitation.id)
    _activity(db, group_id, user.id, "invitation_created", f"{user.display_name or user.username} invited a member to {group.name}.", "invitation", invitation.id)
    db.commit()
    return {"data": _serialize_invitation(db, invitation)}


@router.get("/invitations", summary="List invitations for the signed-in user")
def list_invitations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.now(UTC)
    db.query(Invitation).filter(Invitation.status == "pending", Invitation.expires_at <= now).update({Invitation.status: "expired"}, synchronize_session=False)
    db.flush()
    rows = db.scalars(select(Invitation).where(
        (Invitation.invitee_user_id == user.id) |
        (func.lower(Invitation.invitee_email) == user.email.lower()) |
        (func.lower(Invitation.invitee_username) == user.username.lower()),
    ).order_by(Invitation.created_at.desc())).all()
    db.commit()
    return {"data": [_serialize_invitation(db, item) for item in rows]}


@router.post("/invitations/{invitation_id}/{decision}", summary="Accept or decline an invitation")
def respond_invitation(invitation_id: UUID, decision: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if decision not in {"accept", "decline"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation action not found.")
    item = db.scalar(select(Invitation).where(Invitation.id == invitation_id).with_for_update())
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found.")
    recipient_matches = (
        item.invitee_user_id == user.id
        or (item.invitee_email and item.invitee_email.lower() == user.email.lower())
        or (item.invitee_username and item.invitee_username.lower() == user.username.lower())
    )
    if not recipient_matches:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found.")
    if item.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This invitation has already been handled.")
    if _utc(item.expires_at) <= datetime.now(UTC):
        item.status = "expired"
        db.commit()
        raise HTTPException(status.HTTP_410_GONE, "This invitation has expired.")
    group = _require_active_group(db, item.group_id)
    inviter = db.get(User, item.inviter_user_id)
    item.invitee_user_id = user.id
    item.status = "accepted" if decision == "accept" else "declined"
    item.responded_at = datetime.now(UTC)
    if decision == "accept":
        membership = db.scalar(select(Membership).where(Membership.group_id == group.id, Membership.user_id == user.id))
        if membership:
            membership.status = "active"
            membership.role = "member"
            membership.left_at = None
            membership.joined_at = datetime.now(UTC)
        else:
            db.add(Membership(group_id=group.id, user_id=user.id, role="member", status="active"))
    if inviter:
        _notify(db, inviter.id, "invitation_response", "Invitation response", f"{user.display_name or user.username} {decision}ed your invitation to {group.name}.", group_id=group.id, entity_type="invitation", entity_id=item.id)
    _activity(db, group.id, user.id, f"invitation_{item.status}", f"{user.display_name or user.username} {item.status} an invitation to {group.name}.", "invitation", item.id)
    db.commit()
    return {"message": f"Invitation {item.status}.", "data": _serialize_invitation(db, item)}


@router.post("/groups/{group_id}/invite-links", status_code=status.HTTP_201_CREATED, summary="Create a seven-day invite link")
def create_invite_link(group_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(db, group_id, user.id)
    _require_active_group(db, group_id)
    token = secrets.token_urlsafe(32)
    link = InviteLink(
        group_id=group_id, created_by_user_id=user.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(link)
    db.commit()
    frontend_origin = settings.frontend_base_url.rstrip("/")
    url = f"{frontend_origin}/invite/{token}"
    return {"data": {"id": str(link.id), "url": url, "invite_url": url, "expires_at": link.expires_at.isoformat()}}


def _valid_invite_link(db: Session, token: str) -> InviteLink:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    link = db.scalar(select(InviteLink).where(InviteLink.token_hash == token_hash))
    if not link or link.revoked_at or _utc(link.expires_at) <= datetime.now(UTC):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation link is invalid or expired.")
    return link


@router.get("/invite-links/{token}/preview", summary="Preview a group invitation link")
def preview_invite_link(token: str, db: Session = Depends(get_db)):
    link = _valid_invite_link(db, token)
    group = _group(db, link.group_id)
    return {"data": {"name": group.name, "description": group.description, "expires_at": link.expires_at.isoformat()}}


@router.post("/invite-links/{token}/join-requests", status_code=status.HTTP_202_ACCEPTED, summary="Request to join from an invite link")
def create_join_request(token: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    link = _valid_invite_link(db, token)
    group = _group(db, link.group_id)
    if group.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This group is archived.")
    member = db.scalar(select(Membership).where(Membership.group_id == group.id, Membership.user_id == user.id, Membership.status == "active"))
    if member:
        raise HTTPException(status.HTTP_409_CONFLICT, "You are already a group member.")
    existing = db.scalar(select(JoinRequest).where(JoinRequest.invite_link_id == link.id, JoinRequest.user_id == user.id, JoinRequest.status == "pending"))
    if existing:
        return {"message": "Your join request is already waiting for administrator approval."}
    join_request = JoinRequest(invite_link_id=link.id, group_id=group.id, user_id=user.id)
    db.add(join_request)
    db.flush()
    admins = db.scalars(select(Membership.user_id).where(Membership.group_id == group.id, Membership.role == "admin", Membership.status == "active")).all()
    for admin_id in admins:
        _notify(db, admin_id, "join_request", "Group join request", f"{user.display_name or user.username} requested to join {group.name}.", group_id=group.id, entity_type="join_request", entity_id=join_request.id)
    _activity(db, group.id, user.id, "join_requested", f"{user.display_name or user.username} requested to join {group.name}.", "join_request", join_request.id)
    db.commit()
    return {"message": "Your request was sent. Group membership is not active until the group administrator approves it."}


@router.get("/groups/{group_id}/join-requests", summary="List pending join requests for administrators")
def list_join_requests(group_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(db, group_id, user.id)
    rows = db.execute(select(JoinRequest, User).join(User, User.id == JoinRequest.user_id).where(
        JoinRequest.group_id == group_id, JoinRequest.status == "pending",
    ).order_by(JoinRequest.created_at)).all()
    return {"data": [{
        "id": str(item.id), "user_id": str(person.id), "username": person.username,
        "display_name": person.display_name, "status": item.status, "created_at": item.created_at.isoformat(),
    } for item, person in rows]}


@router.post("/groups/{group_id}/join-requests/{request_id}/{decision}", summary="Approve or reject a join request")
def review_join_request(group_id: UUID, request_id: UUID, decision: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(db, group_id, user.id)
    if decision not in {"approve", "reject"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Join request action not found.")
    item = db.scalar(select(JoinRequest).where(JoinRequest.id == request_id, JoinRequest.group_id == group_id).with_for_update())
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Join request not found.")
    if item.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This join request has already been reviewed.")
    group = _group(db, group_id)
    item.status = "approved" if decision == "approve" else "rejected"
    item.reviewed_at = datetime.now(UTC)
    item.reviewed_by_user_id = user.id
    person = db.get(User, item.user_id)
    if decision == "approve":
        membership = db.scalar(select(Membership).where(Membership.group_id == group_id, Membership.user_id == item.user_id))
        if membership:
            membership.status = "active"
            membership.role = "member"
            membership.left_at = None
            membership.joined_at = datetime.now(UTC)
        else:
            db.add(Membership(group_id=group_id, user_id=item.user_id, role="member", status="active"))
    if person:
        _notify(db, person.id, "join_request_response", "Join request update", f"Your request to join {group.name} was {item.status}.", group_id=group_id, entity_type="join_request", entity_id=item.id)
    _activity(db, group_id, user.id, f"join_request_{item.status}", f"An administrator {item.status} a join request for {group.name}.", "join_request", item.id)
    db.commit()
    return {"message": f"Join request {item.status}.", "data": {"id": str(item.id), "status": item.status}}


@router.get("/groups/{group_id}/expenses", summary="List active group expenses")
def list_expenses(group_id: UUID, limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _membership(db, group_id, user.id)
    query = select(Expense).where(Expense.group_id == group_id, Expense.status == "active").order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.limit(limit).offset(offset)).all()
    return _collection([_serialize_expense(db, item) for item in items], total, limit, offset)


@router.post("/groups/{group_id}/expenses", status_code=status.HTTP_201_CREATED, summary="Create an expense with validated splits")
def create_expense(group_id: UUID, payload: ExpenseCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_active_group(db, group_id)
    _membership(db, group_id, user.id)
    if payload.currency != INR:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only INR is supported.")
    if payload.idempotency_key:
        existing = db.scalar(select(Expense).where(
            Expense.group_id == group_id, Expense.created_by_user_id == user.id,
            Expense.idempotency_key == payload.idempotency_key,
        ))
        if existing:
            return {"data": _serialize_expense(db, existing)}
    split_amounts = _split_amounts(payload)
    member_ids = [item[0] for item in split_amounts]
    _validate_members(db, group_id, list(set([payload.paid_by_user_id, *member_ids])))
    expense = Expense(
        group_id=group_id, paid_by_user_id=payload.paid_by_user_id,
        created_by_user_id=user.id, description=payload.description.strip(),
        expense_date=payload.expense_date, currency=payload.currency,
        total_amount=payload.total_amount, split_type=payload.split_type,
        idempotency_key=payload.idempotency_key,
    )
    db.add(expense)
    db.flush()
    for participant_id, amount in split_amounts:
        db.add(ExpenseSplit(expense_id=expense.id, user_id=participant_id, amount=amount))
    _activity(db, group_id, user.id, "expense_created", f"{user.display_name or user.username} added {expense.description}.", "expense", expense.id)
    group = _group(db, group_id)
    for recipient_id in set(member_ids + [payload.paid_by_user_id]):
        if recipient_id != user.id:
            _notify(db, recipient_id, "expense", "New group expense", f"{user.display_name or user.username} added {expense.description} to {group.name}.", group_id=group_id, entity_type="expense", entity_id=expense.id)
    db.commit()
    db.refresh(expense)
    return {"data": _serialize_expense(db, expense)}


def _expense_access(db: Session, expense_id: UUID, user: User) -> tuple[Expense, Membership]:
    expense = db.get(Expense, expense_id)
    if not expense:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found.")
    membership = _membership(db, expense.group_id, user.id)
    return expense, membership


@router.get("/expenses/{expense_id}", summary="Get an expense and its splits")
def get_expense(expense_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expense, _ = _expense_access(db, expense_id, user)
    return {"data": _serialize_expense(db, expense)}


@router.patch("/expenses/{expense_id}", summary="Edit an expense")
def update_expense(expense_id: UUID, payload: ExpensePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expense, membership = _expense_access(db, expense_id, user)
    if expense.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "Voided expenses cannot be edited.")
    if expense.created_by_user_id != user.id and membership.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator or a group administrator can edit this expense.")
    if payload.total_amount != expense.total_amount:
        splits = db.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == expense.id).order_by(ExpenseSplit.user_id)).all()
        old_total = expense.total_amount
        total_paise = int(payload.total_amount * 100)
        raw = [(split, int((split.amount * total_paise / old_total).to_integral_value(rounding=ROUND_DOWN))) for split in splits]
        remainder = total_paise - sum(value for _, value in raw)
        for i, (split, value) in enumerate(raw):
            split.amount = Decimal(value + (i < remainder)) / 100
        expense.total_amount = payload.total_amount
    expense.description = payload.description.strip()
    expense.updated_at = datetime.now(UTC)
    _activity(db, expense.group_id, user.id, "expense_updated", f"{user.display_name or user.username} updated {expense.description}.", "expense", expense.id)
    db.commit()
    db.refresh(expense)
    return {"data": _serialize_expense(db, expense)}


@router.post("/expenses/{expense_id}/void", summary="Void an expense without deleting history")
def void_expense(expense_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expense, membership = _expense_access(db, expense_id, user)
    if expense.created_by_user_id != user.id and membership.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator or a group administrator can void this expense.")
    if expense.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This expense is already voided.")
    expense.status = "voided"
    expense.voided_at = datetime.now(UTC)
    _activity(db, expense.group_id, user.id, "expense_voided", f"{user.display_name or user.username} voided {expense.description}.", "expense", expense.id)
    db.commit()
    return {"data": {"id": str(expense.id), "status": expense.status}}


@router.get("/expenses/{expense_id}/history", summary="Get expense audit history")
def expense_history(expense_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expense, _ = _expense_access(db, expense_id, user)
    rows = db.execute(select(ActivityEvent, User).outerjoin(User, User.id == ActivityEvent.actor_user_id).where(
        ActivityEvent.group_id == expense.group_id,
        ActivityEvent.entity_type == "expense", ActivityEvent.entity_id == expense.id,
    ).order_by(ActivityEvent.created_at.desc())).all()
    return {"data": [{
        "id": str(event.id), "event_type": event.event_type, "description": event.description,
        "actor_name": (actor.display_name or actor.username) if actor else "Former member",
        "created_at": event.created_at.isoformat(),
    } for event, actor in rows]}


@router.get("/groups/{group_id}/balances", summary="Calculate current group balances")
def group_balances(group_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _membership(db, group_id, user.id)
    balances = _group_net_balances(db, group_id)
    rows = db.execute(select(User).where(User.id.in_(list(balances))).order_by(User.id)).scalars().all() if balances else []
    return {"data": [{
        "user_id": str(person.id), "username": person.username, "display_name": person.display_name,
        "net_amount": _money(balances[person.id]), "currency": INR,
        "position": "owed_to" if balances[person.id] > 0 else "owes" if balances[person.id] < 0 else "settled",
    } for person in rows]}


@router.get("/balances", summary="List the signed-in user's balances by group")
def personal_balances(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    groups = db.scalars(select(Group).join(Membership, Membership.group_id == Group.id).where(
        Membership.user_id == user.id, Membership.status == "active",
    ).order_by(Group.name)).all()
    return {"data": [{
        "group_id": str(group.id), "group_name": group.name,
        "net_amount": _money(_group_net_balances(db, group.id).get(user.id, ZERO)),
        "currency": group.currency,
    } for group in groups]}


@router.get("/groups/{group_id}/settlements", summary="List group settlements")
def list_settlements(group_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _membership(db, group_id, user.id)
    items = db.scalars(select(Settlement).where(Settlement.group_id == group_id).order_by(Settlement.created_at.desc())).all()
    return {"data": [_serialize_settlement(db, item) for item in items]}


@router.get("/settlements", summary="List settlements in the signed-in user's groups")
def list_my_settlements(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    group_ids = select(Membership.group_id).where(
        Membership.user_id == user.id, Membership.status == "active",
    )
    items = db.scalars(select(Settlement).where(Settlement.group_id.in_(group_ids)).order_by(Settlement.created_at.desc())).all()
    return {"data": [_serialize_settlement(db, item) for item in items]}


@router.get("/settlements/{settlement_id}", summary="Get settlement details")
def get_settlement(settlement_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.get(Settlement, settlement_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Settlement not found.")
    _membership(db, item.group_id, user.id)
    return {"data": _serialize_settlement(db, item)}


@router.post("/groups/{group_id}/settlements", status_code=status.HTTP_201_CREATED, summary="Propose a settlement")
def create_settlement(group_id: UUID, payload: SettlementCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_active_group(db, group_id)
    _membership(db, group_id, user.id)
    _validate_members(db, group_id, [user.id, payload.recipient_user_id])
    if payload.recipient_user_id == user.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Payer and recipient must be different users.")
    if payload.idempotency_key:
        existing = db.scalar(select(Settlement).where(
            Settlement.group_id == group_id, Settlement.created_by_user_id == user.id,
            Settlement.idempotency_key == payload.idempotency_key,
        ))
        if existing:
            return {"data": _serialize_settlement(db, existing)}
    item = Settlement(
        group_id=group_id, payer_user_id=user.id, recipient_user_id=payload.recipient_user_id,
        created_by_user_id=user.id, amount=payload.amount, currency=payload.currency,
        idempotency_key=payload.idempotency_key,
    )
    db.add(item)
    db.flush()
    group = _group(db, group_id)
    _notify(db, payload.recipient_user_id, "settlement", "Settlement proposed", f"{user.display_name or user.username} proposed INR {_money(payload.amount)} for {group.name}.", group_id=group_id, entity_type="settlement", entity_id=item.id)
    _activity(db, group_id, user.id, "settlement_proposed", f"{user.display_name or user.username} proposed a settlement of INR {_money(payload.amount)}.", "settlement", item.id)
    db.commit()
    db.refresh(item)
    return {"data": _serialize_settlement(db, item)}


@router.post("/settlements/{settlement_id}/{action}", summary="Confirm, reject, or cancel a pending settlement")
def transition_settlement(settlement_id: UUID, action: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if action not in {"confirm", "reject", "cancel"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Settlement action not found.")
    item = db.scalar(select(Settlement).where(Settlement.id == settlement_id).with_for_update())
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Settlement not found.")
    _membership(db, item.group_id, user.id)
    if item.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only pending settlements can be changed.")
    if action in {"confirm", "reject"} and user.id != item.recipient_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the recipient can confirm or reject a settlement.")
    if action == "cancel" and user.id != item.created_by_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can cancel a pending settlement.")
    item.status = {"confirm": "confirmed", "reject": "rejected", "cancel": "cancelled"}[action]
    item.responded_at = datetime.now(UTC)
    recipient = db.get(User, item.recipient_user_id)
    payer = db.get(User, item.payer_user_id)
    notify_user = item.payer_user_id if user.id == item.recipient_user_id else item.recipient_user_id
    group = _group(db, item.group_id)
    _notify(db, notify_user, "settlement_response", "Settlement update", f"{user.display_name or user.username} {item.status} a settlement for {group.name}.", group_id=group.id, entity_type="settlement", entity_id=item.id)
    _activity(db, group.id, user.id, f"settlement_{item.status}", f"{user.display_name or user.username} {item.status} a proposed settlement.", "settlement", item.id)
    db.commit()
    return {"data": _serialize_settlement(db, item)}


@router.get("/notifications", summary="List notifications for the signed-in user")
def list_notifications(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.limit(limit).offset(offset)).all()
    return _collection([{
        "id": str(item.id), "type": item.type, "title": item.title, "body": item.body,
        "group_id": str(item.group_id) if item.group_id else None,
        "related_entity_type": item.related_entity_type,
        "related_entity_id": str(item.related_entity_id) if item.related_entity_id else None,
        "is_read": item.is_read, "created_at": item.created_at.isoformat(),
    } for item in items], total, limit, offset)


@router.get("/notifications/unread-count", summary="Get unread notification count")
def unread_notification_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False))) or 0
    return {"data": {"unread_count": count}}


@router.post("/notifications/{notification_id}/read", summary="Mark an owned notification as read")
def mark_notification_read(notification_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id).with_for_update())
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    if not item.is_read:
        item.is_read = True
        item.read_at = datetime.now(UTC)
        db.commit()
    return {"data": {"id": str(item.id), "is_read": item.is_read}}


@router.post("/notifications/read-all", summary="Mark all owned notifications as read")
def mark_all_notifications_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.now(UTC)
    result = db.query(Notification).filter(Notification.user_id == user.id, Notification.is_read.is_(False)).update(
        {Notification.is_read: True, Notification.read_at: now}, synchronize_session=False,
    )
    db.commit()
    return {"data": {"updated_count": result}}


@router.get("/activity", summary="List activity in the signed-in user's groups")
def list_activity(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    group_ids = select(Membership.group_id).where(Membership.user_id == user.id, Membership.status == "active")
    query = select(ActivityEvent, User).outerjoin(User, User.id == ActivityEvent.actor_user_id).where(ActivityEvent.group_id.in_(group_ids)).order_by(ActivityEvent.created_at.desc())
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.limit(limit).offset(offset)).all()
    data = [{
        "id": str(event.id), "group_id": str(event.group_id), "event_type": event.event_type,
        "description": event.description, "actor_name": (actor.display_name or actor.username) if actor else "Former member",
        "entity_type": event.entity_type, "entity_id": str(event.entity_id) if event.entity_id else None,
        "created_at": event.created_at.isoformat(),
    } for event, actor in rows]
    return _collection(data, total, limit, offset)


@router.get("/users/me", summary="Get the signed-in user's profile")
def get_profile(user: User = Depends(get_current_user)):
    return {"data": {"id": str(user.id), "username": user.username, "email": user.email, "display_name": user.display_name, "is_email_verified": user.is_email_verified}}


@router.patch("/users/me", summary="Update the signed-in user's profile")
def update_profile(payload: ProfilePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user.display_name = payload.display_name.strip()
    user.updated_at = datetime.now(UTC)
    db.commit()
    return {"data": {"id": str(user.id), "username": user.username, "email": user.email, "display_name": user.display_name}}


@router.post("/auth/change-password", summary="Change the signed-in user's password")
def change_password(payload: ChangePassword, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not user.hashed_password or not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    if payload.current_password == payload.new_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a different new password.")
    user.hashed_password = hash_password(payload.new_password)
    user.updated_at = datetime.now(UTC)
    db.commit()
    return {"message": "Password updated. Sign in again with your new password."}


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, summary="End the current client session")
def logout(_user: User = Depends(get_current_user)):
    # Access tokens are short lived and held only in memory by the SPA. There
    # is no server-side refresh session to revoke in the current architecture.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
