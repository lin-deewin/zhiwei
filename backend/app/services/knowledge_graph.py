from __future__ import annotations

import json
import re
import uuid

from app.core.config import get_library_dir
from app.core.database import session
from app.services.knowledge import budget_sources, grounded_answer, numbered
from app.services.library import now
from app.services.rag import _records
from app.services.semantic import selected_passages

WIKI = re.compile(r"\[\[([^\]\n]+)\]\]")


def nodes(query: str = "") -> list[dict]:
    records = _records(None, None, ["article", "note", "annotation", "research"])
    with session() as db:
        records.extend(
            {
                "source_id": "topic:" + r["id"],
                "record_id": r["id"],
                "source_type": "topic",
                "content_id": None,
                "title": r["title"],
                "text": r["body_md"],
            }
            for r in db.execute("SELECT * FROM knowledge_topics")
        )
    return [
        r
        for r in records
        if not query or query.lower() in (r["title"] + " " + r["source_id"]).lower()
    ]


def catalog(query: str = "") -> list[dict]:
    return [{k: v for k, v in r.items() if k != "text"} for r in nodes(query)][:500]


def graph(source_id: str) -> dict:
    records = nodes()
    by_id = {r["source_id"]: r for r in records}
    if source_id not in by_id:
        raise LookupError("资料不存在")
    titles = {}
    for r in records:
        titles.setdefault(r["title"], []).append(r["source_id"])
    edges, unresolved = {}, []
    for r in records:
        # Ignore wiki-like text inside fenced code and inline code.
        text = re.sub(r"```[\s\S]*?```|`[^`]*`", "", r["text"])
        for match in WIKI.findall(text):
            target = match.split("|", 1)[0].split("#", 1)[0].strip()
            candidates = [target] if target in by_id else titles.get(target, [])
            if len(candidates) == 1:
                edges[(r["source_id"], candidates[0])] = "wikilink"
            elif r["source_id"] == source_id:
                unresolved.append(
                    {
                        "target": target,
                        "reason": "ambiguous" if candidates else "missing",
                        "candidates": candidates,
                    }
                )
    with session() as db:
        for row in db.execute("SELECT * FROM knowledge_links"):
            if row["from_id"] in by_id and row["to_id"] in by_id:
                edges[(row["from_id"], row["to_id"])] = "explicit"
        for table, prefix in [("research_notes", "research"), ("knowledge_topics", "topic")]:
            for row in db.execute(f"SELECT id,sources_json FROM {table}"):
                for evidence in json.loads(row["sources_json"]):
                    target = evidence.get("source_id")
                    if target in by_id and prefix + ":" + row["id"] in by_id:
                        edges[(prefix + ":" + row["id"], target)] = "citation"

    def view(key: str, relation: str):
        r = by_id[key]
        return {k: v for k, v in r.items() if k != "text"} | {"relation": relation}

    return {
        "node": view(source_id, "self"),
        "outgoing": [view(to, kind) for (fr, to), kind in edges.items() if fr == source_id],
        "incoming": [view(fr, kind) for (fr, to), kind in edges.items() if to == source_id],
        "unresolved": unresolved,
    }


def link(from_id: str, to_id: str, label: str = "") -> dict:
    valid = {r["source_id"] for r in nodes()}
    if from_id not in valid or to_id not in valid or from_id == to_id:
        raise ValueError("链接目标不存在或与当前资料相同")
    with session() as db:
        db.execute(
            "INSERT OR REPLACE INTO knowledge_links VALUES (?,?,?,?)",
            (from_id, to_id, label, now()),
        )
    return graph(from_id)


def topic(topic_id: str) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM knowledge_topics WHERE id=?", (topic_id,)).fetchone()
    if not row:
        raise LookupError("主题页不存在")
    result = dict(row)
    result["sources"] = json.loads(result.pop("sources_json"))
    return result


def save_topic(
    title: str,
    body: str,
    topic_id: str | None = None,
    revision: int | None = None,
    sources: list[dict] | None = None,
) -> dict:
    if not title.strip():
        raise ValueError("主题名称不能为空")
    timestamp = now()
    with session() as db:
        if topic_id:
            prior = topic(topic_id)
            if revision != prior["revision"]:
                raise RuntimeError("主题页已修改，请刷新后保存")
            evidence = sources if sources is not None else prior["sources"]
            valid = {s["citation_id"] for s in evidence}
            if not set(re.findall(r"\[(S\d+)\]", body)) <= valid:
                raise ValueError("主题页包含不存在的引用编号")
            changed = db.execute(
                "UPDATE knowledge_topics SET title=?,body_md=?,sources_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
                (
                    title.strip(),
                    body,
                    json.dumps(evidence, ensure_ascii=False),
                    timestamp,
                    topic_id,
                    revision,
                ),
            ).rowcount
            if not changed:
                raise RuntimeError("主题页已修改，请刷新后保存")
        else:
            topic_id = uuid.uuid4().hex
            db.execute(
                "INSERT INTO knowledge_topics(id,title,body_md,created_at,updated_at) VALUES (?,?,?,?,?)",
                (topic_id, title.strip(), body, timestamp, timestamp),
            )
    return topic(topic_id)


async def topic_draft(topic_id: str, source_ids: list[str]) -> dict:
    library = get_library_dir().resolve()
    prior = topic(topic_id)
    by_id = {r["source_id"]: r for r in nodes()}
    if any(key not in by_id for key in source_ids):
        raise ValueError("所选资料不存在")
    chunks = selected_passages(
        prior["title"],
        [by_id[key] for key in dict.fromkeys(source_ids) if key != "topic:" + topic_id],
    )
    if not chunks:
        raise ValueError("请选择有正文的参考资料")
    sources = numbered(budget_sources(prior["title"], chunks))
    body = await grounded_answer(
        "整理主题知识页："
        + prior["title"]
        + "。已有内容（仅作组织参考，事实必须以资料为准）："
        + prior["body_md"][:2000],
        sources,
        research=True,
    )
    if get_library_dir().resolve() != library:
        raise ValueError("资料库已切换，请重新生成")
    draft_id = uuid.uuid4().hex
    with session(library) as db:
        db.execute(
            "INSERT INTO topic_drafts VALUES (?,?,?,?,?,?)",
            (
                draft_id,
                topic_id,
                body,
                json.dumps(sources, ensure_ascii=False),
                prior["revision"],
                now(),
            ),
        )
    return {
        "id": draft_id,
        "title": prior["title"],
        "body_md": body,
        "sources": sources,
        "revision": prior["revision"],
    }
