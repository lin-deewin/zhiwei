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
        # Wait for the debounced auto-save to reach the backend before reload.
        await page.wait_for_function(
            """async (expectedTitle) => {
                const id = new URL(location.href).searchParams.get('note');
                if (!id) return false;
                const response = await fetch('/api/v1/personal-notes/' + encodeURIComponent(id));
                if (!response.ok) return false;
                const note = await response.json();
                return note.title === expectedTitle
                    && note.body_md.includes('浏览器验收的正文');
            }""",
            arg=note_title,
            timeout=15000,
        )
        await page.reload(wait_until="domcontentloaded")
        await page.get_by_placeholder("给这条笔记起个标题…").wait_for(timeout=15000)
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


async def main() -> None:
    CAPTURES.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            await _test_viewport(browser, "desktop", 1440, 900)
            await _test_viewport(browser, "mobile", 390, 844)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
