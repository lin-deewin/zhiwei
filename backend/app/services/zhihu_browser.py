from __future__ import annotations

import asyncio
import fcntl
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.core.config import get_app_home
from app.core.tenancy import ScopedService, user_id
from app.services.zhihu_display import VirtualDisplay
from app.services.zhihu_session import delete_session, load_session, save_session


class ZhihuAuthError(RuntimeError):
    pass


class ZhihuFetchError(RuntimeError):
    pass


class ZhihuBrowser:
    """User-operated browser session. This class never collects a Zhihu password."""

    def __init__(self) -> None:
        self._playwright: Any = None
        self._context: Any = None
        self._browser: Any = None
        self._page: Any = None
        self._api_request: Any = None
        self._external_browser = False
        self._chrome_process: asyncio.subprocess.Process | None = None
        self._managed_profile: Path | None = None
        self._profile_lock_fd: int | None = None
        self._display: VirtualDisplay | None = None
        self._lock = asyncio.Lock()
        self._status = "not_connected"
        self._message = "尚未连接知乎账号"
        self._profile: dict[str, str] | None = None

    def status(self) -> dict:
        return {"status": self._status, "message": self._message, "profile": self._profile}

    async def restore_saved(self) -> dict:
        saved = load_session()
        if not saved:
            return self.status()
        async with self._lock:
            self._status = "restoring"
            self._message = "正在校验已保存的知乎会话"
            try:
                from playwright.async_api import async_playwright

                self._playwright = await async_playwright().start()
                request = await self._playwright.request.new_context(
                    storage_state=saved["storage_state"],
                    user_agent=str(saved.get("user_agent") or ""),
                    extra_http_headers={"Referer": "https://www.zhihu.com/"},
                )
                response = await request.get("https://www.zhihu.com/api/v4/me",
                                             timeout=15000, max_redirects=0)
                try:
                    status = response.status
                    body = await response.json() if status == 200 else {}
                finally:
                    await response.dispose()
                if status == 200 and isinstance(body, dict) and str(body.get("id")) == str(
                    saved["profile"]["id"]
                ):
                    self._api_request = request
                    self._profile = {key: str(body.get(key) or "")
                                     for key in ("id", "name", "url_token")}
                    self._status = "connected"
                    self._message = "知乎会话已恢复，可以读取收藏夹。"
                    return self.status()
                await request.dispose()
                self._status = "expired" if status == 401 else "challenge_required"
                self._message = ("知乎会话已失效，请重新登录。" if status == 401
                                 else "知乎要求重新验证，请打开登录窗口。")
            except (PlaywrightError, OSError, ValueError, TypeError):
                self._status = "network_error"
                self._message = "暂时无法校验已保存的知乎会话，请稍后重试。"
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None
        # A standalone HTTP client may be rejected while the persistent Chrome
        # profile remains valid. Recheck in the same browser used for login.
        result = await self.connect(virtual_display=True)
        if result["status"] != "unavailable":
            result = await self.verify()
            if result["status"] == "connected":
                self._message = "知乎浏览器会话已恢复，可以读取收藏夹。"
                return self.status()
        return result

    async def _launch_chrome(self, executable: str, virtual_display: bool = False) -> str:
        if virtual_display:
            lock_path = get_app_home() / "browser-profile" / "zhihu-login.lock"
            lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                os.close(lock_fd)
                raise RuntimeError("另一个知微进程正在使用知乎登录浏览器") from error
            self._profile_lock_fd = lock_fd
        profile_dir = get_app_home() / "browser-profile" / (
            "zhihu-login" if virtual_display else "zhihu-chrome"
        )
        profile_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        profile_dir.chmod(0o700)
        self._managed_profile = profile_dir
        port_file = profile_dir / "DevToolsActivePort"
        if port_file.exists():
            try:
                port = int(port_file.read_text().splitlines()[0])
                _reader, writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", port), timeout=1
                )
                writer.close()
                await writer.wait_closed()
                return f"http://127.0.0.1:{port}"
            except (OSError, ValueError, IndexError, TimeoutError):
                port_file.unlink(missing_ok=True)
        child_env = os.environ.copy()
        if virtual_display:
            self._display = VirtualDisplay()
            child_env.update(await self._display.start())
        self._chrome_process = await asyncio.create_subprocess_exec(
            executable, "--remote-debugging-address=127.0.0.1",
             "--remote-debugging-port=0", f"--user-data-dir={profile_dir}",
             "--password-store=basic", "--no-first-run", "--new-window",
             "--window-size=1280,900", "--force-device-scale-factor=1",
             "https://www.zhihu.com/signin",
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True, env=child_env,
        )
        for _ in range(75):
            if port_file.exists():
                try:
                    port = int(port_file.read_text().splitlines()[0])
                    return f"http://127.0.0.1:{port}"
                except (OSError, ValueError, IndexError):
                    pass
            if self._chrome_process.returncode is not None:
                raise RuntimeError("Google Chrome 启动后立即退出")
            await asyncio.sleep(0.2)
        raise RuntimeError("Google Chrome 调试接口未启动")

    async def connect(self, virtual_display: bool = False) -> dict:
        async with self._lock:
            if self._context and self._page and not self._page.is_closed():
                if self._status == "connected":
                    return self.status()
                self._status = "awaiting_login"
                self._message = "请在已打开的知乎浏览器窗口中完成登录，然后返回验证。"
                return self.status()
            cdp_url = None if user_id() else os.environ.get("ZHILIB_CHROME_CDP_URL")
            if (not virtual_display and not cdp_url and not os.environ.get("DISPLAY")
                    and os.name != "nt" and not os.environ.get("WAYLAND_DISPLAY")):
                self._status = "unavailable"
                self._message = "当前运行环境没有图形桌面。请在本机桌面环境启动应用后连接知乎。"
                return self.status()
            try:
                from playwright.async_api import async_playwright

                if self._playwright:
                    await self._close_locked()
                self._playwright = await async_playwright().start()
                chrome_path = (shutil.which("google-chrome-stable") or
                               shutil.which("google-chrome"))
                if not cdp_url and chrome_path and not (virtual_display and (not shutil.which("Xvfb") or not shutil.which("xauth"))):
                    cdp_url = await self._launch_chrome(chrome_path, virtual_display)
                if cdp_url:
                    self._browser = await self._playwright.chromium.connect_over_cdp(cdp_url)
                    if not self._browser.contexts:
                        raise RuntimeError("浏览器没有可用的用户会话")
                    self._context = self._browser.contexts[0]
                    self._external_browser = True
                    self._page = next(
                        (page for page in self._context.pages
                         if ((urlparse(page.url).hostname or "") == "zhihu.com" or
                             (urlparse(page.url).hostname or "").endswith(".zhihu.com"))),
                        None,
                    )
                    if self._page is None:
                        self._page = await self._context.new_page()
                        await self._page.goto(
                            "https://www.zhihu.com/signin",
                            wait_until="domcontentloaded", timeout=30000,
                        )
                    await self._page.set_viewport_size({"width": 1280, "height": 900})
                else:
                    profile_dir = get_app_home() / "browser-profile" / "zhihu"
                    profile_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
                    try:
                        profile_dir.chmod(0o700)
                    except OSError:
                        pass
                    self._managed_profile = profile_dir
                    self._context = await self._playwright.chromium.launch_persistent_context(
                        user_data_dir=str(profile_dir),
                        headless=virtual_display,
                        locale="zh-CN",
                        viewport={"width": 1280, "height": 900},
                    )
                    self._page = self._context.pages[0] if self._context.pages else await self._context.new_page()
                    await self._page.goto("https://www.zhihu.com/signin", wait_until="domcontentloaded", timeout=30000)
                self._status = "awaiting_login"
                self._message = ("请在知微页面完成知乎扫码或安全验证。" if virtual_display
                                 else "请在远程桌面的浏览器中完成知乎验证和登录，然后回到这里验证。")
            except (TimeoutError, PlaywrightError, OSError, RuntimeError) as error:
                await self._close_locked()
                self._status = "unavailable"
                self._message = f"无法启动知乎浏览器：{type(error).__name__}。请检查 Chrome 和 Xvfb。"
            return self.status()

    async def verify(self) -> dict:
        async with self._lock:
            if not self._context or not self._page or self._page.is_closed():
                if self._status == "connected" and self._api_request:
                    return self.status()
                self._status = "not_connected"
                self._message = "请先点击连接知乎并在浏览器中登录。"
                return self.status()
            try:
                # Probe from the visible page so the check uses its live browser session.
                result = await self._page.evaluate(
                    """async () => {
                      const response = await fetch('/api/v4/me', {credentials: 'include'});
                      let body = null;
                      try { body = await response.json(); } catch { /* non-JSON response */ }
                      return {status: response.status, body};
                    }"""
                )
                if result.get("status") != 200:
                    self._status = "awaiting_login"
                    self._message = (
                        "知乎尚未确认当前登录状态，请确认浏览器已登录后重试。"
                        f"（接口状态：{result.get('status', '未知')}）"
                    )
                    return self.status()
                body = result.get("body")
                account_id = body.get("id") if isinstance(body, dict) else None
                if not account_id:
                    self._status = "unverified"
                    self._message = "知乎返回的信息中没有可验证的账号标识。"
                    return self.status()
                self._profile = {
                    "id": str(account_id),
                    "name": str(body.get("name") or "知乎用户")[:80],
                    "url_token": str(body.get("url_token") or ""),
                }
                storage_state = await self._context.storage_state()
                user_agent = await self._page.evaluate("navigator.userAgent")
                request = await self._playwright.request.new_context(
                    storage_state=storage_state,
                    user_agent=user_agent,
                    extra_http_headers={"Referer": "https://www.zhihu.com/"},
                )
                if self._api_request:
                    await self._api_request.dispose()
                self._api_request = request
                self._status = "connected"
                self._message = "知乎账号已验证，可以读取收藏夹。"
                if self._managed_profile:
                    try:
                        save_session(self._profile, storage_state, user_agent)
                    except OSError:
                        self._message = "知乎账号已验证，但保存会话失败；重启后可能需要重新登录。"
            except (TimeoutError, PlaywrightError, OSError, ValueError, TypeError) as error:
                self._profile = None
                self._status = "unverified"
                self._message = f"暂时无法验证知乎会话：{type(error).__name__}。"
            return self.status()

    async def get_json(self, path: str) -> dict:
        if not path.startswith("/api/v4/") or ".." in path or "//" in path:
            raise ValueError("不允许访问该知乎接口")
        async with self._lock:
            if not self._api_request or self._status != "connected":
                raise ZhihuAuthError("请先连接并验证知乎账号")
            try:
                response = await self._api_request.get(
                    f"https://www.zhihu.com{path}",
                    timeout=20000,
                    max_redirects=0,
                )
            except (TimeoutError, PlaywrightTimeoutError) as error:
                raise ZhihuFetchError("知乎接口请求超时") from error
            except PlaywrightError as error:
                raise ZhihuFetchError(
                    f"知乎请求连接失败（{type(error).__name__}）"
                ) from error
            try:
                if response.status == 401:
                    self._status = "not_connected"
                    self._profile = None
                    self._message = "知乎会话已失效，请重新登录。"
                    raise ZhihuAuthError("知乎会话已失效，请重新登录")
                if response.status == 403:
                    try:
                        error_body = await response.json()
                        code = error_body.get("error", {}).get("code")
                    except (ValueError, TypeError, AttributeError):
                        code = None
                    if code == 40352:
                        self._status = "challenge_required"
                        self._message = "知乎要求安全验证，请重新打开登录窗口。"
                        raise ZhihuAuthError(self._message)
                    raise ZhihuFetchError("知乎拒绝访问当前资源（HTTP 403）")
                if response.status == 429:
                    raise ZhihuFetchError("知乎请求过于频繁，请稍后重试")
                if response.status != 200:
                    raise ZhihuFetchError(f"知乎接口返回 HTTP {response.status}")
                if "json" not in response.headers.get("content-type", ""):
                    raise ZhihuFetchError("知乎接口没有返回 JSON 数据")
                try:
                    body = await response.json()
                except (ValueError, TypeError) as error:
                    raise ZhihuFetchError("知乎返回的数据无法解析") from error
                if not isinstance(body, dict):
                    raise ZhihuFetchError("知乎返回的数据格式不正确")
                return body
            finally:
                await response.dispose()

    async def disconnect(self) -> dict:
        async with self._lock:
            managed_profile = self._managed_profile
            if self._external_browser and self._context:
                try:
                    await self._context.clear_cookies()
                except PlaywrightError:
                    pass
            await self._close_locked()
            profile_dir = get_app_home() / "browser-profile" / "zhihu"
            if profile_dir.exists() and profile_dir.resolve().is_relative_to(get_app_home().resolve()):
                shutil.rmtree(profile_dir, ignore_errors=True)
            if managed_profile and managed_profile.resolve().is_relative_to(get_app_home().resolve()):
                shutil.rmtree(managed_profile, ignore_errors=True)
            login_profile = get_app_home() / "browser-profile" / "zhihu-login"
            if login_profile.exists() and login_profile.resolve().is_relative_to(get_app_home().resolve()):
                shutil.rmtree(login_profile, ignore_errors=True)
            delete_session()
            self._status = "not_connected"
            self._profile = None
            self._message = "已清除本机知乎登录会话；本地文章保留。"
            return self.status()

    async def close(self) -> None:
        async with self._lock:
            # Capture refreshed cookies before terminating Chrome. Disconnect
            # deliberately bypasses this path and deletes the saved session.
            if self._status == "connected" and self._profile and (self._managed_profile or (self._api_request and load_session())):
                try:
                    if self._context and self._page and not self._page.is_closed():
                        state = await self._context.storage_state()
                        user_agent = await self._page.evaluate("navigator.userAgent")
                    elif self._api_request:
                        state = await self._api_request.storage_state()
                        saved = load_session()
                        user_agent = str(saved.get("user_agent") or "") if saved else ""
                    else:
                        state = None
                    if state is not None:
                        save_session(self._profile, state, user_agent)
                except (PlaywrightError, OSError, ValueError, TypeError):
                    pass  # Keep the previous atomic snapshot if saving fails.
            await self._close_locked()
            if self._status != "connected":
                self._status = "not_connected"
                self._message = "尚未连接知乎账号"
                self._profile = None

    async def _close_locked(self) -> None:
        if self._api_request:
            try:
                await self._api_request.dispose()
            except PlaywrightError:
                pass
        if self._context and not self._external_browser:
            try:
                await self._context.close()
            except PlaywrightError:
                pass
        if self._playwright:
            try:
                await self._playwright.stop()
            except PlaywrightError:
                pass
        if self._chrome_process and self._chrome_process.returncode is None:
            self._chrome_process.terminate()
            try:
                await asyncio.wait_for(self._chrome_process.wait(), timeout=5)
            except TimeoutError:
                self._chrome_process.kill()
                await self._chrome_process.wait()
        if self._display:
            await self._display.close()
        if self._profile_lock_fd is not None:
            fcntl.flock(self._profile_lock_fd, fcntl.LOCK_UN)
            os.close(self._profile_lock_fd)
        self._context = None
        self._browser = None
        self._playwright = None
        self._page = None
        self._api_request = None
        self._external_browser = False
        self._chrome_process = None
        self._managed_profile = None
        self._profile_lock_fd = None
        self._display = None


zhihu_browser = ScopedService(ZhihuBrowser)
