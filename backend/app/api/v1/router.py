from fastapi import APIRouter
from backend.app.api.v1.endpoints.auth import router as auth_router
from backend.app.api.v1.endpoints.product import router as product_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(product_router)


@router.get("/health", tags=["Health"])
def versioned_health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "SplitMate AI API", "api_version": "v1"}
