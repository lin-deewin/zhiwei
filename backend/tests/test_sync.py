from __future__ import annotations

import asyncio
import json

import pytest

from app.core.database import session
from app.services import sync as sync_module
from app.services import zhihu_qr as qr_module
from app.services.library import _question_ref, get_content
from app.services.zhihu_browser import ZhihuAuthError


def test_qr_session_reads_authenticated_json(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(qr_module, "COOKIE_FILE", tmp_path / "session.json")
    account = qr_module.ZhihuQrLogin()

    class Response:
        status_code = 200

        def __init__(self):
            self.headers = {"content-type": "application/json"}

        def json(self):
            return {"data": []}

    class Session:
        def __init__(self):
            self.paths = []

        def get(self, url, **kwargs):
            self.paths.append((url, kwargs))
            return Response()

    fake_session = Session()
    account._session = fake_session
    account._status = "connected"
    assert asyncio.run(account.get_json("/api/v4/members/user/favlists?offset=0&limit=20")) == {
        "data": []
    }
    assert fake_session.paths[0][0].startswith("https://www.zhihu.com/api/v4/")
    assert fake_session.paths[0][1]["allow_redirects"] is False
    with pytest.raises(ValueError):
        asyncio.run(account.get_json("/api/v4/../account"))


def test_expired_qr_session_requires_login(monkeypatch, tmp_path) -> None:
    session_file = tmp_path / "session.json"
    session_file.write_text("{}")
    monkeypatch.setattr(qr_module, "COOKIE_FILE", session_file)
    account = qr_module.ZhihuQrLogin()

    class Session:
        closed = False

        def get(self, url, **kwargs):
            return type("Response", (), {"status_code": 401})()

        def close(self):
            self.closed = True

    fake_session = Session()
    account._session = fake_session
    account._status = "connected"
    with pytest.raises(ZhihuAuthError):
        asyncio.run(account.get_json("/api/v4/me"))
    assert account.status()["status"] == "not_connected"
    assert fake_session.closed
    assert not session_file.exists()


@pytest.mark.parametrize("mode", ["full", "incremental"])
def test_selected_folder_sync_uses_qr_session_and_saves_markdown(monkeypatch, tmp_path, mode) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))

    class Account:
        def __init__(self):
            self.paths = []

        def status(self):
            return {"status": "connected", "profile": {"url_token": "owner"}}

        async def get_json(self, path):
            self.paths.append(path)
            if "/favlists?" in path:
                return {"data": [{"id": 101, "title": "阅读"}, {"id": 202, "title": "稍后"}],
                        "paging": {"is_end": True}}
            if "/articles/123" in path:
                return {"type": "article", "id": 123, "title": "示例标题",
                        "author": {"name": "作者"}, "content": "<p>示例正文</p>",
                        "url": "https://zhuanlan.zhihu.com/p/123"}
            assert "/collections/101/items?" in path
            return {"data": [{"content": {
                "type": "article", "id": 123, "title": "示例标题",
            }}], "paging": {"is_end": True, "totals": 1}}

    account = Account()
    monkeypatch.setattr(sync_module, "active_account", lambda: account)

    async def run():
        manager = sync_module.SyncManager()
        job = await manager.start(mode, ["101"])
        assert manager._task is not None
        await manager._task
        return job["id"]

    job_id = asyncio.run(run())
    with session() as db:
        job = db.execute("SELECT * FROM sync_jobs WHERE id=?", (job_id,)).fetchone()
        saved = db.execute("SELECT id FROM contents").fetchall()
        memberships = db.execute("SELECT folder_id FROM folder_contents").fetchall()
    assert job["status"] == "completed"
    assert "新增文章和话题整理已完成" in job["message"]
    with session() as db:
        article_job = db.execute("SELECT * FROM classification_jobs").fetchone()
        topic_job = db.execute("SELECT * FROM question_classification_jobs").fetchone()
    assert article_job["status"] == "completed"
    assert topic_job["status"] == "completed"
    assert topic_job["created_at"] >= article_job["updated_at"]
    assert job["scanned"] == 1
    assert json.loads(job["folder_ids"]) == ["101"]
    assert [row["id"] for row in saved] == ["zhihu_article_123"]
    assert [row["folder_id"] for row in memberships] == ["101"]
    assert "示例正文" in (tmp_path / "library/articles/zhihu_article_123/article.md").read_text()
    detail = get_content("zhihu_article_123")
    assert detail is not None
    assert detail["folders"] == [{"id": "101", "name": "阅读",
                                   "url": "https://www.zhihu.com/collection/101"}]
    assert len(account.paths) == 3

def test_sync_requires_connected_account(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))

    class Account:
        def status(self):
            return {"status": "not_connected", "profile": None}

    monkeypatch.setattr(sync_module, "active_account", lambda: Account())

    async def run():
        with pytest.raises(ZhihuAuthError):
            await sync_module.SyncManager().start("full")

    asyncio.run(run())


def test_answer_question_link_uses_verified_question_id() -> None:
    content = {
        "kind": "answer", "remote_id": "2048356730241824466",
        "title": "假如LLM无限上下文了，RAG还有意义吗？",
        "url": "https://www.zhihu.com/question/653424464/answer/2048356730241824466",
    }
    expected = {"id": "653424464", "title": content["title"],
                "url": "https://www.zhihu.com/question/653424464"}
    assert _question_ref(content, {}) == expected
    assert _question_ref(content, {"question": {
        "id": "653424464", "title": "知乎返回的问题标题", "url": "https://example.com/untrusted",
    }}) == {**expected, "title": "知乎返回的问题标题"}
    assert _question_ref(content, {"question": {
        "id": "999", "title": "错误的问题标题",
    }}) == expected
    assert _question_ref({**content, "remote_id": "123"}, {}) is None
