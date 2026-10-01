from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, File, Header, HTTPException, Query, Response, UploadFile
from playwright.async_api import Error as PlaywrightError
from pydantic import BaseModel, Field

from app.core.config import get_ai_config, get_library_dir, set_ai_config, set_library_dir
from app.core.database import session
from app.services.ai import AIRequestError
from app.services.classification import (
    _eligible_rows,
    classification_manager,
    suggest_category_with_model,
)
from app.services.library import (
    delete_content,
    get_content,
    import_markdown,
    list_contents,
    now,
    set_classification,
    set_model_classification,
)
from app.services.sync import sync_manager
from app.services.zhihu_account import account_status
from app.services.zhihu_browser import ZhihuAuthError, ZhihuFetchError, zhihu_browser
from app.services.zhihu_login import LoginConflict, LoginDenied, zhihu_login
from app.services.zhihu_qr import zhihu_qr

router = APIRouter(prefix="/api/v1")


class CategoryInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: int | None = None


class ClassifyInput(BaseModel):
    category_id: int | None


class SettingsInput(BaseModel):
    library_dir: str = Field(min_length=1, max_length=1024)


class AISettingsInput(BaseModel):
    base_url: str = Field(max_length=500)
    chat_model: str = Field(max_length=120)
    embedding_model: str = Field(default="", max_length=120)
    api_key: str | None = Field(default=None, max_length=1000)
    clear_api_key: bool = False


class AskInput(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    category_id: int | None = None
    folder_id: str | None = Field(default=None, max_length=200)
    kinds: list[Literal["article", "note", "annotation", "research", "topic"]] | None = Field(default=None, min_length=1, max_length=5)


class SyncInput(BaseModel):
    mode: Literal["full", "incremental"] = "incremental"
    folder_ids: list[str] = Field(default_factory=list, max_length=100)


class ClassificationInput(BaseModel):
    scope: Literal["pending"] = "pending"


class LoginStartInput(BaseModel):
    request_id: str = Field(min_length=8, max_length=100)


class LoginInput(BaseModel):
    frame_id: int
    events: list[dict] = Field(min_length=1, max_length=30)


def _login_error(error: Exception) -> HTTPException:
    if isinstance(error, LoginDenied):
        return HTTPException(403, str(error))
    if isinstance(error, LoginConflict):
        return HTTPException(409, str(error))
    if isinstance(error, ValueError):
        return HTTPException(400, str(error))
    return HTTPException(502, "知乎登录页面暂时不可用")


def _folder_row(row: sqlite3.Row) -> dict:
    return dict(row)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "zhihu-library"}


@router.get("/account")
def account() -> dict:
    return account_status()


@router.post("/account/login")
async def start_browser_login(payload: LoginStartInput) -> dict:
    try:
        return await zhihu_login.start(payload.request_id)
    except (LoginConflict, LoginDenied, ValueError, OSError, RuntimeError) as error:
        raise _login_error(error) from error


@router.get("/account/login/{login_id}")
def browser_login_status(login_id: str,
                         x_zhilib_login_token: str | None = Header(default=None)) -> dict:
    try:
        return zhihu_login.status(login_id, x_zhilib_login_token)
    except LoginDenied as error:
        raise _login_error(error) from error


@router.get("/account/login/{login_id}/frame")
async def browser_login_frame(login_id: str, response: Response,
                              x_zhilib_login_token: str | None = Header(default=None)) -> dict:
    try:
        response.headers["Cache-Control"] = "no-store"
        return await zhihu_login.frame(login_id, x_zhilib_login_token)
    except (LoginDenied, LoginConflict, PlaywrightError) as error:
        raise _login_error(error) from error


@router.post("/account/login/{login_id}/input")
async def browser_login_input(login_id: str, payload: LoginInput,
                              x_zhilib_login_token: str | None = Header(default=None)) -> dict:
    try:
        return await zhihu_login.input(login_id, x_zhilib_login_token,
                                       payload.frame_id, payload.events)
    except (LoginDenied, LoginConflict, ValueError, PlaywrightError) as error:
        raise _login_error(error) from error


