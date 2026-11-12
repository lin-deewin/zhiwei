"""Browser regression against an explicitly isolated local test library."""

import asyncio
import os
from playwright.async_api import async_playwright, expect


async def main():
    if os.environ.get("ZHILIB_UI_TEST_ALLOW_MUTATION") != "1":
        raise SystemExit(
            "Use an isolated test library and set ZHILIB_UI_TEST_ALLOW_MUTATION=1"
        )
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_default_timeout(15000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto("http://127.0.0.1:5173/")
        data = await page.request.post(
            "http://127.0.0.1:8010/api/v1/imports/markdown",
            multipart={
                "file": {
                    "name": "astryx-qa.md",
                    "mimeType": "text/markdown",
                    "buffer": (
                        "# Astryx 验证文章\n\n"
                        + (
                            "\n\n这是一段用于验证阅读进度、高亮锚点和中文排版的测试正文。"
                            * 60
                        )
                    ).encode(),
                }
            },
        )
        assert data.ok, await data.text()
        article = await data.json()
        print("import", article["id"])
        await page.goto("http://127.0.0.1:5173/read/" + article["id"])
        await page.wait_for_timeout(500)
        await expect(
            page.get_by_role("heading", name="Astryx 验证文章").first
        ).to_be_visible()
        await page.get_by_role("button", name="稍后阅读", exact=True).click()
        await expect(
            page.get_by_role("button", name="已加入稍后阅读", exact=True)
        ).to_be_visible()
        await page.get_by_role("button", name="删除文章", exact=True).click()
        await expect(page.get_by_role("dialog")).to_be_visible()
        await page.get_by_role("button", name="暂不删除", exact=True).click()
        await expect(page.get_by_role("dialog")).not_to_be_visible()
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight/2)")
        await page.wait_for_timeout(900)
        await page.get_by_role("link", name="个人笔记", exact=True).first.click()
        await page.get_by_role("button", name="新建个人笔记", exact=True).first.click()
        await page.get_by_role("textbox", name="给这条笔记起个标题…").fill(
            "Astryx 测试笔记"
        )
        body = page.locator("textarea").first
        await body.fill("测试正文与来源保留。")
        await page.get_by_role("button", name="立即保存", exact=True).click()
        await page.wait_for_timeout(400)
        await page.get_by_role("button", name="删除笔记", exact=True).click()
        await expect(page.get_by_role("dialog")).to_be_visible()
        await page.get_by_role("button", name="返回", exact=True).click()
        await expect(body).to_have_value("测试正文与来源保留。")
        await page.get_by_role("button", name="切换到护眼主题", exact=True).click()
        await expect(
            page.get_by_role("button", name="切换到浅色主题", exact=True)
        ).to_be_visible()
        for width in (360, 390, 768, 1024, 1440):
            await page.set_viewport_size({"width": width, "height": 900})
            for route in (
                "/",
                "/overview",
                "/reading",
                "/notes",
                "/personal-notes",
                "/questions",
                "/categories",
                "/sync",
                "/settings",
                "/ask",
                "/knowledge?tab=assistant",
                "/knowledge?tab=topics",
                "/knowledge?tab=projects",
                "/knowledge?tab=markdown",
            ):
                await page.goto("http://127.0.0.1:5173" + route)
                await page.wait_for_timeout(200)
                assert not await page.evaluate(
                    "document.documentElement.scrollWidth > innerWidth + 2"
                ), (route, width)
        assert not errors, errors
        print(
            "PASS: import, reader, read later, dialog cancel, note save, delete cancel, themes; no runtime errors"
        )
        await browser.close()


asyncio.run(main())
