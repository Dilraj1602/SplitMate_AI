"""Add recurring autopay invitations, occurrences, and reminder history.

Revision ID: 20261102_01
Revises: 20261026_01
"""
from alembic import op
import sqlalchemy as sa
revision = "20261102_01"
down_revision = "20261026_01"
branch_labels = None
depends_on = None


def _uuid():
    return sa.Uuid()


def upgrade() -> None:
    op.add_column("users", sa.Column("timezone", sa.String(64), server_default="Asia/Kolkata", nullable=False))
    op.create_table(
        "recurring_autopays",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column("group_id", _uuid(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", _uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("payer_user_id", _uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("split_type", sa.String(16), nullable=False),
        sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("repeat_interval", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date()),
        sa.Column("next_payment_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_recurring_autopays_group_id", "recurring_autopays", ["group_id"])
    op.create_index("ix_recurring_autopays_next_payment_date", "recurring_autopays", ["next_payment_date"])
    op.create_index("ix_recurring_autopays_status", "recurring_autopays", ["status"])
    op.create_table(
        "autopay_participants",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column("autopay_id", _uuid(), sa.ForeignKey("recurring_autopays.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", _uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("share_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("approval_status", sa.String(16), nullable=False),
        sa.Column("participation_status", sa.String(16), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("paused_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("autopay_id", "user_id", name="uq_autopay_participant_user"),
    )
    op.create_index("ix_autopay_participants_autopay_id", "autopay_participants", ["autopay_id"])
    op.create_index("ix_autopay_participants_user_id", "autopay_participants", ["user_id"])
    op.create_table(
        "autopay_occurrences",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column("autopay_id", _uuid(), sa.ForeignKey("recurring_autopays.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("expense_id", _uuid(), sa.ForeignKey("expenses.id", ondelete="SET NULL"), unique=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("autopay_id", "scheduled_date", name="uq_autopay_occurrence_date"),
    )
    op.create_index("ix_autopay_occurrences_autopay_id", "autopay_occurrences", ["autopay_id"])
    op.create_table(
        "autopay_reminder_logs",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column("occurrence_id", _uuid(), sa.ForeignKey("autopay_occurrences.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", _uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reminder_type", sa.String(16), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("delivery_status", sa.String(16), nullable=False),
        sa.UniqueConstraint("occurrence_id", "user_id", "reminder_type", name="uq_autopay_reminder_once"),
    )
    op.create_index("ix_autopay_reminder_logs_occurrence_id", "autopay_reminder_logs", ["occurrence_id"])
    op.create_index("ix_autopay_reminder_logs_user_id", "autopay_reminder_logs", ["user_id"])


def downgrade() -> None:
    op.drop_table("autopay_reminder_logs")
    op.drop_table("autopay_occurrences")
    op.drop_table("autopay_participants")
    op.drop_table("recurring_autopays")
    op.drop_column("users", "timezone")
