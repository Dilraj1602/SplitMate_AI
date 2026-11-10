"""Shared persistence path for confirmed expenses and their validated splits."""
from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_DOWN
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import Expense, ExpenseSplit


def create_expense_record(
    db: Session, *, group_id: UUID, created_by_user_id: UUID, paid_by_user_id: UUID,
    description: str, expense_date: date, currency: str, total_amount: Decimal,
    split_type: str, split_amounts: list[tuple[UUID, Decimal]], idempotency_key: str | None = None,
) -> Expense:
    """Insert an expense after the caller validates group membership and split totals."""
    if idempotency_key:
        existing = db.scalar(select(Expense).where(Expense.group_id == group_id,
            Expense.created_by_user_id == created_by_user_id, Expense.idempotency_key == idempotency_key))
        if existing:
            return existing
    expense = Expense(group_id=group_id, paid_by_user_id=paid_by_user_id, created_by_user_id=created_by_user_id,
        description=description.strip(), expense_date=expense_date, currency=currency, total_amount=total_amount,
        split_type=split_type, idempotency_key=idempotency_key)
    db.add(expense)
    db.flush()
    db.add_all(ExpenseSplit(expense_id=expense.id, user_id=user_id, amount=amount) for user_id, amount in split_amounts)
    return expense


def update_expense_record(db: Session, expense: Expense, *, description: str | None = None, total_amount: Decimal | None = None) -> Expense:
    """Update trusted expense fields and preserve the existing proportional split rule."""
    if total_amount is not None and total_amount != expense.total_amount:
        splits = db.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == expense.id).order_by(ExpenseSplit.user_id)).all()
        old_total = expense.total_amount
        total_paise = int(total_amount * 100)
        raw = [(split, int((split.amount * total_paise / old_total).to_integral_value(rounding=ROUND_DOWN))) for split in splits]
        remainder = total_paise - sum(value for _, value in raw)
        for i, (split, value) in enumerate(raw):
            split.amount = Decimal(value + (i < remainder)) / 100
        expense.total_amount = total_amount
    if description is not None:
        expense.description = description.strip()
    expense.updated_at = datetime.now(UTC)
    return expense


def void_expense_record(expense: Expense) -> Expense:
    """Void an expense while retaining its audit history."""
    expense.status = "voided"
    expense.voided_at = datetime.now(UTC)
    return expense
