from fastapi.testclient import TestClient

from app.main import app


def test_missing_api_returns_json_instead_of_spa_html():
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/api/v1/endpoint-that-does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert "detail" in response.json()


def test_known_api_is_not_shadowed_by_fallback():
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
