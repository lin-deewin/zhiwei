from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

from app.api.knowledge_routes import router as knowledge_router
from app.api.semantic_routes import router as semantic_router
from app.api.graph_routes import router as graph_router
from app.api.workspace_routes import router as workspace_router
from app.api.markdown_routes import router as markdown_router
from app.api.reading_routes import router as reading_router
from app.api.personal_note_routes import router as personal_note_router
from app.api.routes import router
from app.core.database import connect
from app.services.classification import classification_manager
from app.services.questions import backfill, question_classification_manager
from app.services.reading_workspace import reading_ai_manager
from app.services.research_jobs import research_job_manager
from app.services.sync import sync_manager
from app.services.semantic import semantic_manager
from app.services.zhihu_browser import zhihu_browser
from app.services.zhihu_login import zhihu_login
from app.services.zhihu_qr import zhihu_qr
from app.services.zhihu_session import load_session

REMOTE_ACCESS = os.environ.get("ZHILIB_ALLOW_REMOTE", "").lower() in {"1", "true", "yes"}
LOCAL_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
REMOTE_ORIGINS = {
    origin.strip() for origin in os.environ.get("ZHILIB_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
} if REMOTE_ACCESS else set()
logger = logging.getLogger(__name__)


async def restore_browser_session() -> None:
    """Check a saved browser session before claiming that an account is connected."""
    await asyncio.to_thread(zhihu_qr.validate_saved)
    saved = load_session()
    if not saved and not os.environ.get("ZHILIB_CHROME_CDP_URL"):
        return
    try:
        if saved:
            await zhihu_browser.restore_saved()
        else:
            status = await zhihu_browser.connect()
            if status["status"] == "awaiting_login":
                await zhihu_browser.verify()
    except (OSError, RuntimeError, TimeoutError) as error:
        logger.warning("Zhihu browser session restoration failed: %s", type(error).__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = connect()
    db.close()
    semantic_manager.recover()
    sync_manager.recover_interrupted()
    classification_manager.recover_interrupted()
    question_classification_manager.recover_interrupted()
    reading_ai_manager.recover()
    research_job_manager.recover()
    await asyncio.to_thread(backfill)
    async def maintain_semantic():
        from app.services.semantic import status
        while True:
            await asyncio.sleep(120)
            try:
                if status()["job"]:
                    await semantic_manager.start()
                from app.services import markdown_sync
                if markdown_sync.configuration()["auto_sync"]:
                    await asyncio.to_thread(markdown_sync.sync_safe)
            except Exception:  # noqa: BLE001 - keep periodic maintenance alive without private logs
                logger.warning("Knowledge maintenance failed; inspect index status and Markdown preview")
    index_task = asyncio.create_task(maintain_semantic())
    restore_task = asyncio.create_task(restore_browser_session())
    yield
    index_task.cancel()
    try:
        await index_task
    except asyncio.CancelledError:
        pass
    await semantic_manager.shutdown()
    await reading_ai_manager.shutdown()
    await research_job_manager.shutdown()
    if not restore_task.done():
        restore_task.cancel()
        try:
            await restore_task
        except asyncio.CancelledError:
            pass
    await zhihu_login.close()
    await zhihu_browser.close()


app = FastAPI(title="知微 · 知乎收藏知识库", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(LOCAL_ORIGINS | REMOTE_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Zhilib-Login-Token"],
)
app.include_router(router)
app.include_router(reading_router)
app.include_router(personal_note_router)
app.include_router(knowledge_router)
app.include_router(semantic_router)
app.include_router(graph_router)
app.include_router(markdown_router)
app.include_router(workspace_router)


@app.middleware("http")
async def local_request_guard(request: Request, call_next):
    host = request.url.hostname
    if not REMOTE_ACCESS and host not in {"localhost", "127.0.0.1", "::1"}:
        from fastapi.responses import PlainTextResponse

        return PlainTextResponse("Local requests only", status_code=403)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        allowed = LOCAL_ORIGINS | REMOTE_ORIGINS | {
            f"{request.url.scheme}://{request.url.netloc}"
        }
        if origin and origin not in allowed:
            from fastapi.responses import PlainTextResponse

            return PlainTextResponse("Cross-origin request rejected", status_code=403)
    return await call_next(request)


@app.api_route("/api/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
               include_in_schema=False)
def missing_api_route():
    # Unknown API paths must never fall through to the SPA's index.html.
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=404, content={"detail": "接口不存在，请确认后端已更新并重启。"})


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.is_dir():
    class SpaStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as error:
                if error.status_code != 404:
                    raise
                return await super().get_response("index.html", scope)

    app.mount("/", SpaStaticFiles(directory=frontend_dist, html=True), name="frontend")
