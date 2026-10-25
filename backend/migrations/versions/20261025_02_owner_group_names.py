"""Enforce case-insensitive group names per owner and unique pending invites.

Revision ID: 20261025_02
Revises: eff0170fdee4
"""
from alembic import op
import sqlalchemy as sa

revision = "20261025_02"
down_revision = "eff0170fdee4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    live = "status = 'pending' AND expires_at > CURRENT_TIMESTAMP"
    duplicate = bind.execute(sa.text(
        f"SELECT 1 FROM invitations WHERE {live} AND invitee_user_id IS NOT NULL "
        "GROUP BY group_id, invitee_user_id HAVING count(*) > 1 LIMIT 1"
    )).first()
    if duplicate:
        raise RuntimeError("Cannot enforce unique pending invitations: duplicate invitations already exist.")
    for column, label in (("invitee_email", "email"), ("invitee_username", "username")):
        duplicate = bind.execute(sa.text(
            f"SELECT 1 FROM invitations WHERE {live} AND {column} IS NOT NULL "
            f"GROUP BY group_id, lower({column}) HAVING count(*) > 1 LIMIT 1"
        )).first()
        if duplicate:
            raise RuntimeError(f"Cannot enforce unique pending invitations: duplicate {label} invitations already exist.")

    # Keep expired records for audit, but release their pending invitation slot.
    op.execute("UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP")
    op.add_column("groups", sa.Column("normalized_name", sa.String(length=100), nullable=True))
    # Preserve duplicate legacy names with NULL normalized keys. The API still
    # checks those names, while the constraint protects all new and edited rows.
    op.execute(sa.text(
        "UPDATE groups AS target SET normalized_name = lower(trim(target.name)) "
        "WHERE (SELECT count(*) FROM groups AS other "
        "WHERE other.created_by_user_id = target.created_by_user_id "
        "AND lower(trim(other.name)) = lower(trim(target.name))) = 1"
    ))
    op.create_index(
        "uq_groups_owner_normalized_name", "groups", ["created_by_user_id", "normalized_name"], unique=True,
    )
    op.create_index(
        "uq_pending_invitation_group_user", "invitations", ["group_id", "invitee_user_id"], unique=True,
        sqlite_where=sa.text("status = 'pending' AND invitee_user_id IS NOT NULL"),
        postgresql_where=sa.text("status = 'pending' AND invitee_user_id IS NOT NULL"),
    )
    for column, label in (("invitee_email", "email"), ("invitee_username", "username")):
        op.create_index(
            f"uq_pending_invitation_group_{label}", "invitations",
            ["group_id", sa.text(f"lower({column})")], unique=True,
            sqlite_where=sa.text(f"status = 'pending' AND {column} IS NOT NULL"),
            postgresql_where=sa.text(f"status = 'pending' AND {column} IS NOT NULL"),
        )


def downgrade() -> None:
    op.drop_index("uq_pending_invitation_group_username", table_name="invitations")
    op.drop_index("uq_pending_invitation_group_email", table_name="invitations")
    op.drop_index("uq_pending_invitation_group_user", table_name="invitations")
    op.drop_index("uq_groups_owner_normalized_name", table_name="groups")
    op.drop_column("groups", "normalized_name")
