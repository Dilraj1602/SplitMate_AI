"""Add hashed, single-use password-reset sessions and IP request limits.

Revision ID: 20261104_01
Revises: 20261102_01
"""
from alembic import op
import sqlalchemy as sa


revision = "20261104_01"
down_revision = "20261102_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("auth_token_version", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("auth_otps", sa.Column("reset_token_hash", sa.String(length=64), nullable=True))
    op.add_column("auth_otps", sa.Column("reset_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("auth_otps", sa.Column("reset_used_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("uq_auth_otps_reset_token_hash", "auth_otps", ["reset_token_hash"], unique=True)
    op.create_table(
        "auth_otp_ip_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_auth_otp_ip_requests_ip_purpose_created",
        "auth_otp_ip_requests",
        ["ip_hash", "purpose", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_auth_otp_ip_requests_ip_purpose_created", table_name="auth_otp_ip_requests")
    op.drop_table("auth_otp_ip_requests")
    op.drop_index("uq_auth_otps_reset_token_hash", table_name="auth_otps")
    op.drop_column("auth_otps", "reset_used_at")
    op.drop_column("auth_otps", "reset_expires_at")
    op.drop_column("auth_otps", "reset_token_hash")
    op.drop_column("users", "auth_token_version")
