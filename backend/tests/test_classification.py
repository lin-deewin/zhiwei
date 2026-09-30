from __future__ import annotations

import asyncio

from app.core.database import session
from app.services.classification import _score, classification_manager, ensure_default_categories
from app.services.library import (
    get_content,
    import_markdown,
    list_contents,
    set_classification,
    set_rules_classification,
)


def test_rules_classification_seeds_defaults_and_leaves_ambiguous_pending(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    import_markdown("code.md", "# Python 工程\n\n编程代码、软件开发和 API。".encode())
    import_markdown("unclear.md", "# 一段随笔\n\n今天记录一些想法。".encode())

    async def run() -> None:
        job = await classification_manager.start()
        await classification_manager._task
        assert job["total"] == 2

    asyncio.run(run())
    with session() as db:
        rows = db.execute("SELECT title,category_id,classification_source FROM contents ORDER BY title").fetchall()
        assert db.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 40
    by_title = {row["title"]: row for row in rows}
    assert by_title["Python 工程"]["category_id"] is not None
    assert by_title["Python 工程"]["classification_source"] == "rules"
    assert by_title["一段随笔"]["category_id"] is None
    assert by_title["一段随笔"]["classification_source"] == "none"
    assert [item["title"] for item in list_contents(pending_only=True)["items"]] == ["一段随笔"]


def test_manual_lock_survives_reclassification(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    item = import_markdown("locked.md", "# 编程\n\n代码 API。".encode())
    with session() as db:
        db.execute("INSERT INTO categories(name,created_at) VALUES('自定义', 'now')")
        parent = db.execute("SELECT id FROM categories WHERE name='自定义'").fetchone()[0]
        db.execute("INSERT INTO categories(parent_id,name,created_at) VALUES(?,?,?)", (parent, "手动", "now"))
        child = db.execute("SELECT id FROM categories WHERE parent_id=?", (parent,)).fetchone()[0]
    set_classification(item["id"], child)

    async def run() -> None:
        job = await classification_manager.start()
        await classification_manager._task
        assert job["total"] == 0

    asyncio.run(run())
    with session() as db:
        row = db.execute("SELECT category_id,classification_locked FROM contents WHERE id=?", (item["id"],)).fetchone()
    assert row["category_id"] == child
    assert row["classification_locked"] == 1


def test_one_common_title_word_is_not_enough_and_hash_is_checked(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    ensure_default_categories()
    assert _score("# 文章\n\n一些普通内容。", "人工智能") == (None, "没有找到足够的主题证据")
    item = import_markdown("hash.md", "# 编程\n\n代码 API。".encode())
    with session() as db:
        child = db.execute("SELECT id FROM categories WHERE name='软件开发'").fetchone()[0]
    try:
        set_rules_classification(item["id"], child, "测试", "wrong-hash")
    except ValueError as error:
        assert "哈希" in str(error)
    else:
        raise AssertionError("分类必须拒绝过期正文哈希")

    metadata = (tmp_path / "library" / "articles" / item["id"] / "metadata.json")
    metadata.unlink()
    with session() as db:
        before = dict(db.execute("SELECT category_id,classification_source FROM contents WHERE id=?", (item["id"],)).fetchone())
    try:
        set_rules_classification(item["id"], child, "测试", item["content_hash"])
    except OSError:
        pass
    else:
        raise AssertionError("元数据缺失时不应留下半套分类结果")
    with session() as db:
        after = dict(db.execute("SELECT category_id,classification_source FROM contents WHERE id=?", (item["id"],)).fetchone())
    assert after == before


def test_failed_item_can_be_retried_and_counts_are_recomputed(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    item = import_markdown("retry.md", "# 编程\n\n代码 API。".encode())
    markdown = tmp_path / "library" / item["markdown_path"]
    markdown.unlink()

    async def run_first() -> dict:
        job = await classification_manager.start()
        await classification_manager._task
        return classification_manager._row(job["id"])

    failed = asyncio.run(run_first())
    assert failed["failed"] == 1
    markdown.write_text("# 编程\n\n代码 API。", encoding="utf-8")

    async def run_retry() -> dict:
        job = await classification_manager.start(retry_id=failed["id"])
        await classification_manager._task
        return classification_manager._row(job["id"])

    retried = asyncio.run(run_retry())
    assert retried["processed"] == 1
    assert retried["classified"] == 1
    assert retried["failed"] == 0
    assert retried["classified"] + retried["pending"] + retried["skipped"] + retried["failed"] == retried["processed"]


def test_classification_cancel_stops_at_item_boundary(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    for index in range(12):
        import_markdown(f"cancel-{index}.md", f"# 编程 {index}\n\n代码 API。".encode())

    async def run() -> dict:
        job = await classification_manager.start()
        classification_manager.cancel(job["id"])
        await classification_manager._task
        return classification_manager._row(job["id"])

    result = asyncio.run(run())
    assert result["status"] == "cancelled"
    assert result["processed"] < result["total"]


def test_custom_leaf_needs_independent_title_and_body_evidence(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    with session() as db:
        parent = db.execute("INSERT INTO categories(name,created_at) VALUES('自定义主题','now')").lastrowid
        db.execute("INSERT INTO categories(parent_id,name,created_at) VALUES(?,?, 'now')", (parent, "量子计算"))
    item = import_markdown("custom.md", "# 量子计算\n\n本文再次讨论量子计算的基本概念。".encode())
    title_only = import_markdown("title-only.md", "# 量子计算\n\n只有普通正文。".encode())

    async def run() -> None:
        job = await classification_manager.start()
        await classification_manager._task
        assert job["total"] == 2

    asyncio.run(run())
    with session() as db:
        row = db.execute("SELECT category_id,classification_source FROM contents WHERE id=?", (item["id"],)).fetchone()
        title_row = db.execute("SELECT category_id FROM contents WHERE id=?", (title_only["id"],)).fetchone()
    assert row["category_id"] is not None
    assert row["classification_source"] == "rules"
    assert title_row["category_id"] is None


def test_new_job_only_processes_articles_not_seen_in_prior_jobs(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    classified = import_markdown("classified.md", "# 编程\n\n代码 API。".encode())
    pending = import_markdown("pending.md", "# 随笔\n\n没有明确主题。".encode())

    async def run_job() -> dict:
        job = await classification_manager.start()
        await classification_manager._task
        return classification_manager._row(job["id"])

    first = asyncio.run(run_job())
    assert first["total"] == 2
    assert first["classified"] == 1
    assert first["pending"] == 1

    with session() as db:
        db.execute("UPDATE contents SET content_hash='changed' WHERE id=?", (classified["id"],))
    second = asyncio.run(run_job())
    assert second["total"] == 0

    added = import_markdown("added.md", "# Python 新文章\n\n编程代码和 API。".encode())
    third = asyncio.run(run_job())
    assert third["total"] == 1
    with session() as db:
        ids = [row["content_id"] for row in db.execute(
            "SELECT content_id FROM classification_job_items WHERE job_id=?", (third["id"],)
        )]
    assert ids == [added["id"]]
    assert pending["id"] not in ids


def test_old_article_does_not_become_new_after_manual_category_is_cleared(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    ensure_default_categories()
    old = import_markdown("old.md", "# 编程\n\n代码 API。".encode())
    with session() as db:
        child = db.execute("SELECT id FROM categories WHERE name='软件开发'").fetchone()[0]
    set_classification(old["id"], child)

    async def run_job() -> dict:
        job = await classification_manager.start()
        await classification_manager._task
        return classification_manager._row(job["id"])

    assert asyncio.run(run_job())["total"] == 0
    set_classification(old["id"], None)
    assert asyncio.run(run_job())["total"] == 0
    import_markdown("new.md", "# 编程\n\n代码 API。".encode())
    assert asyncio.run(run_job())["total"] == 1


def test_medical_article_shows_health_category_path(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    title = "孩子腺样体肥大怎么办？分享我家娃的经历，希望爸爸妈妈们不再走弯路"
    item = import_markdown("medical.md", f"# {title}\n\n疾病影响健康和睡眠，去医院治疗。".encode())

    async def run_job() -> None:
        job = await classification_manager.start()
        await classification_manager._task
        assert classification_manager._row(job["id"])["classified"] == 1

    asyncio.run(run_job())
    detail = get_content(item["id"])
    assert detail is not None
    assert (detail["category_parent_name"], detail["category_name"]) == ("科学与健康", "医学健康")
    with session() as db:
        tech_id = db.execute("SELECT id FROM categories WHERE name='技术与互联网'").fetchone()[0]
    assert list_contents(category_id=tech_id)["total"] == 0


def test_math_book_answer_uses_body_evidence_and_adds_category_once(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    ensure_default_categories()
    with session() as db:
        math_id = db.execute("SELECT id FROM categories WHERE name='数学与理工'").fetchone()[0]
        db.execute("DELETE FROM categories WHERE id=?", (math_id,))
        db.execute("UPDATE schema_version SET version=1")
    ensure_default_categories()
    ensure_default_categories()
    with session() as db:
        assert db.execute("SELECT COUNT(*) FROM categories WHERE name='数学与理工'").fetchone()[0] == 1
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 3
    category_id, reason = _score(
        "# 你读过哪些令你有跪感的书？\n\n这本线性代数教材用图解讲清楚矩阵。",
        "你读过哪些令你有跪感的书？",
    )
    assert category_id is not None
    with session() as db:
        row = db.execute("SELECT c.name,p.name AS parent FROM categories c JOIN categories p ON p.id=c.parent_id WHERE c.id=?", (category_id,)).fetchone()
    assert (row["parent"], row["name"]) == ("科学与健康", "数学与理工")
    assert "线性代数" in reason
    assert _score("# 你读过哪些令你有跪感的书？\n\n值得一读。", "你读过哪些令你有跪感的书？")[0] is None


def test_specific_title_signal_beats_incidental_body_terms(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    ensure_default_categories()
    with session() as db:
        software_id = db.execute("SELECT id FROM categories WHERE name='软件开发'").fetchone()[0]
        math_id = db.execute("SELECT id FROM categories WHERE name='数学与理工'").fetchone()[0]
    title = "Gentoo Linux 安装教程"
    assert _score("# Gentoo Linux 安装教程\n\n先检查电脑显卡、处理器和硬盘。", title)[0] == software_id
    assert _score("# 指纹浏览器怎么用？TikTok矩阵号防关联教程\n\n矩阵号需要保持账号隔离。",
                  "指纹浏览器怎么用？TikTok矩阵号防关联教程")[0] != math_id
    ai_title = "如何评价 DeepSeek-V4 Pro？"
    with session() as db:
        ai_id = db.execute("SELECT id FROM categories WHERE name='人工智能'").fetchone()[0]
    assert _score(f"# {ai_title}\n\n这是一次新产品发布。", ai_title)[0] == ai_id
