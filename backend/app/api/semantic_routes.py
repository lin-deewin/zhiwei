from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.core.database import session
from app.services.library import now
from app.services.rag import _records
from app.services.semantic import evaluate, semantic_manager, status

router = APIRouter(prefix="/api/v1/knowledge")


class EvaluationCase(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    expected_sources: list[str] = Field(min_length=1, max_length=30)


@router.get("/semantic")
def semantic_status() -> dict:
    return status()


@router.post("/semantic", status_code=202)
async def update_index() -> dict:
    return await semantic_manager.start()


@router.post("/semantic/cancel")
def cancel_index() -> dict:
    return semantic_manager.cancel()


@router.get("/evaluation-cases")
def cases() -> dict:
    with session() as db:
        rows = db.execute("SELECT * FROM retrieval_cases ORDER BY created_at DESC").fetchall()
    return {
        "items": [
            {**dict(r), "expected_sources": json.loads(r["expected_sources_json"])} for r in rows
        ]
    }


@router.post("/evaluation-cases", status_code=201)
def add_case(payload: EvaluationCase) -> dict:
    valid = {r["source_id"] for r in _records(None, None)}
    if any(key not in valid for key in payload.expected_sources):
        raise HTTPException(400, "评测的正确资料不存在，请重新选择")
    case_id = uuid.uuid4().hex
    with session() as db:
        db.execute(
            "INSERT INTO retrieval_cases VALUES (?,?,?,?)",
            (
                case_id,
                payload.question.strip(),
                json.dumps(list(dict.fromkeys(payload.expected_sources))),
                now(),
            ),
        )
    return {"id": case_id}


@router.delete("/evaluation-cases/{case_id}", status_code=204)
def delete_case(case_id: str) -> Response:
    with session() as db:
        db.execute("DELETE FROM retrieval_cases WHERE id=?", (case_id,))
    return Response(status_code=204)


@router.post("/evaluate")
async def run_evaluation() -> dict:
    return await evaluate()
