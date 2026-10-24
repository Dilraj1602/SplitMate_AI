from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health_reports_api_status() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "service": "SplitMate AI API",
    }


def test_openapi_schema_is_available() -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "SplitMate AI API"
