from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.personal_note_routes import router
from app.services import knowledge_graph, personal_notes
from app.services.library import delete_content, get_content, import_markdown


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, base_url="http://127.0.0.1")


def test_personal_note_crud_sources_and_optimistic_revision(client):
    article = import_markdown("article.md", "# 来源文章\n\n原文内容".encode())
    source_id = "article:" + article["id"]
    created = client.post(
        "/api/v1/personal-notes",
        json={"title": "我的理解", "body_md": "这是一条独立笔记。", "source_ids": [source_id]},
    )
    assert created.status_code == 201
    note = created.json()
    assert note["sources"][0]["source_id"] == source_id
    assert note["sources"][0]["title_snapshot"] == "来源文章"

    listed = client.get("/api/v1/personal-notes", params={"q": "独立笔记"}).json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == note["id"]

    updated = client.patch(
        f"/api/v1/personal-notes/{note['id']}",
        json={
            "title": "更新后的理解",
            "body_md": "加入新的推理。",
            "revision": note["revision"],
            "source_ids": [source_id],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == note["revision"] + 1
    metadata_only = client.patch(
        f"/api/v1/personal-notes/{note['id']}",
        json={"title": "仅更新标题", "body_md": "保留原有引用。", "revision": updated.json()["revision"]},
    )
    assert metadata_only.status_code == 200
    assert metadata_only.json()["sources"][0]["source_id"] == source_id

    stale = client.patch(
        f"/api/v1/personal-notes/{note['id']}",
        json={"title": "过期写入", "body_md": "", "revision": note["revision"]},
    )
    assert stale.status_code == 409

    deleted = client.delete(
        f"/api/v1/personal-notes/{note['id']}",
        params={"revision": metadata_only.json()["revision"]},
    )
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/personal-notes/{note['id']}").status_code == 404
    assert get_content(article["id"]) is not None


def test_personal_note_sources_survive_source_article_deletion(client):
    article = import_markdown("source.md", "# 来源\n\n原文".encode())
    note = personal_notes.create_personal_note({
        "title": "长期笔记",
        "body_md": "来源可能会消失，但我的理解应保留。",
        "source_ids": ["article:" + article["id"]],
    })
    assert delete_content(article["id"])
    retained = personal_notes.get_personal_note(note["id"])
    assert retained["title"] == "长期笔记"
    assert retained["sources"][0]["title_snapshot"] == "来源"
    assert retained["sources"][0]["source_id"] == "article:" + article["id"]
    assert retained["sources"][0]["available"] is False


def test_only_personal_knowledge_sources_can_create_links(client):
    article = import_markdown("article.md", "# 原文\n\n[[另一个标题]]".encode())
    target = import_markdown("target.md", "# 另一个标题\n\n正文".encode())
    note = personal_notes.create_personal_note({
        "title": "个人想法",
        "body_md": "我的观点 [[article:" + target["id"] + "|引用来源]]",
        "source_ids": [],
    })
    note_id = "personal_note:" + note["id"]
    article_graph = knowledge_graph.graph("article:" + article["id"])
    assert article_graph["outgoing"] == []
    note_graph = knowledge_graph.graph(note_id)
    assert any(x["source_id"] == "article:" + target["id"] for x in note_graph["outgoing"])

    with pytest.raises(ValueError):
        knowledge_graph.link("article:" + article["id"], note_id)
    knowledge_graph.link(note_id, "article:" + article["id"])
    assert any(x["relation"] == "explicit" for x in knowledge_graph.graph(note_id)["outgoing"])


def test_invalid_personal_note_source_is_rejected(client):
    response = client.post(
        "/api/v1/personal-notes",
        json={"title": "test", "body_md": "", "source_ids": ["article:missing"]},
    )
    assert response.status_code == 400



def test_personal_note_versions_capture_each_saved_revision(client):
    note = personal_notes.create_personal_note({
        "title": "第一版",
        "body_md": "最初的理解。",
        "source_ids": [],
    })
    updated = personal_notes.update_personal_note(note["id"], {
        "title": "第二版",
        "body_md": "修订后的理解。",
        "revision": note["revision"],
    })
    versions = personal_notes.list_personal_note_versions(note["id"])
    assert [item["revision"] for item in versions] == [2, 1]
    assert versions[0]["title"] == "第二版"
    assert versions[1]["title"] == "第一版"

    original = personal_notes.get_personal_note_version(note["id"], 1)
    latest = personal_notes.get_personal_note_version(note["id"], updated["revision"])
    assert original["body_md"] == "最初的理解。"
    assert latest["body_md"] == "修订后的理解。"
    assert original["sources"] == []


def test_personal_note_version_http_contract(client):
    note = client.post(
        "/api/v1/personal-notes",
        json={"title": "版本接口", "body_md": "v1"},
    ).json()
    updated = client.patch(
        f"/api/v1/personal-notes/{note['id']}",
        json={"title": "版本接口", "body_md": "v2", "revision": note["revision"]},
    ).json()

    versions = client.get(f"/api/v1/personal-notes/{note['id']}/versions")
    assert versions.status_code == 200
    assert [item["revision"] for item in versions.json()] == [2, 1]
    detail = client.get(f"/api/v1/personal-notes/{note['id']}/versions/1")
    assert detail.status_code == 200
    assert detail.json()["body_md"] == "v1"
