from __future__ import annotations

import uuid
import json
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from pydantic import BaseModel, Field

from app.services import reading_workspace as service
from app.services import reading_progress as progress_service

router = APIRouter(prefix="/api/v1")


class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=1000)
    body_md: str = Field(default="", max_length=100000)
    request_key: str | None = Field(default=None, min_length=8, max_length=100)


class NotePatch(NoteCreate):
    revision: int = Field(ge=1)


class AnnotationCreate(BaseModel):
    revision_id: str
    anchor: dict
    color: Literal["yellow", "green", "blue"] = "yellow"
    comment_md: str = Field(default="", max_length=20000)
    request_key: str | None = Field(default=None, min_length=8, max_length=100)


class AnnotationPatch(BaseModel):
    revision: int = Field(ge=1)
    color: Literal["yellow", "green", "blue"] | None = None
    comment_md: str | None = Field(default=None, max_length=20000)


class ReanchorInput(BaseModel):
    revision: int = Field(ge=1)
    revision_id: str
    anchor: dict


class ReadingAIInput(BaseModel):
    action: Literal["summary", "explain", "key_points"]
    revision_id: str
    selection_anchor: dict | None = None
    force: bool = False
    request_key: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=8, max_length=100)


class ReadingProgressInput(BaseModel):
    progress_ratio: float = Field(ge=0, le=1)
    scroll_y: float = Field(default=0, ge=0)
    block_id: str | None = Field(default=None, max_length=200)


class ReadLaterInput(BaseModel):
    enabled: bool


class SearchInput(BaseModel):
    q: str = Field(default="", max_length=300)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    include_quotes: bool = False
    content_id: str | None = None
    category_id: int | None = None


@router.get("/contents/{content_id}/annotations")
def get_annotations(content_id: str):
    context = _translate(service.reading_context, content_id)
    return context["annotations"]


