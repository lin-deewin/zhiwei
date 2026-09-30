from __future__ import annotations

import json

import pytest

from app.core.database import session
from app.services.library import import_markdown
from app.services.questions import (
    attach_article, backfill, classify_question, detach_article, get_question,
    list_questions, link_saved_answer,
)


def _answer(tmp_path, remote_id: str, url: str, metadata: dict) -> str:
    content_id = f"zhihu_answer_{remote_id}"
    directory = tmp_path / "library" / "articles" / content_id
    directory.mkdir(parents=True)
    (directory / "article.md").write_text("回答正文")
    (directory / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False))
    with session() as db:
        db.execute("""INSERT INTO contents(id,kind,remote_id,title,url,markdown_path,created_at,updated_at)
            VALUES (?,'answer',?,?,?,?,'now','now')""", (content_id, remote_id, "问题标题", url,
            f"articles/{content_id}/article.md"))
    return content_id


def test_backfill_deduplicates_and_rejects_conflicting_title(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    url = "https://www.zhihu.com/question/653424464/answer/111"
    first = _answer(tmp_path, "111", url, {"question": {"id": "999", "title": "错误标题"}})
    _answer(tmp_path, "222", "https://www.zhihu.com/question/653424464/answer/222", {})
    assert backfill()["questions"] == 1
    assert backfill()["relations"] == 2
    question = get_question("653424464")
    assert question and question["title"] == "问题标题"
    assert {content["id"] for content in question["contents"]} == {first, "zhihu_answer_222"}
    assert question["url"] == "https://www.zhihu.com/question/653424464"


def test_manual_article_and_classification_lock(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    article = import_markdown("article.md", b"# Article\nBody")
    _answer(tmp_path, "111", "https://www.zhihu.com/question/123/answer/111", {})
    backfill()
    with session() as db:
        parent = db.execute("INSERT INTO categories(name,created_at) VALUES('Parent','now')").lastrowid
        leaf = db.execute("INSERT INTO categories(name,parent_id,created_at) VALUES('Leaf',?,'now')", (parent,)).lastrowid
    classify_question("123", leaf)
    attach_article("123", article["id"])
    assert get_question("123")["classification_locked"] == 1
    assert get_question("123")["category_id"] == leaf
    assert get_question("123")["contents"][0]["link_source"] == "manual"
    backfill()
    assert get_question("123")["category_id"] == leaf
    assert list_questions()["total"] == 1
    detach_article("123", article["id"])
    assert len(get_question("123")["contents"]) == 1
    with pytest.raises(ValueError):
        attach_article("123", "missing")


def test_question_job_validates_model_category_and_preserves_manual_lock(monkeypatch, tmp_path):
    import asyncio
    from app.services import questions as module

    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    _answer(tmp_path, "111", "https://www.zhihu.com/question/123/answer/111", {})
    _answer(tmp_path, "222", "https://www.zhihu.com/question/456/answer/222", {})
    backfill()
    with session() as db:
        parent = db.execute("INSERT INTO categories(name,created_at) VALUES('Parent','now')").lastrowid
        leaf = db.execute("INSERT INTO categories(name,parent_id,created_at) VALUES('Leaf',?,'now')", (parent,)).lastrowid
    classify_question("123", leaf)

    async def invalid_answer(*args, **kwargs):
        return '{"category_id":99999,"reason":"wrong","confident":true}'

    monkeypatch.setattr(module, "chat_completion", invalid_answer)

    async def run():
        manager = module.QuestionClassificationManager()
        job = await manager.start()
        await manager.task
        return manager.row(job["id"])

    result = asyncio.run(run())
    assert result["total"] == 1
    assert result["pending"] == 1
    assert get_question("456")["category_id"] is None
    assert get_question("123")["category_id"] == leaf
    assert get_question("123")["classification_locked"] == 1


def test_question_job_reports_non_json_model_reply(monkeypatch, tmp_path):
    import asyncio
    from app.services import questions as module

    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    _answer(tmp_path, "111", "https://www.zhihu.com/question/123/answer/111", {})
    backfill()

    async def plain_reply(*args, **kwargs):
        return "抱歉，暂时无法判断。"

    monkeypatch.setattr(module, "chat_completion", plain_reply)

    async def run():
        manager = module.QuestionClassificationManager()
        job = await manager.start()
        await manager.task
        return manager.row(job["id"])

    result = asyncio.run(run())
    assert result["failed"] == 1
    assert result["items"][0]["reason"] == "模型回复未包含 JSON 对象"
    assert get_question("123")["category_id"] is None
