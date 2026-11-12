from __future__ import annotations

import asyncio

import httpx
from fastapi import FastAPI

from app.api.workspace_routes import router
from app.services import knowledge, research_jobs, research_workspace
from app.services.library import import_markdown


def _project(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    article = import_markdown("source.md", "# 研究来源\n\n长期观察比短期猜测更可靠。".encode())
    return research_workspace.create(
        "长期观察", "如何研究证据？", ["article:" + article["id"]]
    )


def test_background_job_completes_and_preserves_evidence(monkeypatch, tmp_path):
    project = _project(monkeypatch, tmp_path)

    async def generate(*args, **kwargs):
        await asyncio.sleep(0.01)
        return "结论须有来源 [S1]"

    monkeypatch.setattr(knowledge, "grounded_answer", generate)
    application = FastAPI()
    application.include_router(router)

    async def flow():
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            prefix = f"/api/v1/knowledge/projects/{project['id']}/jobs"
            created = await client.post(
                prefix, json={"question": "证据是否足够？", "revision": project["revision"]}
            )
            assert created.status_code == 202, created.text
            job_id = created.json()["id"]
            statuses = []
            for _ in range(100):
                current = await client.get(f"{prefix}/{job_id}")
                statuses.append(current.json()["status"])
                if current.json()["status"] in {"completed", "failed"}:
                    break
                await asyncio.sleep(0.01)
            assert current.json()["status"] == "completed", current.json()
            assert len(current.json()["result"]["project"]["turns"]) == 1
            assert current.json()["result"]["project"]["turns"][0]["sources"][0]["content_hash"]
            listed = await client.get(prefix)
            assert listed.status_code == 200
            assert listed.json()["items"][0]["id"] == job_id
            assert (await client.post(f"{prefix}/{job_id}/retry")).status_code == 409
            assert (await client.post(prefix, json={
                "question": "过期版本", "revision": project["revision"]
            })).status_code == 409

    asyncio.run(flow())


def test_background_job_can_cancel_and_retry(monkeypatch, tmp_path):
    project = _project(monkeypatch, tmp_path)
    entered = asyncio.Event()

    async def waiting(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(knowledge, "grounded_answer", waiting)
    application = FastAPI()
    application.include_router(router)

    async def flow():
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            prefix = f"/api/v1/knowledge/projects/{project['id']}/jobs"
            start = await client.post(prefix, json={
                "question": "需要等待的研究", "revision": project["revision"],
                "research": True,
            })
            assert start.status_code == 202, start.text
            job_id = start.json()["id"]
            await asyncio.wait_for(entered.wait(), timeout=3)
            cancelled = await client.post(f"{prefix}/{job_id}/cancel")
            assert cancelled.status_code == 200
            assert cancelled.json()["status"] == "cancelled"
            await asyncio.sleep(0)
            assert (await client.get(f"{prefix}/{job_id}")).json()["status"] == "cancelled"

            async def fast(*args, **kwargs):
                return "重新生成的研究结果 [S1]"
            monkeypatch.setattr(knowledge, "grounded_answer", fast)
            retried = await client.post(f"{prefix}/{job_id}/retry")
            assert retried.status_code == 202, retried.text
            new_id = retried.json()["id"]
            assert new_id != job_id
            for _ in range(100):
                current = await client.get(f"{prefix}/{new_id}")
                if current.json()["status"] in {"completed", "failed"}:
                    break
                await asyncio.sleep(0.01)
            assert current.json()["status"] == "completed", current.json()
            assert current.json()["result"]["note_id"]
            assert (await client.get(f"{prefix}/{job_id}")).json()["status"] == "cancelled"

    asyncio.run(flow())


def test_recover_interrupted_research_jobs(monkeypatch, tmp_path):
    project = _project(monkeypatch, tmp_path)
    created = research_jobs.enqueue(
        project["id"], "检查中断状态", project["revision"], False
    )
    manager = research_jobs.ResearchJobManager()
    manager.recover()
    interrupted = research_jobs.get_job(project["id"], created["id"])
    assert interrupted["status"] == "interrupted"
    assert interrupted["result"] is None