def _translate(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except RuntimeError as error:
        message = str(error)
        code = "NOTE_REVISION_CONFLICT" if "其他页面" in message or "修改" in message else message
        status = 413 if code == "AI_CONTEXT_LIMIT" else 502 if code == "AI_REDUCTION_LIMIT" else 409
        raise HTTPException(status, {"code": code, "message": message}) from error
    except PermissionError as error:
        if str(error) == "AI_NOT_CONFIGURED":
            raise HTTPException(503, {"code": str(error), "message": "请先配置聊天模型"}) from error
        raise HTTPException(403, str(error)) from error
    except ValueError as error:
        raise HTTPException(409 if "版本已变化" in str(error) else 400,
                            {"code": "BODY_VERSION_CHANGED" if "版本已变化" in str(error) else "INVALID_INPUT",
                             "message": str(error)}) from error


@router.get("/contents/{content_id}/reading-context")
def get_reading_context(content_id: str):
    return _translate(service.reading_context, content_id)


@router.get("/contents/{content_id}/reading-progress")
def get_reading_progress(content_id: str):
    return _translate(progress_service.get_reading_progress, content_id)


@router.patch("/contents/{content_id}/reading-progress")
def patch_reading_progress(content_id: str, payload: ReadingProgressInput):
    return _translate(progress_service.save_reading_progress, content_id, payload.model_dump())


@router.post("/contents/{content_id}/read-later")
def update_read_later(content_id: str, payload: ReadLaterInput):
    return _translate(progress_service.set_read_later, content_id, payload.enabled)


@router.get("/reading/recent")
def get_recently_read(limit: int = 50):
    return _translate(progress_service.recently_read, limit)


@router.get("/reading/later")
def get_read_later(limit: int = 50):
    return _translate(progress_service.read_later, limit)


@router.post("/contents/{content_id}/annotations", status_code=201)
def post_annotation(content_id: str, payload: AnnotationCreate):
    return _translate(service.create_annotation, content_id, payload.model_dump())


@router.patch("/annotations/{annotation_id}")
def patch_annotation(annotation_id: str, payload: AnnotationPatch):
    return _translate(service.patch_annotation, annotation_id,
                      {k: v for k, v in payload.model_dump().items() if v is not None})


@router.post("/annotations/{annotation_id}/reanchor")
def reanchor_annotation(annotation_id: str, payload: ReanchorInput):
    return _translate(service.reanchor_annotation, annotation_id, payload.model_dump())


@router.delete("/annotations/{annotation_id}", status_code=204)
def remove_annotation(annotation_id: str, revision: int):
    return _translate(service.delete_annotation, annotation_id, revision)


@router.post("/contents/{content_id}/notes", status_code=201)
def post_note(content_id: str, payload: NoteCreate):
    return _translate(service.create_note, content_id, payload.model_dump())


@router.patch("/notes/{note_id}")
def patch_note(note_id: str, payload: NotePatch):
    return _translate(service.patch_note, note_id, payload.model_dump())


@router.delete("/notes/{note_id}", status_code=204)
def remove_note(note_id: str, revision: int):
    return _translate(service.delete_note, note_id, revision)


@router.get("/notes/search")
def get_notes(q: str = "", page: int = 1, page_size: int = 20, include_quotes: bool = False,
             content_id: str | None = None, category_id: int | None = None):
    return _translate(service.search_notes, q, page, page_size, include_quotes, content_id, category_id)


@router.get("/notes")
def list_notes(q: str = "", page: int = 1, page_size: int = 20):
    return _translate(service.list_notes, q, page, page_size)


@router.post("/contents/{content_id}/reading-ai-jobs", status_code=202)
def post_reading_ai_job(content_id: str, payload: ReadingAIInput, background: BackgroundTasks):
    result = _translate(service.create_ai_job, content_id, payload.model_dump())
    api_key = result.pop("api_key", None)
    if result.get("kind") == "job" and not result.get("reused"):
        background.add_task(service.reading_ai_manager.start, result["id"], api_key or "")
    return result


@router.get("/reading-ai-jobs/{job_id}")
def get_reading_ai_job(job_id: str):
    result = service.ai_job(job_id)
    if not result:
        raise HTTPException(404, "任务不存在")
    return result


@router.post("/reading-ai-jobs/{job_id}/cancel")
def cancel_reading_ai_job(job_id: str):
    service.reading_ai_manager.cancel(job_id)
    result = service.ai_job(job_id)
    if not result:
        raise HTTPException(404, "任务不存在")
    return result


@router.post("/reading-ai-jobs/{job_id}/retry", status_code=202)
def retry_reading_ai_job(job_id: str, background: BackgroundTasks):
    result = _translate(service.retry_ai_job, job_id)
    key = result.pop("api_key", None)
    if result.get("kind") == "job" and not result.get("reused"):
        background.add_task(service.reading_ai_manager.start, result["id"], key or "")
    return result


@router.get("/contents/{content_id}/reading-ai-results")
def get_reading_ai_results(content_id: str):
    return service.ai_results(content_id)


@router.get("/contents/{content_id}/reading-export")
def export_reading_data(content_id: str):
    data = _translate(service.reading_export, content_id)
    return Response(content=json.dumps(data, ensure_ascii=False), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="reading-data.json"'})


@router.post("/contents/{content_id}/reading-imports/preview")
def preview_reading_data(content_id: str, payload: dict):
    return _translate(service.preview_reading_import, content_id, payload)


class ReadingImportInput(BaseModel):
    request_key: str = Field(min_length=8, max_length=100)
    data: dict


@router.post("/contents/{content_id}/reading-imports")
def import_reading_data(content_id: str, payload: ReadingImportInput):
    return _translate(service.restore_reading_data, content_id, payload.data, payload.request_key)


@router.get("/reading-ai-results/{result_id}")
def get_reading_ai_result(result_id: str):
    result = service.ai_result(result_id)
    if not result:
        raise HTTPException(404, "AI 结果不存在")
    return result


@router.delete("/reading-ai-results/{result_id}", status_code=204)
def remove_reading_ai_result(result_id: str):
    service.delete_ai_result(result_id)


class ConvertResultInput(BaseModel):
    request_key: str = Field(min_length=8, max_length=100)
    title: str = Field(default="AI 阅读结果", max_length=1000)


@router.post("/reading-ai-results/{result_id}/notes", status_code=201)
def convert_reading_result(result_id: str, payload: ConvertResultInput):
    return _translate(service.result_to_note, result_id, payload.model_dump())
