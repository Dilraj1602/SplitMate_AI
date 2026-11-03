"""Shared persistence path for confirmed expenses and their validated splits."""
from datetime import date
from decimal import Decimal
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
