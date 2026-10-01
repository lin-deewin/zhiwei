from __future__ import annotations

import difflib
import json
import re
import uuid

from app.core.config import get_library_dir
from app.core.database import session
from app.services import knowledge
from app.services.knowledge_graph import nodes
from app.services.library import now
from app.services.semantic import selected_passages


def evidence(question: str, source_ids: list[str]) -> list[dict]:
    records = {r["source_id"]: r for r in nodes()}
    if any(key not in records for key in source_ids):
        raise ValueError("资料不存在，请重新选择")
    chunks = selected_passages(question, [records[key] for key in dict.fromkeys(source_ids)])
    if not chunks:
        raise ValueError("请选择有正文的资料")
    return knowledge.numbered(knowledge.budget_sources(question, chunks, budget=16000))


def project(project_id: str) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM research_projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise LookupError("研究项目不存在")
        result = dict(row)
        result["evidence"] = json.loads(result.pop("evidence_json"))
        result["turns"] = [
            {**dict(r), "sources": json.loads(r["sources_json"])}
            for r in db.execute(
                "SELECT id,question,answer,sources_json,created_at FROM research_turns WHERE project_id=? ORDER BY created_at,id",
                (project_id,),
            )
        ]
        for turn in result["turns"]:
            turn.pop("sources_json")
        result["notes"] = [
            dict(r)
            for r in db.execute(
                "SELECT n.id,n.title,n.status FROM research_notes n JOIN project_notes p ON p.note_id=n.id WHERE p.project_id=? ORDER BY n.updated_at DESC",
                (project_id,),
            )
        ]
    return result


def list_projects() -> list[dict]:
    with session() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT id,title,question,revision,updated_at FROM research_projects ORDER BY updated_at DESC"
            )
        ]


def create(title: str, question: str, source_ids: list[str]) -> dict:
    if not title.strip() or not question.strip():
        raise ValueError("项目名称和研究问题不能为空")
    snapshots = evidence(question, source_ids)
    project_id, timestamp = uuid.uuid4().hex, now()
    with session() as db:
        db.execute(
            "INSERT INTO research_projects(id,title,question,evidence_json,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            (
                project_id,
                title.strip(),
                question.strip(),
                json.dumps(snapshots, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
    return project(project_id)


def update(project_id: str, revision: int, source_ids: list[str], refresh: bool = False) -> dict:
    prior = project(project_id)
    if not source_ids:
        raise ValueError("证据集不能为空")
    existing = {s["source_id"] for s in prior["evidence"]}
    added = (
        list(dict.fromkeys(source_ids))
        if refresh
        else [s for s in dict.fromkeys(source_ids) if s not in existing]
    )
    snapshots = evidence(prior["question"], added) if added else []
    retained = [] if refresh else [s for s in prior["evidence"] if s["source_id"] in source_ids]
    snapshots = knowledge.numbered(retained + snapshots)
    with session() as db:
        changed = db.execute(
            "UPDATE research_projects SET evidence_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
            (json.dumps(snapshots, ensure_ascii=False), now(), project_id, revision),
        ).rowcount
        if not changed:
            raise ValueError("研究项目已修改，请刷新后再操作")
    return project(project_id)


async def ask(project_id: str, question: str, revision: int, research: bool = False) -> dict:
    library = get_library_dir().resolve()
    prior = project(project_id)
    if revision != prior["revision"]:
        raise ValueError("研究项目已修改，请刷新后再操作")
    context = "\n".join(
        "用户：" + t["question"][:700] + "\n助手：" + t["answer"][:1000]
        for t in prior["turns"][-4:]
    )
    prompt = (
        "研究主问题："
        + prior["question"]
        + "\n历史对话（仅用于理解指代，不作为事实证据）：\n"
        + context
        + "\n本轮问题："
        + question
    )
    sources = knowledge.numbered(knowledge.budget_sources(question, prior["evidence"]))
    body = await knowledge.grounded_answer(prompt, sources, research=research)
    if get_library_dir().resolve() != library:
        raise ValueError("资料库已切换，请在当前库重新操作")
    with session(library) as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute(
            "SELECT revision FROM research_projects WHERE id=?", (project_id,)
        ).fetchone()
        if not current or current["revision"] != revision:
            raise ValueError("生成期间证据集或对话已修改，本次结果未保存，请重试")
        timestamp, item_id = now(), uuid.uuid4().hex
        serialized = json.dumps(sources, ensure_ascii=False)
        if research:
            db.execute(
                "INSERT INTO research_notes(id,title,question,body_md,sources_json,status,created_at,updated_at) VALUES (?,?,?,?,?,'draft',?,?)",
                (item_id, question[:200], question, body, serialized, timestamp, timestamp),
            )
            db.execute("INSERT INTO project_notes VALUES (?,?)", (project_id, item_id))
            knowledge.snapshot_version(
                db,
                {"id": item_id, "title": question[:200], "body_md": body, "sources": sources},
                "项目生成",
            )
        else:
            db.execute(
                "INSERT INTO research_turns VALUES (?,?,?,?,?,?)",
                (item_id, project_id, question, body, serialized, timestamp),
            )
        db.execute(
            "UPDATE research_projects SET revision=revision+1,updated_at=? WHERE id=?",
            (timestamp, project_id),
        )
    return {"project": project(project_id), "note_id": item_id if research else None}


def versions(note_id: str) -> list[dict]:
    knowledge.research_note(note_id)
    with session() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT id,title,reason,created_at FROM research_versions WHERE note_id=? ORDER BY created_at DESC,rowid DESC",
                (note_id,),
            )
        ]


def version(note_id: str, version_id: str) -> dict:
    with session() as db:
        row = db.execute(
            "SELECT * FROM research_versions WHERE note_id=? AND id=?", (note_id, version_id)
        ).fetchone()
    if not row:
        raise LookupError("历史版本不存在")
    result = dict(row)
    result["sources"] = json.loads(result.pop("sources_json"))
    return result


def compare(note_id: str, version_id: str) -> dict:
    previous, current = version(note_id, version_id), knowledge.research_note(note_id)
    diff = "\n".join(
        difflib.unified_diff(
            (previous["title"] + "\n" + previous["body_md"]).splitlines(),
            (current["title"] + "\n" + current["body_md"]).splitlines(),
            fromfile="历史版本",
            tofile="当前版本",
            lineterm="",
        )
    )
    return {"version": previous, "diff": diff, "current_revision": current["revision"]}


def restore(note_id: str, version_id: str, revision: int) -> dict:
    old = version(note_id, version_id)
    if not set(re.findall(r"\[(S\d+)\]", old["body_md"])) <= {
        s["citation_id"] for s in old["sources"]
    }:
        raise ValueError("历史版本引用无效，不能恢复")
    with session() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM research_notes WHERE id=?", (note_id,)).fetchone()
        if not row or row["revision"] != revision:
            raise ValueError("笔记已修改，请刷新后恢复")
        if not db.execute("SELECT 1 FROM research_versions WHERE note_id=?", (note_id,)).fetchone():
            knowledge.snapshot_version(db, knowledge.research_note(note_id), "恢复前内容")
        db.execute(
            "UPDATE research_notes SET title=?,body_md=?,sources_json=?,status='saved',revision=revision+1,updated_at=? WHERE id=?",
            (
                old["title"],
                old["body_md"],
                json.dumps(old["sources"], ensure_ascii=False),
                now(),
                note_id,
            ),
        )
        knowledge.snapshot_version(db, {**old, "id": note_id}, "恢复历史版本")
    return knowledge.research_note(note_id)
