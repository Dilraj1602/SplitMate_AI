from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["Health"])
def versioned_health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "SplitMate AI API", "api_version": "v1"}
