from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.services import personal_notes as service

router = APIRouter(prefix="/api/v1")


class PersonalNoteCreate(BaseModel):
    title: str = Field(default="", max_length=1000)
    body_md: str = Field(default="", max_length=100000)
    source_ids: list[str] = Field(default_factory=list, max_length=32)
    tags: list[str] = Field(default_factory=list, max_length=12)


class PersonalNotePatch(BaseModel):
    title: str = Field(default="", max_length=1000)
    body_md: str = Field(default="", max_length=100000)
    revision: int = Field(ge=1)
    source_ids: list[str] | None = Field(default=None, max_length=32)
    tags: list[str] | None = Field(default=None, max_length=12)


class PersonalNoteDeleteItem(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=1)


class PersonalNoteBulkDelete(BaseModel):
    items: list[PersonalNoteDeleteItem] = Field(min_length=1, max_length=50)


def _translate(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, {"code": "PERSONAL_NOTE_CONFLICT", "message": str(error)}) from error
    except ValueError as error:
        raise HTTPException(400, {"code": "INVALID_INPUT", "message": str(error)}) from error


@router.get("/personal-notes")
def list_personal_notes(q: str = "", page: int = 1, page_size: int = 20):
    return _translate(service.list_personal_notes, q, page, page_size)


@router.post("/personal-notes", status_code=201)
def create_personal_note(payload: PersonalNoteCreate):
    return _translate(service.create_personal_note, payload.model_dump())


@router.post("/personal-notes/bulk-delete")
def bulk_delete_personal_notes(payload: PersonalNoteBulkDelete):
    return _translate(service.delete_personal_notes, [item.model_dump() for item in payload.items])


@router.get("/personal-notes/{note_id}")
def get_personal_note(note_id: str):
    return _translate(service.get_personal_note, note_id)


@router.get("/personal-notes/{note_id}/versions")
def list_personal_note_versions(note_id: str):
    return _translate(service.list_personal_note_versions, note_id)


@router.get("/personal-notes/{note_id}/versions/{revision}")
def get_personal_note_version(note_id: str, revision: int):
    return _translate(service.get_personal_note_version, note_id, revision)


@router.patch("/personal-notes/{note_id}")
def update_personal_note(note_id: str, payload: PersonalNotePatch):
    return _translate(service.update_personal_note, note_id, payload.model_dump())


@router.delete("/personal-notes/{note_id}", status_code=204)
def delete_personal_note(note_id: str, revision: int):
    _translate(service.delete_personal_note, note_id, revision)
    return Response(status_code=204)
