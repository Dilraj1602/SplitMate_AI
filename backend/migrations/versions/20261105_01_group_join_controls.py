"""Add configurable group join approval and temporary join codes.

Revision ID: 20261105_01
Revises: 20261104_01
"""
from alembic import op
import sqlalchemy as sa


revision = "20261105_01"
down_revision = "20261104_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "groups",
        sa.Column("join_approval_required", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_table(
        "join_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("encrypted_code", sa.String(length=256), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index("ix_join_codes_group_id", "join_codes", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_join_codes_group_id", table_name="join_codes")
    op.drop_table("join_codes")
    op.drop_column("groups", "join_approval_required")
