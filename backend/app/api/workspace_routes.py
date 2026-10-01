from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.knowledge_routes import translate_model
from app.services import research_workspace as workspace

router = APIRouter(prefix="/api/v1/knowledge")


class CreateProject(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=2, max_length=2000)
    source_ids: list[str] = Field(min_length=1, max_length=16)


class ScopeInput(BaseModel):
    revision: int = Field(ge=1)
    source_ids: list[str] = Field(min_length=1, max_length=16)
    refresh: bool = False


class AskInput(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    revision: int = Field(ge=1)


class RestoreInput(BaseModel):
    revision: int = Field(ge=1)


def run(call, *args):
    try:
        return call(*args)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/projects")
def projects():
    return {"items": workspace.list_projects()}


@router.post("/projects", status_code=201)
def create(payload: CreateProject):
    return run(workspace.create, payload.title, payload.question, payload.source_ids)


@router.get("/projects/{project_id}")
def project(project_id: str):
    return run(workspace.project, project_id)


@router.patch("/projects/{project_id}/evidence")
def scope(project_id: str, payload: ScopeInput):
    return run(workspace.update, project_id, payload.revision, payload.source_ids, payload.refresh)


@router.post("/projects/{project_id}/ask")
async def ask(project_id: str, payload: AskInput):
    run(workspace.project, project_id)
    return await translate_model(
        workspace.ask(project_id, payload.question.strip(), payload.revision)
    )


@router.post("/projects/{project_id}/research")
async def research(project_id: str, payload: AskInput):
    run(workspace.project, project_id)
    return await translate_model(
        workspace.ask(project_id, payload.question.strip(), payload.revision, True)
    )


@router.get("/versions/{note_id}")
def versions(note_id: str):
    return {"items": run(workspace.versions, note_id)}


@router.get("/versions/{note_id}/{version_id}")
def compare(note_id: str, version_id: str):
    return run(workspace.compare, note_id, version_id)


@router.post("/versions/{note_id}/{version_id}/restore")
def restore(note_id: str, version_id: str, payload: RestoreInput):
    return run(workspace.restore, note_id, version_id, payload.revision)
