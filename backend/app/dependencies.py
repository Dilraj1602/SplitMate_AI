from collections.abc import Generator

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db.session import SessionLocal, engine


def get_db() -> Generator[Session, None, None]:
    """Yield one request-scoped session and always release it afterward."""
    if engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured.",
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
