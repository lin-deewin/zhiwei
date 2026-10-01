from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.core.database import session
from app.services import knowledge
from app.services.ai import AIRequestError
from app.services.semantic import hybrid_retrieve as retrieve

router = APIRouter(prefix="/api/v1")
Kind = Literal["article", "note", "annotation", "research", "topic"]


class EvidenceInput(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    category_id: int | None = None
    kinds: list[Kind] = Field(
        default_factory=lambda: ["article", "note", "annotation", "research", "topic"],
        min_length=1,
        max_length=5,
    )


class ResearchInput(EvidenceInput):
    chunk_ids: list[str] = Field(min_length=2, max_length=16)


class SaveInput(BaseModel):
    revision: int | None = Field(default=None, ge=1)
    title: str | None = Field(default=None, max_length=1000)
    body_md: str | None = Field(default=None, max_length=100000)


async def translate_model(call: Awaitable[dict]) -> dict:
    try:
        async with asyncio.timeout(330):
            return await call
    except ValueError as error:
        if str(error) == "AI_NOT_CONFIGURED":
            raise HTTPException(503, "请先在设置中配置聊天模型") from error
        raise HTTPException(400, str(error)) from error
    except (TimeoutError, httpx.TimeoutException) as error:
        raise HTTPException(504, "模型响应超时，请减少所选片段或稍后重试") from error
    except AIRequestError as error:
        raise HTTPException(502, str(error)) from error
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        message = (
            "模型服务限流或额度不足，请稍后重试"
            if status == 429
            else "模型服务认证失败，请检查 API Key"
            if status in {401, 403}
            else f"模型服务返回 HTTP {status}，请检查模型和 API 地址"
        )
        raise HTTPException(502, message) from error
    except httpx.HTTPError as error:
        raise HTTPException(502, "无法连接模型服务，请检查 API 地址和网络") from error
    except (KeyError, TypeError) as error:
        raise HTTPException(502, "模型返回格式不兼容，未找到文本回答") from error


@router.post("/knowledge/search")
async def search(payload: EvidenceInput) -> dict:
    return {
        "sources": await asyncio.to_thread(
            retrieve, payload.question.strip(), payload.category_id, None, 40, payload.kinds
        )
    }


@router.post("/research-notes", status_code=201)
async def generate_research(payload: ResearchInput) -> dict:
    return await translate_model(
        knowledge.research(
            payload.question.strip(), payload.chunk_ids, payload.category_id, payload.kinds
        )
    )


@router.get("/research-notes")
def research_notes(q: str = "", include_drafts: bool = False) -> dict:
    return {"items": knowledge.list_research(q[:300], include_drafts=include_drafts)}


@router.get("/research-notes/{note_id}")
def research_note(note_id: str) -> dict:
    try:
        return knowledge.research_note(note_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.post("/research-notes/{note_id}/save")
def save_research(note_id: str, payload: SaveInput) -> dict:
    try:
        return knowledge.save_research(note_id, payload.title, payload.body_md, payload.revision)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.delete("/research-notes/{note_id}", status_code=204)
def delete_research(note_id: str) -> Response:
    with session() as db:
        db.execute("DELETE FROM research_notes WHERE id=?", (note_id,))
    return Response(status_code=204)
