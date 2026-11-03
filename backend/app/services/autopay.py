"""Persistent recurring expense and reminder processing."""
import calendar
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, ROUND_DOWN
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.db.session import SessionLocal
from backend.app.models import (AutopayOccurrence, AutopayParticipant, AutopayReminderLog,
    Expense, Group, Membership, Notification, RecurringAutopay, ActivityEvent, User)
from backend.app.services.expenses import create_expense_record


def advance_date(current: date, frequency: str, interval: int) -> date:
    if frequency == "daily": return current + timedelta(days=interval)
    if frequency == "weekly": return current + timedelta(weeks=interval)
    months = interval if frequency == "monthly" else interval * 12
    index = current.year * 12 + current.month - 1 + months
    year, month = divmod(index, 12); month += 1
    return date(year, month, min(current.day, calendar.monthrange(year, month)[1]))


def _notification(db: Session, user_id, group_id, title: str, body: str, entity_id):
    db.add(Notification(user_id=user_id, group_id=group_id, type="autopay_reminder", title=title,
        body=body, related_entity_type="autopay", related_entity_id=entity_id))


def process_autopays(db: Session | None = None) -> None:
    """Run a restart-safe poll. Unique constraints make repeated polls idempotent."""
    own_session = db is None
    db = db or SessionLocal()
    try:
        today_utc = datetime.now(UTC)
        items = db.scalars(select(RecurringAutopay).where(RecurringAutopay.status == "active").with_for_update(skip_locked=True)).all()
        for item in items:
            local_today = today_utc.astimezone(ZoneInfo(item.timezone)).date()
            group = db.get(Group, item.group_id)
            if not group or group.status != "active": continue
            participants = db.scalars(select(AutopayParticipant).where(AutopayParticipant.autopay_id == item.id)).all()
            active = [p for p in participants if p.approval_status == "accepted" and p.participation_status == "active"]
            if not active or any(p.approval_status == "pending" or (p.approval_status == "accepted" and p.participation_status == "paused") for p in participants):
                continue
            active_member_ids = set(db.scalars(select(Membership.user_id).where(Membership.group_id == item.group_id, Membership.status == "active")).all())
            if any(p.user_id not in active_member_ids for p in active): continue
            # Ensure a durable occurrence exists even when the process was down.
            occurrence = db.scalar(select(AutopayOccurrence).where(AutopayOccurrence.autopay_id == item.id,
                AutopayOccurrence.scheduled_date == item.next_payment_date).with_for_update())
            if occurrence is None:
                occurrence = AutopayOccurrence(autopay_id=item.id, scheduled_date=item.next_payment_date, status="pending")
                db.add(occurrence)
                try: db.flush()
                except IntegrityError: db.rollback(); continue
            for offset, kind, title, message in (
                (3, "3_days", "Upcoming Autopay Reminder", f"Your {item.description} autopay of {item.currency} {item.amount} is scheduled in 3 days."),
                (2, "2_days", "Autopay due in 2 days", f"Your {item.description} autopay is due in 2 days."),
                (1, "1_day", "Payment Due Tomorrow", f"Your {item.description} autopay is scheduled for tomorrow."),
                (0, "due_today", "Autopay Due Today", f"Your {item.description} is scheduled for today."),
            ):
                for participant in active:
                    person = db.get(User, participant.user_id)
                    if not person: continue
                    participant_timezone = ZoneInfo(person.timezone)
                    payment_date_for_person = datetime.combine(occurrence.scheduled_date, datetime.min.time(), ZoneInfo(item.timezone)).astimezone(participant_timezone).date()
                    if (payment_date_for_person - today_utc.astimezone(participant_timezone).date()).days != offset: continue
                    existing = db.scalar(select(AutopayReminderLog.id).where(AutopayReminderLog.occurrence_id == occurrence.id,
                        AutopayReminderLog.user_id == participant.user_id, AutopayReminderLog.reminder_type == kind))
                    if existing: continue
                    log = AutopayReminderLog(occurrence_id=occurrence.id, user_id=participant.user_id, reminder_type=kind,
                        scheduled_at=today_utc.astimezone(participant_timezone), delivery_status="sent", sent_at=today_utc)
                    db.add(log)
                    _notification(db, participant.user_id, item.group_id, title,
                        f"{message} Your share: {item.currency} {participant.share_amount}. Payment date: {occurrence.scheduled_date.isoformat()}.", item.id)
            if occurrence.scheduled_date <= local_today and occurrence.status == "pending":
                # Removed participants do not appear on future occurrences. Their share is
                # redistributed proportionally among the remaining approved participants.
                total = sum((p.share_amount for p in active), Decimal("0"))
                cents = Decimal("0.01")
                split_values = []
                used = Decimal("0")
                for p in active[:-1]:
                    amount = (item.amount * p.share_amount / total).quantize(cents, rounding=ROUND_DOWN) if total else Decimal("0")
                    split_values.append((p.user_id, amount)); used += amount
                split_values.append((active[-1].user_id, item.amount - used))
                key = f"autopay-{item.id}-{occurrence.scheduled_date.isoformat()}"
                already_created = db.scalar(select(Expense.id).where(Expense.group_id == item.group_id,
                    Expense.created_by_user_id == item.created_by_user_id, Expense.idempotency_key == key)) is not None
                expense = create_expense_record(db, group_id=item.group_id, paid_by_user_id=item.payer_user_id,
                    created_by_user_id=item.created_by_user_id, description=item.description, expense_date=occurrence.scheduled_date,
                    currency=item.currency, total_amount=item.amount, split_type="exact", split_amounts=split_values,
                    idempotency_key=key)
                if not already_created:
                    db.add(ActivityEvent(group_id=item.group_id, actor_user_id=item.created_by_user_id, event_type="expense_created",
                        description=f"Recurring expense {item.description} was generated.", entity_type="expense", entity_id=expense.id))
                occurrence.expense_id = expense.id; occurrence.status = "processed"; occurrence.processed_at = today_utc
                for participant in active:
                    _notification(db, participant.user_id, item.group_id, "Recurring expense generated",
                        f"{item.description} ({item.currency} {item.amount}) was added to the group.", item.id)
                next_date = advance_date(item.next_payment_date, item.frequency, item.repeat_interval)
                item.next_payment_date = next_date
                if item.end_date and next_date > item.end_date: item.status = "completed"
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if own_session: db.close()
