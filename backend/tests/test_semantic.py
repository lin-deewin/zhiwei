import asyncio
import json

from app.core.database import session
from app.services import semantic
from app.services.library import import_markdown


def test_hybrid_finds_paraphrase_and_excludes_deleted(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    a = import_markdown("a.md", "# 实验\n\n厚衣服可以保暖。".encode())
    b = import_markdown("b.md", "# 实验二\n\n数据库查询索引。".encode())
    chunks = semantic._corpus(semantic._records(None, None))[0]
    with session() as db:
        db.execute(
            "INSERT INTO semantic_jobs VALUES ('job',?,'completed',0,0,'','now','now')",
            (semantic.DEFAULT_MODEL,),
        )
        for chunk in chunks:
            vector = [1, 0] if chunk["content_id"] == a["id"] else [0, 1]
            db.execute(
                "INSERT INTO semantic_vectors VALUES (?,?,?,?)",
                (semantic.DEFAULT_MODEL, chunk["chunk_id"], chunk["source_id"], json.dumps(vector)),
            )
    monkeypatch.setattr(semantic, "_embed", lambda *args, **kw: [[1, 0]])
    hits = semantic.hybrid_retrieve("低温环境怎样避免身体失去热量？")
    assert hits[0]["content_id"] == a["id"]
    assert "semantic" in hits[0]["match_methods"]
    with session() as db:
        db.execute("DELETE FROM contents WHERE id=?", (a["id"],))
    assert all(
        s["content_id"] != a["id"]
        for s in semantic.hybrid_retrieve("低温环境怎样避免身体失去热量？")
    )


def test_incremental_index_and_evaluation(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    item = import_markdown("a.md", "# 测试\n\n厚衣服可以保暖。".encode())
    calls = []
    monkeypatch.setattr(semantic, "_model", lambda *args, **kw: None)

    def embed(texts, *args, **kw):
        calls.append(len(texts))
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(semantic, "_embed", embed)

    async def run():
        manager = semantic.SemanticManager()
        await manager.start()
        await asyncio.gather(*manager.tasks.values())
        before = len(calls)
        await manager.start()
        await asyncio.gather(*manager.tasks.values())
        assert len(calls) == before
        with session() as db:
            db.execute(
                "INSERT INTO retrieval_cases VALUES (?,?,?,?)",
                (
                    "case",
                    "低温环境怎样避免身体失去热量？",
                    json.dumps(["article:" + item["id"]]),
                    "now",
                ),
            )
        result = await semantic.evaluate()
        assert result["summary"]["hybrid"]["recall_at_k"] == 1
        assert result["summary"]["keyword"]["recall_at_k"] == 0

    asyncio.run(run())
