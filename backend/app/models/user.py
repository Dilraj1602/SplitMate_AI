
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )

    username: Mapped[str] = mapped_column(
        String(30),
        unique=True,
        index=True,
        nullable=False,
    )

    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata", server_default="Asia/Kolkata")

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )

    hashed_password: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    is_email_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    auth_token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    username_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
