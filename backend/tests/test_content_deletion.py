from __future__ import annotations

import asyncio
import shutil

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import router
from app.core.database import session
from app.services import sync as sync_module
from app.services import zhihu_content
from app.services.library import (
    delete_content,
    get_content,
    import_markdown,
    is_content_deleted,
    list_contents,
)


@pytest.fixture
def library(monkeypatch, tmp_path):
    root = tmp_path / "library"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(root))
    return root


def test_delete_removes_files_search_and_associations(library):
    item = import_markdown("test.md", "# 删除测试\n\n可检索的正文".encode())
    directory = library / "articles" / item["id"]
    (directory / "assets").mkdir()
    (directory / "assets" / "image.png").write_bytes(b"test")
    (directory / "article.remote.md").write_text("remote")
    with session() as db:
        db.execute("INSERT INTO folders(id,name) VALUES ('1','收藏夹')")
        db.execute("INSERT INTO folder_contents(folder_id,content_id,first_seen_at,last_seen_at) VALUES ('1',?,'now','now')", (item["id"],))
        db.execute("INSERT INTO questions(id,title,url,created_at,updated_at) VALUES ('1','问题','https://www.zhihu.com/question/1','now','now')")
        db.execute("INSERT INTO question_contents(question_id,content_id,link_source,created_at) VALUES ('1',?,'manual','now')", (item["id"],))
    assert delete_content(item["id"])
    assert not directory.exists()
    assert get_content(item["id"]) is None
    assert list_contents(q="可检索")["total"] == 0
    assert is_content_deleted(item["id"])
    with session() as db:
        for table in ("content_search", "folder_contents", "question_contents"):
            assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert delete_content(item["id"])  # Idempotent retry.


def test_delete_missing_file_and_api_not_found(library):
    item = import_markdown("test.md", b"# test")
    (library / item["markdown_path"]).unlink()
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.delete(f"/api/v1/contents/{item['id']}").status_code == 204
        assert client.get(f"/api/v1/contents/{item['id']}").status_code == 404
        assert client.delete("/api/v1/contents/unknown").status_code == 404


def test_delete_rejects_symlink_and_keeps_outside_file(library, tmp_path):
    item = import_markdown("test.md", b"# test")
    directory = library / "articles" / item["id"]
    shutil.rmtree(directory)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "article.md").write_text("keep")
    directory.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        delete_content(item["id"])
    assert (outside / "article.md").read_text() == "keep"
    assert not is_content_deleted(item["id"])
    with session() as db:
        db.execute("UPDATE contents SET markdown_path='../outside/article.md' WHERE id=?", (item["id"],))
    with pytest.raises(ValueError):
        delete_content(item["id"])


def test_delete_file_failure_does_not_report_success(library, monkeypatch):
    item = import_markdown("test.md", b"# test")
    def fail(*args):
        raise PermissionError("denied")
    monkeypatch.setattr(shutil, "rmtree", fail)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.delete(f"/api/v1/contents/{item['id']}").status_code == 500
    assert get_content(item["id"]) is not None
    assert not is_content_deleted(item["id"])


@pytest.mark.parametrize("mode", ["incremental", "full"])
def test_sync_skips_deleted_across_folders_before_fetching_body(library, monkeypatch, tmp_path, mode):
    remote_id = "zhihu_article_123"
    with session() as db:
        db.execute("INSERT INTO deleted_contents(content_id,deleted_at) VALUES (?,'now')", (remote_id,))
    class Account:
        def __init__(self):
            self.paths = []
        def status(self):
            return {"status": "connected", "profile": {"url_token": "reader"}}
        async def get_json(self, path):
            self.paths.append(path)
            if "/favlists?" in path:
                return {"data": [{"id": 1, "title": "甲"}, {"id": 2, "title": "乙"}], "paging": {"is_end": True}}
            assert "/items?" in path  # Deleted article must not request detail.
            return {"data": [{"content": {"type": "article", "id": 123}}], "paging": {"is_end": True, "totals": 1}}
    account = Account()
    monkeypatch.setattr(sync_module, "active_account", lambda: account)
    async def run():
        manager = sync_module.SyncManager()
        job = await manager.start(mode)
        await manager._task
        return job["id"]
    job_id = asyncio.run(run())
    assert len(account.paths) == 3
    assert not (library / "articles" / remote_id).exists()
    with session() as db:
        job = db.execute("SELECT * FROM sync_jobs WHERE id=?", (job_id,)).fetchone()
        assert job["status"] == "completed"
        assert job["scanned"] == 2
        assert job["downloaded"] == 0
        assert "已删除 2 条" in job["message"]
    assert list_contents()["total"] == 0
    # Deletion preference belongs to this library, not a different data directory.
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "other-library"))
    assert not is_content_deleted(remote_id)


def test_delete_during_conversion_cannot_recreate_article(library, monkeypatch):
    raw = {"content": {"type": "article", "id": 123, "title": "同步测试", "content": "<p>正文</p>"}}
    with session() as db:
        db.execute("INSERT INTO folders(id,name) VALUES ('1','收藏夹')")
    async def run():
        async with httpx.AsyncClient() as client:
            assert await zhihu_content.save_favorite(raw, "1", "now", client) == "new"
            original = zhihu_content._convert
            async def convert_then_delete(*args):
                converted = await original(*args)
                assert delete_content("zhihu_article_123")
                return converted
            monkeypatch.setattr(zhihu_content, "_convert", convert_then_delete)
            changed = {"content": {**raw["content"], "content": "<p>更新正文</p>"}}
            assert await zhihu_content.save_favorite(changed, "1", "now", client) == "deleted"
            assert await zhihu_content.save_favorite(raw, "1", "now", client) == "deleted"
    asyncio.run(run())
    assert not (library / "articles" / "zhihu_article_123").exists()
    assert get_content("zhihu_article_123") is None
