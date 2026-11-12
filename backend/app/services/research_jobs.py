from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path

import httpx

from app.core.config import get_library_dir, library_scope
from app.core.database import session
from app.services import research_workspace
from app.services.ai import AIRequestError
from app.services.library import now

logger = logging.getLogger(__name__)

ACTIVE = {"pending", "running"}
RETRYABLE = {"failed", "cancelled", "interrupted"}


def _row(row) -> dict:
    value = dict(row)
    value["research"] = bool(value["research"])
    value["result"] = json.loads(value.pop("result_json")) if value.get("result_json") else None
    return value


def get_job(project_id: str, job_id: str, library: Path | None = None) -> dict:
    with session(library) as db:
        row = db.execute(
            "SELECT * FROM research_jobs WHERE project_id=? AND id=?",
            (project_id, job_id),
        ).fetchone()
        if row is None:
            raise LookupError("研究任务不存在")
        return _row(row)


def list_jobs(project_id: str, limit: int = 10) -> dict:
    limit = min(max(1, limit), 50)
    with session() as db:
        if not db.execute("SELECT 1 FROM research_projects WHERE id=?", (project_id,)).fetchone():
            raise LookupError("研究项目不存在")
        rows = db.execute(
            "SELECT * FROM research_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT ?",
            (project_id, limit),
        ).fetchall()
    return {"items": [_row(row) for row in rows]}


def enqueue(project_id: str, question: str, revision: int, research: bool) -> dict:
    question = question.strip()
    if not 2 <= len(question) <= 2000:
        raise ValueError("研究问题长度必须在 2–2000 字之间")
    if revision < 1:
        raise ValueError("研究项目版本无效")
    library = get_library_dir().resolve()
    timestamp, job_id = now(), uuid.uuid4().hex
    with session(library) as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute(
            "SELECT revision FROM research_projects WHERE id=?", (project_id,)
        ).fetchone()
        if current is None:
            raise LookupError("研究项目不存在")
        if current["revision"] != revision:
            raise ValueError("研究项目已修改，请刷新后再操作")
        if db.execute(
            "SELECT 1 FROM research_jobs WHERE project_id=? AND status IN ('pending','running')",
            (project_id,),
        ).fetchone():
            raise RuntimeError("该研究项目已有执行中的任务，请等待或取消")
        db.execute(
            """INSERT INTO research_jobs
               (id,project_id,question,project_revision,research,status,stage,created_at,updated_at)
               VALUES (?,?,?,?,?,'pending','queued',?,?)""",
            (job_id, project_id, question, revision, int(research), timestamp, timestamp),
        )
    return get_job(project_id, job_id, library)


def _change(job_id: str, library: Path, status: str, stage: str,
            result: dict | None = None, error_code: str | None = None,
            error_message: str | None = None) -> bool:
    with session(library) as db:
        changed = db.execute(
            """UPDATE research_jobs SET status=?,stage=?,result_json=?,error_code=?,
               error_message=?,updated_at=?
               WHERE id=? AND status IN ('pending','running')""",
            (status, stage, json.dumps(result, ensure_ascii=False) if result else None,
             error_code, error_message, now(), job_id),
        ).rowcount
    return bool(changed)


def _safe_failure(error: Exception) -> tuple[str, str]:
    if isinstance(error, AIRequestError):
        return "MODEL_ERROR", str(error)[:350]
    if isinstance(error, httpx.TimeoutException):
        return "MODEL_TIMEOUT", "模型响应超时，请稍后重试"
    if isinstance(error, ValueError):
        message = str(error)
        if message in {"AI_NOT_CONFIGURED", "模型未配置"}:
            return "AI_NOT_CONFIGURED", "未配置 AI 模型，请先在设置中配置"
        if any(fragment in message for fragment in
               ("研究项目已修改", "证据集或对话已修改", "资料库已切换")):
            return "STALE_EVIDENCE", "研究证据或项目版本发生变化，请刷新项目后重试"
    return "RESEARCH_FAILED", "研究任务执行失败，请检查模型服务并重试"


class ResearchJobManager:
    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}

    def recover(self) -> None:
        with session() as db:
            db.execute(
                """UPDATE research_jobs SET status='interrupted',stage='interrupted',updated_at=?
                   WHERE status IN ('pending','running')""",
                (now(),),
            )

    def start(self, job: dict, library: Path | None = None) -> None:
        target = (library or get_library_dir()).resolve()
        if job["id"] in self._tasks and not self._tasks[job["id"]].done():
            return
        task = asyncio.create_task(self._execute(job["id"], job["project_id"], target))
        self._tasks[job["id"]] = task
        task.add_done_callback(lambda finished, key=job["id"]: self._tasks.pop(key, None))

    async def _execute(self, job_id: str, project_id: str, library: Path) -> None:
        with library_scope(library):
            try:
                if not _change(job_id, library, "running", "generating"):
                    return
                job = get_job(project_id, job_id, library)
                result = await research_workspace.ask(
                    project_id, job["question"], job["project_revision"], job["research"]
                )
                _change(job_id, library, "completed", "completed", result=result)
            except asyncio.CancelledError:
                _change(job_id, library, "cancelled", "cancelled")
                raise
            except Exception as error:  # noqa: BLE001 - don't expose credentials/provider payloads
                code, message = _safe_failure(error)
                _change(job_id, library, "failed", "failed",
                        error_code=code, error_message=message)
                logger.warning("Research job failed: %s", code)

    def cancel(self, project_id: str, job_id: str) -> dict:
        library = get_library_dir().resolve()
        existing = get_job(project_id, job_id, library)
        if existing["status"] in ACTIVE:
            _change(job_id, library, "cancelled", "cancelled")
            task = self._tasks.get(job_id)
            if task and not task.done():
                task.cancel()
        return get_job(project_id, job_id, library)

    def retry(self, project_id: str, job_id: str) -> dict:
        previous = get_job(project_id, job_id)
        if previous["status"] not in RETRYABLE:
            raise ValueError("只有失败、中断或取消的任务可以重试")
        created = enqueue(project_id, previous["question"], previous["project_revision"],
                          previous["research"])
        self.start(created)
        return created

    async def shutdown(self) -> None:
        tasks = list(self._tasks.items())
        for job_id, task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)
        self.recover()


research_job_manager = ResearchJobManager()