@router.post("/account/login/{login_id}/refresh")
async def browser_login_refresh(login_id: str,
                                x_zhilib_login_token: str | None = Header(default=None)) -> dict:
    try:
        return await zhihu_login.refresh(login_id, x_zhilib_login_token)
    except (LoginDenied, LoginConflict, PlaywrightError) as error:
        raise _login_error(error) from error


@router.delete("/account/login/{login_id}")
async def browser_login_cancel(login_id: str,
                               x_zhilib_login_token: str | None = Header(default=None)) -> dict:
    try:
        return await zhihu_login.cancel(login_id, x_zhilib_login_token)
    except LoginDenied as error:
        raise _login_error(error) from error


@router.post("/account/connect")
async def connect_account() -> dict:
    zhihu_qr.cancel_pending()
    return await zhihu_browser.connect()


@router.post("/account/verify")
async def verify_account() -> dict:
    if zhihu_qr.status()["status"] == "connected":
        return zhihu_qr.status()
    return await zhihu_browser.verify()


@router.post("/account/disconnect")
async def disconnect_account() -> dict:
    await zhihu_login.close()
    zhihu_qr.disconnect()
    return await zhihu_browser.disconnect()


@router.post("/account/qr/start")
def start_qr_login() -> dict:
    try:
        return zhihu_qr.start()
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/account/qr/poll")
def poll_qr_login() -> dict:
    return zhihu_qr.poll()


@router.get("/folders")
def folders() -> list[dict]:
    with session() as db:
        return [_folder_row(row) for row in db.execute(
            """SELECT f.*, COUNT(fc.content_id) AS article_count FROM folders f
               LEFT JOIN folder_contents fc ON fc.folder_id=f.id AND fc.source_status='active'
               GROUP BY f.id ORDER BY f.name""")]


@router.post("/folders/refresh")
async def refresh_folders() -> list[dict]:
    try:
        await sync_manager.refresh_folders()
    except ZhihuAuthError as error:
        raise HTTPException(401, str(error)) from error
    except ZhihuFetchError as error:
        raise HTTPException(502, str(error)) from error
    return folders()


@router.get("/settings")
def settings() -> dict:
    library = get_library_dir()
    library.mkdir(parents=True, exist_ok=True)
    with session() as db:
        count = db.execute("SELECT COUNT(*) FROM contents").fetchone()[0]
    ai = get_ai_config()
    return {"library_dir": str(library), "content_count": count,
            "zhihu_status": account()["status"],
            "ai_configured": bool(ai["base_url"] and ai["chat_model"]),
            "ai_base_url": ai["base_url"], "ai_chat_model": ai["chat_model"],
            "ai_embedding_model": ai["embedding_model"], "ai_api_key_set": bool(ai["api_key"])}


@router.patch("/settings")
def update_settings(payload: SettingsInput) -> dict:
    try:
        path = set_library_dir(payload.library_dir)
    except (OSError, ValueError) as error:
        raise HTTPException(400, detail=str(error)) from error
    return {"library_dir": str(path)}


@router.patch("/settings/ai")
def update_ai_settings(payload: AISettingsInput) -> dict:
    base_url = payload.base_url.strip().rstrip("/")
    if base_url and base_url != "opencode://local":
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
            raise HTTPException(400, "模型地址必须是有效的 http 或 https URL，不能包含账号密码")
    return set_ai_config(base_url, payload.chat_model.strip(), payload.embedding_model.strip(),
                         payload.api_key, payload.clear_api_key)


@router.get("/categories")
def categories() -> list[dict]:
    with session() as db:
        rows = db.execute(
            """SELECT c.*, (SELECT COUNT(*) FROM contents x WHERE x.category_id=c.id OR
                 x.category_id IN (SELECT child.id FROM categories child WHERE child.parent_id=c.id)) AS article_count
               FROM categories c ORDER BY c.parent_id IS NOT NULL, c.sort_order, c.name"""
        ).fetchall()
        return [dict(row) for row in rows]


