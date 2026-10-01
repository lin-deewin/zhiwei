from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import markdown_sync as service

router = APIRouter(prefix="/api/v1/knowledge/markdown")


class ConfigurationInput(BaseModel):
    directory: str = Field(min_length=1, max_length=2000)
    auto_sync: bool = False


class ImportInput(BaseModel):
    paths: list[str] = Field(max_length=500)
    expected_hashes: dict[str, str] = Field(default_factory=dict)
    merged_record_hashes: dict[str, str] = Field(default_factory=dict)


def call(function, *args):
    try:
        return function(*args)
    except (OSError, ValueError) as error:
        raise HTTPException(400, str(error)) from error


@router.get("/configuration")
def configuration() -> dict:
    return call(service.configuration)


@router.patch("/configuration")
def configure(payload: ConfigurationInput) -> dict:
    return call(service.configure, payload.directory, payload.auto_sync)


@router.get("/preview")
def preview() -> dict:
    return call(service.preview)


@router.post("/import")
def import_files(payload: ImportInput) -> dict:
    return call(service.apply, payload.paths, payload.expected_hashes, payload.merged_record_hashes)


@router.post("/export")
def export_files() -> dict:
    return call(service.export_all)


@router.post("/sync")
def sync_files() -> dict:
    return call(service.sync_safe)
