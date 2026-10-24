
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from backend.app.config import settings
from backend.app.db.session import engine
from backend.app.api.v1.router import router as api_v1_router

app = FastAPI(
    title="SplitMate AI API",
    description="Backend API for SplitMate AI expense sharing.",
    version="0.1.0",
)
app.include_router(api_v1_router, prefix="/api/v1")

if settings.effective_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.effective_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
    )


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "SplitMate AI API",
    }


@app.get("/ready", tags=["Health"])
def readiness_check() -> dict[str, str]:
    """Report readiness only when the configured PostgreSQL database responds."""
    if engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured.",
        )
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable.",
        ) from exc
    return {"status": "ready", "service": "SplitMate AI API"}