@router.post("/categories", status_code=201)
def create_category(payload: CategoryInput) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "分类名称不能为空")
    with session() as db:
        if payload.parent_id is not None:
            parent = db.execute("SELECT parent_id FROM categories WHERE id=?", (payload.parent_id,)).fetchone()
            if not parent:
                raise HTTPException(404, "父级分类不存在")
            if parent["parent_id"] is not None:
                raise HTTPException(400, "最多支持两级分类")
        try:
            cursor = db.execute("INSERT INTO categories(parent_id, name, created_at) VALUES (?, ?, ?)",
                                (payload.parent_id, name, now()))
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "同级分类名称已存在") from error
        return dict(db.execute("SELECT * FROM categories WHERE id=?", (cursor.lastrowid,)).fetchone())


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, move_to: int | None = Query(default=None)) -> None:
    with session() as db:
        category = db.execute("SELECT id FROM categories WHERE id=?", (category_id,)).fetchone()
        if not category:
            raise HTTPException(404, "分类不存在")
        if db.execute("SELECT 1 FROM categories WHERE parent_id=?", (category_id,)).fetchone():
            raise HTTPException(409, "请先删除或迁移子分类")
        if move_to == category_id:
            raise HTTPException(400, "不能迁移到自身")
        if move_to is not None and not db.execute("SELECT 1 FROM categories WHERE id=?", (move_to,)).fetchone():
            raise HTTPException(404, "迁移目标不存在")
        if move_to is not None and db.execute("SELECT 1 FROM categories WHERE parent_id=?", (move_to,)).fetchone():
            raise HTTPException(400, "文章只能迁移到可用的小类")
        db.execute("""UPDATE contents SET category_id=?, classification_source=CASE WHEN ? IS NULL THEN 'none' ELSE classification_source END,
                     classification_locked=CASE WHEN ? IS NULL THEN 0 ELSE classification_locked END,
                     classification_reason=CASE WHEN ? IS NULL THEN '' ELSE classification_reason END,
                     classified_content_hash=CASE WHEN ? IS NULL THEN NULL ELSE classified_content_hash END
                     WHERE category_id=?""", (move_to, move_to, move_to, move_to, move_to, category_id))
        db.execute("DELETE FROM categories WHERE id=?", (category_id,))


@router.get("/contents")
def contents(q: str = "", category_id: int | None = None, folder_id: str | None = None,
             page: int = Query(default=1, ge=1), page_size: int = Query(default=24, ge=1, le=100),
             pending_only: bool = False, sort: Literal["synced", "title"] = "synced") -> dict:
    return list_contents(q[:200], category_id, folder_id, page, page_size, pending_only, sort)


@router.get("/contents/{content_id}")
def content(content_id: str) -> dict:
    result = get_content(content_id)
    if not result:
        raise HTTPException(404, "文章不存在")
    return result


@router.delete("/contents/{content_id}", status_code=204)
def remove_content(content_id: str) -> None:
    try:
        if not delete_content(content_id):
            raise HTTPException(404, "文章不存在")
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except OSError as error:
        raise HTTPException(500, "无法删除本地文章文件，请检查资料目录权限后重试") from error


@router.post("/ask")
async def ask(payload: AskInput) -> dict:
    from app.api.knowledge_routes import translate_model
    from app.services.knowledge import answer
    return await translate_model(answer(payload.question.strip(), payload.category_id,
                                         payload.folder_id, payload.kinds))


