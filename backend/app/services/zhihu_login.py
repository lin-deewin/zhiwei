from __future__ import annotations

import asyncio
import base64
import secrets
import time
from urllib.parse import urlparse

from playwright.async_api import Error as PlaywrightError

from app.core.tenancy import ScopedService
from app.services.zhihu_browser import zhihu_browser

QR_SELECTORS = (
    "img[src*='qrcode'], img[alt*='二维码'], "
    "[class*='QRCode'] img, [class*='Qrcode'] img, [class*='qrcode'] img, "
    "[class*='QRCode'] canvas, [class*='Qrcode'] canvas, [class*='qrcode'] canvas"
)
CHALLENGE_PATHS = ("/account/unhuman", "/captcha", "/challenge")


def _login_page_allowed(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    return (host == "zhihu.com" or host.endswith(".zhihu.com")) and (
        parsed.path == "/signin" or parsed.path.startswith("/account/")
        or parsed.path.startswith("/captcha") or parsed.path.startswith("/challenge")
    )


class LoginConflict(RuntimeError):
    pass


class LoginDenied(RuntimeError):
    pass


class ZhihuLoginManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._id: str | None = None
        self._request_id: str | None = None
        self._token: str | None = None
        self._state = "cancelled"
        self._message = ""
        self._revision = 0
        self._document_revision = 0
        self._last_url = ""
        self._frame_mode = "page"
        self._expires_at = 0.0
        self._task: asyncio.Task | None = None
        self._last_verify = 0.0
        self._input_window = 0.0
        self._input_count = 0

    def _set_state(self, state: str, message: str) -> None:
        if state != self._state or message != self._message:
            self._revision += 1
        self._state = state
        self._message = message

    def _snapshot(self) -> dict:
        return {
            "login_id": self._id,
            "state": self._state,
            "revision": self._revision,
            "message": self._message,
            "expires_at": self._expires_at,
            "qr_expires_at": None,
            "frame_mode": self._frame_mode,
            "can_refresh": self._state in {"qr_ready", "expired", "challenge_required"},
        }

    def require_owner(self, login_id: str, token: str | None) -> None:
        if not (self._id == login_id and token and self._token
                and secrets.compare_digest(token, self._token)):
            raise LoginDenied("登录任务不存在或控制令牌无效")

    async def start(self, request_id: str) -> dict:
        async with self._lock:
            if self._id and self._state not in {"expired", "failed", "cancelled", "connected"}:
                if self._request_id == request_id:
                    return {**self._snapshot(), "control_token": self._token}
                raise LoginConflict("已有登录任务正在进行，请回到原来的登录窗口")
            if zhihu_browser.status()["status"] == "connected":
                return {"state": "connected", "message": "知乎账号已连接", "login_id": None}
            if self._task:
                self._task.cancel()
                self._task = None
            await zhihu_browser.close()
            self._id = secrets.token_urlsafe(18)
            self._request_id = request_id
            self._token = secrets.token_urlsafe(32)
            self._expires_at = time.time() + 600
            self._document_revision += 1
            self._last_url = ""
            self._last_verify = 0
            self._set_state("starting", "正在打开知乎登录页面")
            login_id = self._id
            token = self._token
        try:
            result = await zhihu_browser.connect(virtual_display=True)
            if result["status"] == "unavailable":
                async with self._lock:
                    if self._id == login_id:
                        self._set_state("failed", result["message"])
                        return {**self._snapshot(), "control_token": token}
                raise LoginDenied("登录任务已取消")
        except (OSError, RuntimeError, PlaywrightError) as error:
            async with self._lock:
                if self._id == login_id:
                    self._set_state("failed", f"无法启动知乎登录页面：{type(error).__name__}")
                    return {**self._snapshot(), "control_token": token}
            raise
        async with self._lock:
            if self._id != login_id:
                await zhihu_browser.close()
                raise LoginDenied("登录任务已取消")
            self._task = asyncio.create_task(self._watch(login_id))
            return {**self._snapshot(), "control_token": token}

    async def _watch(self, login_id: str) -> None:
        try:
            while self._id == login_id and self._state not in {"connected", "cancelled", "failed"}:
                if time.time() >= self._expires_at:
                    self._set_state("expired", "登录已超时，请重新开始")
                    return
                page = zhihu_browser._page
                if not page or page.is_closed():
                    self._set_state("failed", "知乎登录页面已关闭，请重新开始")
                    return
                url = page.url
                host = urlparse(url).hostname or ""
                if host != "zhihu.com" and not host.endswith(".zhihu.com"):
                    self._set_state("failed", "登录页面离开知乎，请重新开始")
                    return
                if url != self._last_url:
                    self._last_url = url
                    self._document_revision += 1
                challenge = any(part in urlparse(url).path for part in CHALLENGE_PATHS)
                if not _login_page_allowed(url):
                    self._frame_mode = "page"
                    self._set_state("starting", "知乎页面正在跳转，正在校验账号")
                elif challenge:
                    self._frame_mode = "page"
                    self._set_state("challenge_required", "知乎要求安全验证，请在下方画面完成")
                else:
                    qr = await self._visible_qr(page)
                    if qr:
                        self._frame_mode = "qr"
                        self._set_state("qr_ready", "请用知乎 App 扫码，并在手机上确认")
                    else:
                        self._frame_mode = "page"
                        self._set_state("challenge_required", "请在下方画面选择扫码登录或完成知乎验证")
                if time.monotonic() - self._last_verify >= 5:
                    self._last_verify = time.monotonic()
                    result = await zhihu_browser.verify()
                    if result["status"] == "connected":
                        self._set_state("connected", result["message"])
                        return
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            raise
        except PlaywrightError:
            if self._id == login_id:
                self._set_state("starting", "知乎页面正在切换，请稍候")
                await asyncio.sleep(2)
                if self._id == login_id:
                    self._task = asyncio.create_task(self._watch(login_id))
        except (OSError, RuntimeError, ValueError, TypeError):
            if self._id == login_id:
                self._set_state("failed", "知乎登录页面暂时无法读取，请重新开始")

    def status(self, login_id: str, token: str | None) -> dict:
        self.require_owner(login_id, token)
        return self._snapshot()

    async def _visible_qr(self, page):
        for selector in QR_SELECTORS.split(", "):
            locator = page.locator(selector)
            for index in range(min(await locator.count(), 5)):
                candidate = locator.nth(index)
                if await candidate.is_visible(timeout=1000):
                    return candidate
        return None

    async def frame(self, login_id: str, token: str | None) -> dict:
        self.require_owner(login_id, token)
        page = zhihu_browser._page
        if self._state not in {"qr_ready", "challenge_required"} or not page or page.is_closed():
            raise LoginConflict("当前没有可显示的登录画面")
        if not _login_page_allowed(page.url):
            raise LoginConflict("登录页面已经跳转，请等待账号校验")
        if self._frame_mode == "qr":
            qr = await self._visible_qr(page)
            if qr is None:
                raise LoginConflict("二维码已变化，请稍后刷新")
            image = await qr.screenshot(timeout=5000)
            width = height = 0
        else:
            image = await page.screenshot(timeout=5000)
            width, height = 1280, 900
        return {
            "frame_id": self._document_revision,
            "image_data_url": "data:image/png;base64," + base64.b64encode(image).decode("ascii"),
            "frame_mode": self._frame_mode,
            "viewport_width": width, "viewport_height": height,
        }

    async def input(self, login_id: str, token: str | None, frame_id: int,
                    events: list[dict]) -> dict:
        self.require_owner(login_id, token)
        page = zhihu_browser._page
        if self._state != "challenge_required" or not page or page.is_closed():
            raise LoginConflict("当前无需操作验证画面")
        if not _login_page_allowed(page.url):
            raise LoginConflict("登录页面已经跳转，请等待账号校验")
        if frame_id != self._document_revision or page.url != self._last_url:
            raise LoginConflict("画面已变化，请等待刷新后再操作")
        if not events or len(events) > 30:
            raise ValueError("操作数量不正确")
        now = time.monotonic()
        if now - self._input_window >= 1:
            self._input_window = now
            self._input_count = 0
        self._input_count += len(events)
        if self._input_count > 120:
            raise LoginConflict("操作过于频繁")
        for event in events:
            kind = event.get("type")
            if kind in {"click", "move", "down", "up", "scroll"}:
                x, y = event.get("x"), event.get("y")
                if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                    raise ValueError("坐标不正确")
                if not 0 <= x < 1280 or not 0 <= y < 900:
                    raise ValueError("坐标越界")
            elif kind == "key":
                if event.get("key") not in {
                    "Enter", "Tab", "Backspace", "Escape", "ArrowLeft", "ArrowRight"
                }:
                    raise ValueError("按键不允许")
            elif kind == "text":
                if not isinstance(event.get("value"), str) or len(event["value"]) > 80:
                    raise ValueError("输入内容过长")
            else:
                raise ValueError("操作类型不允许")
        for event in events:
            kind = event.get("type")
            if kind in {"click", "move", "down", "up", "scroll"}:
                x, y = event.get("x"), event.get("y")
                if kind == "click":
                    await page.mouse.click(x, y)
                elif kind == "move":
                    await page.mouse.move(x, y, steps=3)
                elif kind == "down":
                    await page.mouse.move(x, y)
                    await page.mouse.down()
                elif kind == "up":
                    await page.mouse.move(x, y)
                    await page.mouse.up()
                else:
                    await page.mouse.wheel(0, max(-600, min(600, float(event.get("delta", 0)))))
            elif kind == "key":
                key = event.get("key")
                await page.keyboard.press(key)
            elif kind == "text":
                value = event.get("value")
                allowed = await page.evaluate("""() => {
                  const el = document.activeElement;
                  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
                    && el.type !== 'password';
                }""")
                if not allowed:
                    for frame in page.frames:
                        if frame == page.main_frame:
                            continue
                        host = urlparse(frame.url).hostname or ""
                        if host != "zhihu.com" and not host.endswith(".zhihu.com"):
                            continue
                        try:
                            allowed = await frame.evaluate("""() => {
                              const el = document.activeElement;
                              return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
                                && el.type !== 'password';
                            }""")
                        except PlaywrightError:
                            continue
                        if allowed:
                            break
                if not allowed:
                    raise ValueError("当前不能输入文字")
                await page.keyboard.insert_text(value)
            if page.url != self._last_url:
                self._document_revision += 1
                self._last_url = page.url
                break
        return self._snapshot()

    async def refresh(self, login_id: str, token: str | None) -> dict:
        self.require_owner(login_id, token)
        if self._state not in {"qr_ready", "expired", "challenge_required"}:
            raise LoginConflict("当前不能刷新登录页面")
        page = zhihu_browser._page
        if not page or page.is_closed():
            raise LoginConflict("知乎登录页面已关闭")
        await page.goto("https://www.zhihu.com/signin", wait_until="domcontentloaded", timeout=30000)
        if self._state == "expired":
            self._expires_at = time.time() + 600
            self._task = asyncio.create_task(self._watch(login_id))
        self._document_revision += 1
        self._last_url = page.url
        self._set_state("starting", "正在刷新知乎二维码")
        return self._snapshot()

    async def cancel(self, login_id: str, token: str | None) -> dict:
        self.require_owner(login_id, token)
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._state != "connected":
            await zhihu_browser.close()
        self._set_state("cancelled", "已取消登录")
        self._id = None
        self._request_id = None
        self._token = None
        return self._snapshot()

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._id = None
        self._token = None
        self._request_id = None
        self._set_state("cancelled", "已取消登录")


zhihu_login = ScopedService(ZhihuLoginManager)
