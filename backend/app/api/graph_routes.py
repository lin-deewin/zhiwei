from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.api.knowledge_routes import translate_model
from app.core.database import session
from app.services import knowledge_graph as graph

router = APIRouter(prefix="/api/v1/knowledge")


class TopicInput(BaseModel):
    title: str = Field(min_length=1, max_length=1000)
    body_md: str = Field(default="", max_length=100000)
    revision: int | None = None
    draft_id: str | None = None


class LinkInput(BaseModel):
    from_id: str = Field(max_length=200)
    to_id: str = Field(max_length=200)
    label: str = Field(default="", max_length=300)


class SourcesInput(BaseModel):
    source_ids: list[str] = Field(min_length=1, max_length=16)


def translate(call):
    try:
        return call()
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/nodes")
def nodes(q: str = "") -> dict:
    return {"items": graph.catalog(q[:300])}


@router.get("/links")
def links(source_id: str) -> dict:
    return translate(lambda: graph.graph(source_id))


@router.post("/links")
def add_link(payload: LinkInput) -> dict:
    return translate(lambda: graph.link(payload.from_id, payload.to_id, payload.label))


@router.delete("/links", status_code=204)
def delete_link(from_id: str, to_id: str) -> Response:
    with session() as db:
        db.execute("DELETE FROM knowledge_links WHERE from_id=? AND to_id=?", (from_id, to_id))
    return Response(status_code=204)


@router.get("/topics")
def topics() -> dict:
    with session() as db:
        rows = db.execute(
            "SELECT id,title,revision,updated_at FROM knowledge_topics ORDER BY updated_at DESC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/topics", status_code=201)
def create_topic(payload: TopicInput) -> dict:
    return translate(lambda: graph.save_topic(payload.title, payload.body_md))


@router.get("/topics/{topic_id}")
def topic(topic_id: str) -> dict:
    return translate(lambda: graph.topic(topic_id))


@router.patch("/topics/{topic_id}")
def patch_topic(topic_id: str, payload: TopicInput) -> dict:
    evidence = None
    if payload.draft_id:
        with session() as db:
            draft = db.execute(
                "SELECT * FROM topic_drafts WHERE id=? AND topic_id=?", (payload.draft_id, topic_id)
            ).fetchone()
        if not draft or draft["base_revision"] != payload.revision:
            raise HTTPException(409, "更新草稿已失效，请重新生成")
        evidence = json.loads(draft["sources_json"])
    return translate(
        lambda: graph.save_topic(
            payload.title, payload.body_md, topic_id, payload.revision, evidence
        )
    )


@router.post("/topics/{topic_id}/draft")
async def draft(topic_id: str, payload: SourcesInput) -> dict:
    try:
        return await translate_model(graph.topic_draft(topic_id, payload.source_ids))
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


class ResolveInput(BaseModel):
    targets: list[str] = Field(max_length=100)


@router.post("/resolve-links")
def resolve_links(payload: ResolveInput) -> dict:
    records = graph.nodes()
    by_id = {r["source_id"]: r for r in records}
    by_title = {}
    for record in records:
        by_title.setdefault(record["title"], []).append(record)
    resolved = {}
    for target in payload.targets:
        base = target.split("#", 1)[0].strip()
        matches = [by_id[base]] if base in by_id else by_title.get(base, [])
        if len(matches) == 1:
            resolved[target] = {k: v for k, v in matches[0].items() if k != "text"}
    return {"items": resolved}