@router.patch("/contents/{content_id}/classification")
def classify(content_id: str, payload: ClassifyInput) -> dict:
    try:
        result = set_classification(content_id, payload.category_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if not result:
        raise HTTPException(404, "文章不存在")
    return result


@router.post("/contents/{content_id}/auto-classify")
async def auto_classify(content_id: str) -> dict:
    item = get_content(content_id)
    if not item:
        raise HTTPException(404, "文章不存在")
    if item["classification_locked"]:
        raise HTTPException(409, "这篇文章的分类已由你手动确认")
    try:
        category_id, reason = await suggest_category_with_model(item["title"], item["markdown"] or "")
        if category_id is None:
            raise HTTPException(422, detail={"code": "CLASSIFICATION_UNCERTAIN",
                                             "message": reason})
        updated = set_model_classification(content_id, category_id, reason)
    except HTTPException:
        raise
    except PermissionError as error:
        raise HTTPException(409, str(error)) from error
    except (ValueError, TypeError, KeyError) as error:
        if str(error) == "AI_NOT_CONFIGURED":
            raise HTTPException(503, detail={"code": "AI_NOT_CONFIGURED", "message": "请先配置聊天模型"}) from error
        raise HTTPException(502, detail={"code": "CLASSIFICATION_INVALID", "message": str(error)}) from error
    except httpx.HTTPError as error:
        raise HTTPException(502, detail={"code": "AI_REQUEST_FAILED",
                                         "message": f"模型请求失败：{type(error).__name__}"}) from error
    except AIRequestError as error:
        raise HTTPException(502, detail={"code": "AI_REQUEST_FAILED", "message": str(error)}) from error
    return {"content": updated, "reason": reason, "source": "model"}


@router.post("/imports/markdown", status_code=201)
async def upload_markdown(file: UploadFile = File(...)) -> dict:  # noqa: B008
    if not file.filename or Path(file.filename).suffix.lower() not in {".md", ".markdown", ".txt"}:
        raise HTTPException(400, "请选择 Markdown 或文本文件")
    try:
        data = await file.read(10 * 1024 * 1024 + 1)
        return import_markdown(Path(file.filename).name, data)
    except UnicodeDecodeError as error:
        raise HTTPException(400, "文件必须使用 UTF-8 编码") from error
    except ValueError as error:
        raise HTTPException(413, str(error)) from error


@router.get("/contents/{content_id}/assets/{asset_name}")
def asset(content_id: str, asset_name: str):
    from fastapi.responses import FileResponse

    if "/" in asset_name or "\\" in asset_name or asset_name in {".", ".."}:
        raise HTTPException(400, "非法资源路径")
    record = get_content(content_id)
    if not record:
        raise HTTPException(404, "文章不存在")
    root = (get_library_dir() / "articles" / content_id / "assets").resolve()
    candidate = (root / asset_name).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise HTTPException(404, "图片不存在")
    return FileResponse(candidate)


@router.post("/sync-jobs", status_code=202)
async def create_sync_job(body: SyncInput) -> dict:
    try:
        return await sync_manager.start(body.mode, body.folder_ids)
    except ZhihuAuthError as error:
        raise HTTPException(401, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/sync-jobs")
def sync_jobs() -> list[dict]:
    with session() as db:
        return [dict(row) for row in db.execute("SELECT * FROM sync_jobs ORDER BY created_at DESC LIMIT 30")]


@router.get("/sync-jobs/{job_id}")
def sync_job(job_id: str) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM sync_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, "同步任务不存在")
    return dict(row)


@router.post("/sync-jobs/{job_id}/cancel")
def cancel_sync_job(job_id: str) -> dict:
    result = sync_manager.cancel(job_id)
    if not result:
        raise HTTPException(404, "同步任务不存在")
    return result


@router.post("/classification-jobs", status_code=202)
async def create_classification_job(body: ClassificationInput | None = None) -> dict:
    try:
        return await classification_manager.start((body or ClassificationInput()).scope)
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.get("/classification-jobs")
def classification_jobs() -> list[dict]:
    with session() as db:
        return [dict(row) for row in db.execute(
            "SELECT * FROM classification_jobs ORDER BY created_at DESC LIMIT 30"
        )]


@router.get("/classification-jobs/overview")
def classification_overview() -> dict:
    return {"pending": len(_eligible_rows())}


@router.get("/classification-jobs/{job_id}")
def classification_job(job_id: str) -> dict:
    row = classification_manager._row(job_id)
    if not row:
        raise HTTPException(404, "主题整理任务不存在")
    return row


@router.post("/classification-jobs/{job_id}/cancel")
def cancel_classification_job(job_id: str) -> dict:
    row = classification_manager.cancel(job_id)
    if not row:
        raise HTTPException(404, "主题整理任务不存在")
    return row


@router.post("/classification-jobs/{job_id}/retry", status_code=202)
async def retry_classification_job(job_id: str) -> dict:
    try:
        return await classification_manager.start(retry_id=job_id)
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


class QuestionContentInput(BaseModel):
    content_id: str = Field(min_length=1, max_length=100)


@router.get("/question-collection/overview")
def question_collection_overview() -> dict:
    from app.services.questions import question_overview
    return question_overview()


@router.get("/questions")
def questions(q: str = "", category_id: int | None = None, pending_only: bool = False,
              page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100)) -> dict:
    from app.services.questions import list_questions
    return list_questions(q[:200], category_id, pending_only, page, page_size)


