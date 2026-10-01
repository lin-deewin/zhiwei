import asyncio

import pytest

from app.services import knowledge_graph as graph
from app.services.library import import_markdown
from app.services.reading_workspace import create_note


def test_wikilinks_backlinks_ambiguity_and_explicit_links(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "lib"))
    article = import_markdown("a.md", "# 主题\n\n文章内容。".encode())
    duplicate = import_markdown("b.md", "# 主题\n\n另一篇内容。".encode())
    topic = graph.save_topic(
        "研究主题", f"[[article:{article['id']}|原始文章]]\n\n[[主题]]\n\n[[不存在]]\n\n`[[忽略]]`"
    )
    data = graph.graph("topic:" + topic["id"])
    assert data["outgoing"][0]["source_id"] == "article:" + article["id"]
    assert {x["reason"] for x in data["unresolved"]} == {"ambiguous", "missing"}
    assert len(data["unresolved"]) == 2
    assert (
        graph.graph("article:" + article["id"])["incoming"][0]["source_id"]
        == "topic:" + topic["id"]
    )
    graph.link("article:" + duplicate["id"], "topic:" + topic["id"])
    assert any(x["relation"] == "explicit" for x in graph.graph("topic:" + topic["id"])["incoming"])
    with pytest.raises(RuntimeError):
        graph.save_topic("changed", "body", topic["id"], revision=999)


def test_topic_draft_preserves_provenance(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "lib"))
    a = import_markdown("a.md", "# 内容\n\n专注力需要充足睡眠。".encode())
    note = create_note(a["id"], {"title": "体验", "body_md": "我认为休息很重要。"})
    topic = graph.save_topic("专注力", "我的既有内容")

    async def model(*args, **kwargs):
        return "重要结论 [S1]"

    monkeypatch.setattr(graph, "grounded_answer", model)
    draft = asyncio.run(
        graph.topic_draft(topic["id"], ["article:" + a["id"], "note:" + note["id"]])
    )
    assert graph.topic(topic["id"])["body_md"] == "我的既有内容"
    saved = graph.save_topic(
        topic["title"], draft["body_md"], topic["id"], topic["revision"], draft["sources"]
    )
    assert saved["sources"][0]["content_hash"]
    assert graph.graph("note:" + note["id"])["incoming"][0]["source_id"] == "topic:" + topic["id"]
