
from fastapi import FastAPI

app = FastAPI(
    title="SplitMate AI API",
    description="Backend API for SplitMate AI expense sharing.",
    version="0.1.0",
)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "SplitMate AI API",
    }
