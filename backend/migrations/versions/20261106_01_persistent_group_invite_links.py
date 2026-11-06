"""Make one encrypted, configurable invitation link persistent per group.

Revision ID: 20261106_01
Revises: 20261105_01
"""
import base64
import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import Fernet

from backend.app.config import settings


revision = "20261106_01"
down_revision = "20261105_01"
branch_labels = None
depends_on = None


def _cipher() -> Fernet:
    if not settings.secret_key:
        raise RuntimeError("SECRET_KEY must be configured to migrate persistent invitation links safely.")
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest())
    return Fernet(key)


def upgrade() -> None:
    op.add_column("invite_links", sa.Column("encrypted_token", sa.String(length=256), nullable=True))
    op.add_column("invite_links", sa.Column("expiration_option", sa.String(length=16), server_default="never", nullable=False))
    op.alter_column("invite_links", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=True)

    connection = op.get_bind()
    cipher = _cipher()
    groups = connection.execute(sa.text("SELECT id, created_by_user_id FROM groups")).all()
    now = datetime.now(UTC)
    for group_id, owner_id in groups:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        encrypted_token = cipher.encrypt(token.encode()).decode()
        rows = connection.execute(
            sa.text("SELECT id FROM invite_links WHERE group_id = :group_id ORDER BY created_at DESC, id DESC"),
            {"group_id": group_id},
        ).scalars().all()
        if rows:
            persistent_id = rows[0]
            connection.execute(
                sa.text("UPDATE invite_links SET token_hash = :token_hash, encrypted_token = :encrypted_token, expiration_option = 'never', expires_at = NULL, revoked_at = NULL WHERE id = :link_id"),
                {"token_hash": token_hash, "encrypted_token": encrypted_token, "link_id": persistent_id},
            )
            if len(rows) > 1:
                encrypted_revoked = cipher.encrypt(secrets.token_urlsafe(32).encode()).decode()
                connection.execute(
                    sa.text("UPDATE invite_links SET revoked_at = :revoked_at, encrypted_token = :encrypted_token WHERE group_id = :group_id AND id <> :link_id"),
                    {"revoked_at": now, "encrypted_token": encrypted_revoked, "group_id": group_id, "link_id": persistent_id},
                )
        else:
            connection.execute(
                sa.text("INSERT INTO invite_links (id, group_id, created_by_user_id, token_hash, encrypted_token, expiration_option, expires_at, revoked_at, created_at) VALUES (:id, :group_id, :owner_id, :token_hash, :encrypted_token, 'never', NULL, NULL, :created_at)"),
                {"id": uuid.uuid4(), "group_id": group_id, "owner_id": owner_id, "token_hash": token_hash, "encrypted_token": encrypted_token, "created_at": now},
            )

    op.drop_index("ix_invite_links_group_id", table_name="invite_links")
    op.create_index(
        "uq_invite_links_one_active_per_group", "invite_links", ["group_id"], unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.alter_column("invite_links", "encrypted_token", existing_type=sa.String(length=256), nullable=False)


def downgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id FROM invite_links WHERE expires_at IS NULL")).scalars().all()
    now = datetime.now(UTC)
    for link_id in rows:
        connection.execute(
            sa.text("UPDATE invite_links SET expires_at = :expires_at WHERE id = :link_id"),
            {"expires_at": now, "link_id": link_id},
        )
    op.drop_index("uq_invite_links_one_active_per_group", table_name="invite_links")
    op.create_index("ix_invite_links_group_id", "invite_links", ["group_id"])
    op.alter_column("invite_links", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.drop_column("invite_links", "expiration_option")
    op.drop_column("invite_links", "encrypted_token")
