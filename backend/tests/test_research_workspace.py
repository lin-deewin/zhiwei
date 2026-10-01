import asyncio

import pytest

from app.core.database import session
from app.services import knowledge, research_workspace as workspace
from app.services.library import import_markdown


def setup_project(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "lib"))
    article = import_markdown("a.md", "# 睡眠\n\n充分睡眠帮助保持专注。".encode())
    return article, workspace.create("专注力研究", "怎样提高专注力？", ["article:" + article["id"]])


def test_project_snapshot_history_and_restore(monkeypatch, tmp_path):
    article, project = setup_project(monkeypatch, tmp_path)
    seen = []

    async def model(question, sources, research=False):
        seen.append((question, sources))
        return "睡眠是重要因素 [S1]"

    monkeypatch.setattr(knowledge, "grounded_answer", model)
    turn = asyncio.run(workspace.ask(project["id"], "它有什么作用？", project["revision"]))[
        "project"
    ]
    with session() as db:
        db.execute("DELETE FROM contents WHERE id=?", (article["id"],))
    result = asyncio.run(workspace.ask(project["id"], "比较已有结论", turn["revision"], True))
    assert "历史对话（仅用于理解指代，不作为事实证据）" in seen[-1][0]
    assert result["project"]["evidence"] == project["evidence"]
    assert result["project"]["turns"][0]["sources"] == turn["turns"][0]["sources"]
    note = knowledge.research_note(result["note_id"])
    first = workspace.versions(note["id"])[-1]
    saved = knowledge.save_research(
        note["id"], body_md="我的推断需要核对 [S1]", revision=note["revision"]
    )
    assert "我的推断" in workspace.compare(note["id"], first["id"])["diff"]
    restored = workspace.restore(note["id"], first["id"], saved["revision"])
    assert restored["body_md"] == note["body_md"]
    assert restored["sources"] == note["sources"]
    assert len(workspace.versions(note["id"])) == 3
    with pytest.raises(ValueError):
        workspace.restore(note["id"], first["id"], saved["revision"])
    with pytest.raises(ValueError):
        knowledge.save_research(note["id"], body_md="错引 [S999]", revision=restored["revision"])


def test_project_rejects_scope_change_during_generation(monkeypatch, tmp_path):
    article, project = setup_project(monkeypatch, tmp_path)

    async def model(*args, **kwargs):
        workspace.update(project["id"], project["revision"], ["article:" + article["id"]])
        return "结论 [S1]"

    monkeypatch.setattr(knowledge, "grounded_answer", model)
    with pytest.raises(ValueError, match="生成期间"):
        asyncio.run(workspace.ask(project["id"], "请给出结论", project["revision"]))
    assert workspace.project(project["id"])["turns"] == []
    with pytest.raises(ValueError):
        workspace.update(project["id"], project["revision"], ["article:" + article["id"]])


def test_project_selects_relevant_late_passage(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "lib"))
    body = (
        "# 长文章\n\n"
        + "\n\n".join("无关内容。" * 20 for _ in range(10))
        + "\n\n持续研究需要版本历史与不可变证据快照。"
    )
    article = import_markdown("long.md", body.encode())
    project = workspace.create(
        "版本研究", "持续研究如何保留版本历史与证据快照？", ["article:" + article["id"]]
    )
    assert "不可变证据快照" in project["evidence"][0]["text"]
