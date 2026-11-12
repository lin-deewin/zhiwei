"""Browser-level smoke validation against the temporary V3 preview server.

Run with ZHIWEI_E2E_URL=http://127.0.0.1:8765, after building frontend/dist.
Uses only synthetic CI data and never accesses a user's production library.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("ZHIWEI_E2E_URL", "http://127.0.0.1:8765")
CAPTURES = Path(os.environ.get("ZHIWEI_E2E_ARTIFACTS", "artifacts/browser-smoke"))


async def _wait_for_persisted_note(page, expected_title: str, timeout: float = 15) -> None:
    note_id = await page.evaluate("() => new URL(location.href).searchParams.get('note')")
    if not note_id:
        raise AssertionError("new personal note ID is missing from the URL")
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        matches = await page.evaluate(
            """async ({id, title}) => {
                const response = await fetch('/api/v1/personal-notes/' + encodeURIComponent(id),
                    {cache: 'no-store'});
                if (!response.ok) return false;
                const note = await response.json();
                return note.title === title && note.body_md.includes('浏览器验收的正文');
            }""",
            {"id": note_id, "title": expected_title},
        )
        if matches:
            return
        await asyncio.sleep(0.2)
    latest = await page.evaluate(
        """async (id) => {
            const response = await fetch('/api/v1/personal-notes/' + encodeURIComponent(id),
                {cache: 'no-store'});
            return response.ok ? await response.json() : {status: response.status};
        }""",
        note_id,
    )
    raise AssertionError(f"debounced autosave did not persist the expected content: {latest}")


async def _layout_check(page, label: str) -> None:
    measurements = await page.evaluate("""() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth
    })""")
    print(f"{label} viewport metrics: {measurements}", flush=True)
    assert measurements["document"] <= measurements["viewport"] + 8, (
        f"{label}: horizontal overflow exceeds 8px: {measurements}"
    )


async def _test_viewport(browser, name: str, width: int, height: int) -> None:
    context = await browser.new_context(
        viewport={"width": width, "height": height}, locale="zh-CN"
    )
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + "/", wait_until="domcontentloaded")
        await page.get_by_role("heading", name="全部文章").wait_for(timeout=20000)
        await page.get_by_text("V3 浏览器验收文章", exact=True).first.wait_for(timeout=20000)
        await _layout_check(page, name + "-library")
        await page.screenshot(path=str(CAPTURES / f"{name}-library.png"), full_page=True)

        await page.goto(BASE + "/personal-notes", wait_until="domcontentloaded")
        await page.get_by_role("heading", name="个人笔记", exact=True).first.wait_for()
        await page.get_by_role("button", name="新建个人笔记").first.click()
        title = page.get_by_placeholder("给这条笔记起个标题…")
        await title.wait_for(timeout=15000)
        note_title = f"{name} 浏览器验收笔记"
        await title.fill(note_title)
        await page.locator("textarea.personal-note-body").fill(
            "浏览器验收的正文：通过独立个人笔记保存自己的理解。"
        )
        # Assert the UI actually enters and leaves its debounced auto-save state.
        await page.wait_for_function(
            """() => document.querySelector('.personal-note-save-state')?.textContent === '修改将自动保存'""",
            timeout=5000,
        )
        await page.wait_for_function(
            """() => document.querySelector('.personal-note-save-state')?.textContent === '已保存'""",
            timeout=15000,
        )
        await _wait_for_persisted_note(page, note_title)
        print(f"{name} before reload: {page.url}", flush=True)
        await page.reload(wait_until="domcontentloaded")
        print(f"{name} after reload: {page.url}", flush=True)
        try:
            await page.wait_for_function(
                "(expected) => document.querySelector('input.personal-note-title')?.value === expected",
                arg=note_title, timeout=15000,
            )
        except Exception:
            diagnostics = await page.evaluate("""async () => {
                const id = new URL(location.href).searchParams.get('note');
                const response = id ? await fetch('/api/v1/personal-notes/' + id, {cache: 'no-store'}) : null;
                const item = response?.ok ? await response.json() : null;
                return {
                    url: location.href,
                    titleInput: document.querySelector('input.personal-note-title')?.value ?? null,
                    loading: document.querySelector('.personal-note-loading')?.textContent ?? null,
                    persisted: item ? {title:item.title, revision:item.revision, body:item.body_md.slice(0,100)} : null,
                    status: response?.status ?? null,
                    body: document.body.innerText.slice(0, 1200),
                };
            }""")
            print(f"{name} reload failure diagnostics: {diagnostics}, page errors: {errors}", flush=True)
            await page.screenshot(path=str(CAPTURES / f"{name}-reload-failure.png"), full_page=True)
            raise
        assert await page.get_by_placeholder("给这条笔记起个标题…").input_value() == note_title

        await page.get_by_role("button", name="卡片视图").click()
        await page.locator(".personal-notes-items.is-cards").wait_for()
        assert "view=cards" in page.url
        await _layout_check(page, name + "-notes")
        await page.screenshot(path=str(CAPTURES / f"{name}-personal-notes.png"), full_page=True)
        assert not errors, f"{name}: uncaught browser errors: {errors[:5]}"
        print(f"{name} viewport browser smoke passed", flush=True)
    finally:
        await context.close()


async def _test_reader(browser) -> None:
    content_id = os.environ.get("ZHIWEI_E2E_CONTENT_ID")
    if not content_id:
        raise AssertionError("CI did not provide ZHIWEI_E2E_CONTENT_ID")
    context = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        await page.goto(f"{BASE}/read/{content_id}", wait_until="domcontentloaded")
        await page.get_by_role("heading", name="V3 浏览器验收文章", exact=True).wait_for(timeout=20000)
        await page.locator("[data-reading-block-id]").first.wait_for(timeout=15000)

        # Save a non-zero reading position and verify restoration after reload.
        await page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        await asyncio.sleep(1.2)
        progress_response = await page.request.get(f"{BASE}/api/v1/contents/{content_id}/reading-progress")
        assert progress_response.ok, await progress_response.text()
        progress = await progress_response.json()
        assert progress["progress_ratio"] > 0.1 and progress["scroll_y"] > 0, progress
        await page.goto("about:blank")
        await page.goto(f"{BASE}/read/{content_id}", wait_until="domcontentloaded")
        await page.get_by_role("heading", name="V3 浏览器验收文章", exact=True).wait_for(timeout=20000)
        await page.wait_for_function("() => window.scrollY > 0", timeout=10000)

        # Select a real text node, then exercise highlight + comment persistence.
        await page.evaluate("window.scrollTo(0, 0)")
        await page.locator("[data-reading-block-id]").first.evaluate("""block => {
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
            const node = walker.nextNode();
            if (!node || !node.textContent?.trim()) throw new Error('reading block has no text node');
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, Math.min(18, node.textContent.length));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            block.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
        }""")
        await page.get_by_role("toolbar", name="选中文字操作").wait_for(timeout=10000)
        await page.get_by_label("批注内容").fill("V3 浏览器回归批注")
        await page.get_by_role("button", name="保存高亮与批注").click()
        await page.get_by_role("button", name="删除高亮").wait_for(timeout=10000)
        annotations_response = await page.request.get(f"{BASE}/api/v1/contents/{content_id}/annotations")
        assert annotations_response.ok, await annotations_response.text()
        annotations = await annotations_response.json()
        assert any(item.get("comment_md") == "V3 浏览器回归批注" for item in annotations), annotations

        # Create an article-scoped reading note and verify its debounced save.
        await page.get_by_role("button", name="新建笔记").click()
        await page.get_by_label("笔记标题").fill("V3 浏览器阅读笔记")
        await page.get_by_label("笔记正文").fill("这条笔记属于文章阅读记录，不是独立个人笔记。")
        await page.wait_for_function(
            "() => document.querySelector('.note-save-status')?.textContent === '未保存'",
            timeout=5000,
        )
        await page.wait_for_function(
            "() => document.querySelector('.note-save-status')?.textContent === '已保存'",
            timeout=10000,
        )
        reading_response = await page.request.get(f"{BASE}/api/v1/contents/{content_id}/reading-context")
        assert reading_response.ok, await reading_response.text()
        reading = await reading_response.json()
        assert any(note["title"] == "V3 浏览器阅读笔记" for note in reading["notes"]), reading["notes"]
        await page.screenshot(path=str(CAPTURES / "desktop-reader-workspace.png"), full_page=True)
        assert not errors, f"reader browser errors: {errors[:5]}"
        print("reader progress, annotation and note browser flow passed", flush=True)
    finally:
        await context.close()


async def _test_research_and_sync(browser) -> None:
    context = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + "/knowledge?tab=projects", wait_until="domcontentloaded")
        await page.get_by_role("heading", name="持续研究工作区").wait_for(timeout=20000)
        await page.get_by_label("项目名称").fill("V3 浏览器研究任务")
        await page.get_by_label("研究主问题").fill("这篇资料的主要论点和证据是什么？")
        search = page.get_by_placeholder("搜索资料标题或 ID")
        await search.fill("V3 浏览器验收文章")
        source_label = page.locator(".knowledge-directory label").filter(has_text="V3 浏览器验收文章").first
        await source_label.wait_for(timeout=10000)
        await source_label.locator("input").check()
        await page.get_by_role("button", name="创建并保存研究项目").click()
        await page.get_by_role("heading", name="V3 浏览器研究任务").wait_for(timeout=15000)
        await page.get_by_label("研究追问").fill("请用三点概括，并指出证据边界。")
        await page.get_by_role("button", name="基于证据集追问").click()
        await page.locator(".research-job-status strong").filter(has_text="研究任务失败").wait_for(timeout=15000)
        assert await page.get_by_role("alert").count() > 0, "missing safe AI configuration error"

        project_id = await page.evaluate("() => new URL(location.href).searchParams.get('project')")
        assert project_id
        jobs_response = await page.request.get(
            f"{BASE}/api/v1/knowledge/projects/{project_id}/jobs"
        )
        assert jobs_response.ok, await jobs_response.text()
        jobs = (await jobs_response.json())["items"]
        assert len(jobs) == 1 and jobs[0]["status"] == "failed", jobs
        assert jobs[0]["error_code"] == "AI_NOT_CONFIGURED", jobs[0]

        # Retry is a new durable job; the previous failure remains in history.
        await page.get_by_role("button", name="重新执行").click()
        retry_deadline = asyncio.get_running_loop().time() + 15
        retried_jobs = []
        while asyncio.get_running_loop().time() < retry_deadline:
            retry_response = await page.request.get(
                f"{BASE}/api/v1/knowledge/projects/{project_id}/jobs"
            )
            assert retry_response.ok, await retry_response.text()
            retried_jobs = (await retry_response.json())["items"]
            if len(retried_jobs) == 2 and retried_jobs[0]["status"] == "failed":
                break
            await asyncio.sleep(0.2)
        assert len(retried_jobs) == 2 and retried_jobs[0]["status"] == "failed", retried_jobs
        await page.reload(wait_until="domcontentloaded")
        await page.locator(".research-job-status strong").filter(has_text="研究任务失败").wait_for(timeout=15000)
        await page.screenshot(path=str(CAPTURES / "desktop-research-job.png"), full_page=True)

        await page.goto(BASE + "/sync", wait_until="domcontentloaded")
        await page.get_by_role("heading", name="同步中心").wait_for(timeout=15000)
        await page.get_by_role("button", name="登录知乎").wait_for(timeout=10000)
        await page.screenshot(path=str(CAPTURES / "desktop-sync-center.png"), full_page=True)
        assert not errors, f"research/sync browser errors: {errors[:5]}"
        print("research job failure/retry persistence and sync UI browser flow passed", flush=True)
    finally:
        await context.close()


async def main() -> None:
    CAPTURES.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            await _test_viewport(browser, "desktop", 1440, 900)
            await _test_viewport(browser, "mobile", 390, 844)
            await _test_reader(browser)
            await _test_research_and_sync(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
