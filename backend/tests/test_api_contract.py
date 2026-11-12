from __future__ import annotations

from app.main import app


def test_v1_api_compatibility_paths_and_methods():
    schema = app.openapi()
    paths = schema["paths"]
    required = {
        "/api/v1/health": {"get"},
        "/api/v1/ask": {"post"},
        "/api/v1/sync-jobs": {"get", "post"},
        "/api/v1/contents/{content_id}/reading-progress": {"get", "patch"},
        "/api/v1/personal-notes": {"get", "post"},
        "/api/v1/knowledge/projects/{project_id}/jobs": {"get", "post"},
        "/api/v1/knowledge/projects/{project_id}/jobs/{job_id}/cancel": {"post"},
        "/api/v1/knowledge/projects/{project_id}/jobs/{job_id}/retry": {"post"},
    }
    for path, methods in required.items():
        assert path in paths, f"compatibility route removed: {path}"
        assert methods <= set(paths[path]), f"compatibility methods changed for {path}"


def test_v1_api_openapi_contains_domain_request_dtos():
    schemas = app.openapi()["components"]["schemas"]
    for name in (
        "AskInput",
        "ReadingProgressInput",
        "PersonalNoteCreate",
        "PersonalNotePatch",
        "CreateProject",
        "ResearchJobInput",
    ):
        assert name in schemas, f"request DTO missing from OpenAPI: {name}"