@router.get("/questions/{question_id}")
def question_detail(question_id: str) -> dict:
    from app.services.questions import get_question
    result = get_question(question_id)
    if not result:
        raise HTTPException(404, "话题不存在")
    return result


@router.patch("/questions/{question_id}/classification")
def question_classification(question_id: str, payload: ClassifyInput) -> dict:
    from app.services.questions import classify_question
    try:
        result = classify_question(question_id, payload.category_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if not result:
        raise HTTPException(404, "话题不存在")
    return result


@router.post("/questions/{question_id}/contents")
def add_question_content(question_id: str, payload: QuestionContentInput) -> dict:
    from app.services.questions import attach_article
    try:
        return attach_article(question_id, payload.content_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.delete("/questions/{question_id}/contents/{content_id}", status_code=204)
def remove_question_content(question_id: str, content_id: str) -> None:
    from app.services.questions import detach_article
    try:
        detach_article(question_id, content_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.post("/question-collection/backfill")
def question_backfill() -> dict:
    from app.services.questions import backfill
    return backfill()


@router.post("/question-classification/jobs", status_code=202)
async def start_question_classification() -> dict:
    from app.services.questions import question_classification_manager
    try:
        return await question_classification_manager.start()
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/question-classification/jobs")
def question_classification_jobs() -> list[dict]:
    with session() as db:
        return [dict(row) for row in db.execute("SELECT * FROM question_classification_jobs ORDER BY created_at DESC LIMIT 30")]


@router.get("/question-classification/jobs/{job_id}")
def question_classification_job(job_id: str) -> dict:
    from app.services.questions import question_classification_manager
    result = question_classification_manager.row(job_id)
    if not result:
        raise HTTPException(404, "任务不存在")
    return result


@router.post("/question-classification/jobs/{job_id}/cancel")
def cancel_question_classification(job_id: str) -> dict:
    from app.services.questions import question_classification_manager
    result = question_classification_manager.cancel(job_id)
    if not result:
        raise HTTPException(404, "任务不存在")
    return result


@router.post("/question-classification/jobs/{job_id}/retry", status_code=202)
async def retry_question_classification(job_id: str) -> dict:
    from app.services.questions import question_classification_manager
    try:
        return await question_classification_manager.start(job_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


class ManualQuestionLinkInput(BaseModel):
    question_url: str = Field(min_length=30, max_length=200)
    content_id: str = Field(min_length=1, max_length=100)


@router.post("/questions/manual-link", status_code=201)
def manual_question_link(payload: ManualQuestionLinkInput) -> dict:
    from app.services.questions import QUESTION_URL, attach_article
    match = QUESTION_URL.fullmatch(payload.question_url)
    if not match:
        raise HTTPException(400, "请输入标准知乎问题 HTTPS 链接")
    try:
        return attach_article(match.group(1), payload.content_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@router.post("/questions/{question_id}/resuggest")
def resuggest_question(question_id: str) -> dict:
    from app.services.questions import get_question
    if not get_question(question_id):
        raise HTTPException(404, "话题不存在")
    with session() as db:
        db.execute("""UPDATE questions SET classification_locked=0, classified_input_hash=NULL,
            classification_source='none', classification_reason='等待重新建议', updated_at=? WHERE id=?""",
            (now(), question_id))
    return get_question(question_id) or {}
