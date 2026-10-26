"""Track successful username changes for server enforced cooldowns.

Revision ID: 20261026_01
Revises: 20261025_02
"""
from alembic import op
import sqlalchemy as sa

revision = "20261026_01"
down_revision = "20261025_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username_changed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "username_changed_at")
