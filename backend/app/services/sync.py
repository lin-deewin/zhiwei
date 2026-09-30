from __future__ import annotations

import asyncio
import json
import re
import uuid

import httpx

from app.core.database import session
from app.services.library import now
from app.services.zhihu_account import active_account
from app.services.zhihu_browser import ZhihuAuthError, ZhihuBrowser, ZhihuFetchError
from app.services.zhihu_content import UnsupportedContent, save_favorite
from app.services.zhihu_qr import ZhihuQrLogin


def _account() -> ZhihuQrLogin | ZhihuBrowser:
    return active_account()


Account = ZhihuQrLogin | ZhihuBrowser


def _job(job_id: str) -> dict | None:
    with session() as db:
        row = db.execute("SELECT * FROM sync_jobs WHERE id=?", (job_id,)).fetchone()
        return dict(row) if row else None


def _update_job(job_id: str, **changes: object) -> None:
    if not changes:
        return
    changes["updated_at"] = now()
    columns = ", ".join(f"{key}=?" for key in changes)
    with session() as db:
        db.execute(f"UPDATE sync_jobs SET {columns} WHERE id=?", (*changes.values(), job_id))


class SyncManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._active_id: str | None = None
        self._cancel_requested = False

    def recover_interrupted(self) -> None:
        with session() as db:
            db.execute(
                """UPDATE sync_jobs SET status='interrupted',phase='interrupted',
                   message='服务已重启；已保存的文章仍在，可重新开始同步',updated_at=?
                   WHERE status IN ('queued','running')""",
                (now(),),
            )

    async def _request(self, path: str, account: Account) -> dict:
        for attempt in range(3):
            try:
                return await account.get_json(path)
            except ZhihuFetchError:
                if attempt == 2:
                    raise
                await asyncio.sleep(2 ** (attempt + 1))
        raise RuntimeError("无法读取知乎数据")

    async def _complete_item(self, item: dict, account: Account) -> dict:
        content = item.get("content")
        if not isinstance(content, dict):
            return item
        kind = content.get("type")
        remote_id = str(content.get("id") or "")
        if kind not in {"article", "answer"} or not re.fullmatch(r"\d{1,30}", remote_id):
            return item
        if isinstance(content.get("content"), str) and content["content"].strip():
            return item
        path = f"/api/v4/{'articles' if kind == 'article' else 'answers'}/{remote_id}"
        detail = await self._request(path, account)
        if (detail.get("id") is not None and str(detail["id"]) != remote_id) or (
            detail.get("type") is not None and detail["type"] != kind
        ):
            raise ZhihuFetchError("知乎正文与收藏条目的标识不一致")
        return {**item, "content": {**content, **detail}}

    async def refresh_folders(self, source: Account | None = None) -> list[dict]:
        source = source or _account()
        account_status = source.status()
        profile = account_status.get("profile") or {}
        url_token = profile.get("url_token") or ""
        if account_status["status"] != "connected" or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,100}", url_token
        ):
            raise ZhihuAuthError("请先验证知乎账号")
        folders: list[dict] = []
        offset = 0
        while True:
            body = await self._request(
                f"/api/v4/members/{url_token}/favlists?offset={offset}&limit=20", source
            )
            data = body.get("data")
            paging = body.get("paging")
            if not isinstance(data, list) or not isinstance(paging, dict):
                raise ZhihuFetchError("知乎收藏夹列表格式已变化")
            for entry in data:
                if not isinstance(entry, dict):
                    continue
                remote_id = str(entry.get("id") or "")
                if not re.fullmatch(r"\d{1,30}", remote_id):
                    continue
                folders.append({
                    "id": remote_id,
                    "name": str(entry.get("title") or "未命名收藏夹")[:200],
                    "url": f"https://www.zhihu.com/collection/{remote_id}",
                })
            if paging.get("is_end"):
                break
            if not data or offset >= 1000:
                raise ZhihuFetchError("收藏夹分页未正常结束")
            offset += len(data)
            await asyncio.sleep(0.4)
        with session() as db:
            for folder in folders:
                db.execute(
                    """INSERT INTO folders(id,remote_id,name,url,scan_status)
                       VALUES (?,?,?,?,'unknown') ON CONFLICT(id) DO UPDATE SET
                       name=excluded.name,url=excluded.url""",
                    (folder["id"], folder["id"], folder["name"], folder["url"]),
                )
        return folders

    async def start(self, mode: str, folder_ids: list[str] | None = None) -> dict:
        if mode not in {"full", "incremental"}:
            raise ValueError("同步方式只能是 full 或 incremental")
        if folder_ids and any(not re.fullmatch(r"\d{1,30}", value) for value in folder_ids):
            raise ValueError("收藏夹 ID 不正确")
        async with self._lock:
            if self._task and not self._task.done():
                raise RuntimeError("已有同步任务正在运行")
            source = _account()
            if source.status()["status"] != "connected":
                raise ZhihuAuthError("请先验证知乎账号")
            job_id = uuid.uuid4().hex
            timestamp = now()
            with session() as db:
                db.execute(
                    """INSERT INTO sync_jobs(id,mode,status,phase,folder_ids,message,created_at,updated_at)
                       VALUES (?,?, 'queued','queued',?,?,?,?)""",
                    (job_id, mode, json.dumps(folder_ids or []), "等待读取收藏夹", timestamp, timestamp),
                )
            self._active_id = job_id
            self._cancel_requested = False
            self._task = asyncio.create_task(self._run(job_id, mode, folder_ids or [], source))
            return _job(job_id) or {}

    def cancel(self, job_id: str) -> dict | None:
        row = _job(job_id)
        if row and self._active_id == job_id and row["status"] in {"queued", "running"}:
            self._cancel_requested = True
            _update_job(job_id, message="正在完成当前条目后取消")
            return _job(job_id)
        return row

    async def _run(self, job_id: str, mode: str, selected: list[str], source: Account) -> None:
        scanned = 0
        downloaded = 0
        failed = 0
        unsupported = 0
        total = 0
        sync_started = (_job(job_id) or {}).get("created_at") or now()
        try:
            _update_job(job_id, status="running", phase="folders", message="正在读取收藏夹")
            folders = await self.refresh_folders(source)
            if selected:
                known = {folder["id"] for folder in folders}
                if not set(selected).issubset(known):
                    raise ValueError("所选收藏夹不存在或无权访问")
                folders = [folder for folder in folders if folder["id"] in selected]
            _update_job(job_id, phase="scanning", folder_ids=json.dumps([f["id"] for f in folders]),
                        message=f"找到 {len(folders)} 个收藏夹，开始扫描")
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as image_client:
                for folder in folders:
                    if self._cancel_requested:
                        break
                    folder_id = folder["id"]
                    with session() as db:
                        db.execute("UPDATE folders SET scan_status='scanning' WHERE id=?", (folder_id,))
                    offset = 0
                    first_page = True
                    try:
                        while True:
                            if self._cancel_requested:
                                break
                            body = await self._request(
                                f"/api/v4/collections/{folder_id}/items?offset={offset}&limit=20", source
                            )
                            data = body.get("data")
                            paging = body.get("paging")
                            if not isinstance(data, list) or not isinstance(paging, dict):
                                raise ZhihuFetchError("收藏条目分页格式已变化")
                            if first_page:
                                first_page = False
                                total += max(int(paging.get("totals") or len(data)), len(data))
                                _update_job(job_id, total=total)
                            for item in data:
                                if self._cancel_requested:
                                    break
                                scanned += 1
                                try:
                                    result = await save_favorite(
                                        await self._complete_item(item, source), folder_id,
                                        sync_started, image_client
                                    )
                                    if result in {"new", "updated", "partial"}:
                                        downloaded += 1
                                    elif result == "conflict":
                                        failed += 1
                                except UnsupportedContent:
                                    unsupported += 1
                                except (ValueError, TypeError):
                                    failed += 1
                                if scanned % 5 == 0:
                                    _update_job(
                                        job_id, scanned=scanned, downloaded=downloaded,
                                        failed=failed,
                                        message=f"已扫描 {scanned} 条，保存 {downloaded} 条，跳过 {unsupported} 条",
                                    )
                            if self._cancel_requested or paging.get("is_end"):
                                break
                            if not data or offset >= 100000:
                                raise ZhihuFetchError("收藏条目分页未正常结束")
                            offset += len(data)
                            await asyncio.sleep(0.5)
                        if self._cancel_requested:
                            break
                        with session() as db:
                            db.execute(
                                """UPDATE folders SET scan_status='complete',last_scanned_at=?
                                   WHERE id=?""", (now(), folder_id),
                            )
                            if mode == "full":
                                db.execute(
                                    """UPDATE folder_contents SET source_status='not_in_remote'
                                       WHERE folder_id=? AND source_status='active' AND last_seen_at<?""",
                                    (folder_id, sync_started),
                                )
                    except Exception:
                        with session() as db:
                            db.execute("UPDATE folders SET scan_status='failed' WHERE id=?", (folder_id,))
                        raise
            status = "cancelled" if self._cancel_requested else ("partial" if failed else "completed")
            _update_job(job_id, status=status, phase=status, total=total, scanned=scanned,
                        downloaded=downloaded, failed=failed,
                        message=f"扫描 {scanned} 条，保存 {downloaded} 条，跳过 {unsupported} 条，失败 {failed} 条")
        except ZhihuAuthError as error:
            _update_job(job_id, status="auth_required", phase="stopped", scanned=scanned,
                        downloaded=downloaded, failed=failed, message=str(error))
        except Exception as error:  # noqa: BLE001 - persist unexpected background failures
            _update_job(job_id, status="failed", phase="stopped", scanned=scanned,
                        downloaded=downloaded, failed=failed,
                        message=f"同步中断：{type(error).__name__}：{str(error)[:200]}")
        finally:
            self._active_id = None
            self._task = None


sync_manager = SyncManager()
