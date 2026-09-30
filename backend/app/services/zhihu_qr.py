from __future__ import annotations

import asyncio
import base64
import io
import json
import time
from threading import Lock, RLock

import qrcode
import requests

from app.core.config import APP_HOME
from app.services.zhihu_browser import ZhihuAuthError, ZhihuFetchError

BASE_URL = "https://www.zhihu.com"
QR_URL = f"{BASE_URL}/api/v3/account/api/login/qrcode"
COOKIE_FILE = APP_HOME / "zhihu-qr-session.json"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)


def _new_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": f"{BASE_URL}/signin",
        "Origin": BASE_URL,
        "x-requested-with": "fetch",
        "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    })
    return session


def _xsrf_header(session: requests.Session) -> None:
    for cookie in session.cookies:
        if cookie.name == "_xsrf":
            session.headers["x-xsrftoken"] = cookie.value
            return


def _scan_response(session: requests.Session, token: str) -> requests.Response:
    _xsrf_header(session)
    session.headers.update({
        "Referer": f"{BASE_URL}/signin?next=%2F",
        "Accept": "*/*",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-zse-93": "101_3_3.0",
    })
    return session.get(f"{QR_URL}/{token}/scan_info", timeout=10)


def _security_challenge(response: requests.Response) -> bool:
    if response.status_code != 403:
        return False
    try:
        error = response.json().get("error", {})
    except ValueError:
        return False
    return isinstance(error, dict) and error.get("code") == 40352


class ZhihuQrLogin:
    def __init__(self) -> None:
        self._lock = RLock()
        self._request_lock = Lock()
        self._session: requests.Session | None = None
        self._token: str | None = None
        self._expires_at = 0.0
        self._status = "not_connected"
        self._message = "尚未连接知乎账号"
        self._profile: dict[str, str] | None = None
        self._load_saved()

    def _load_saved(self) -> None:
        try:
            saved = json.loads(COOKIE_FILE.read_text(encoding="utf-8"))
            profile = saved.get("profile")
            cookies = saved.get("cookies")
            if not isinstance(profile, dict) or not profile.get("id") or not isinstance(cookies, list):
                return
            session = _new_session()
            for cookie in cookies:
                if not isinstance(cookie, dict):
                    continue
                domain = str(cookie.get("domain", ""))
                if domain != "zhihu.com" and not domain.endswith(".zhihu.com"):
                    continue
                session.cookies.set(
                    str(cookie.get("name", "")), str(cookie.get("value", "")),
                    domain=domain, path=str(cookie.get("path") or "/"),
                )
            self._session = session
            self._profile = {key: str(profile.get(key, "")) for key in ("id", "name", "url_token")}
            self._status = "restoring"
            self._message = "正在校验已保存的知乎扫码会话。"
        except (OSError, ValueError, TypeError):
            return

    def validate_saved(self) -> None:
        with self._lock:
            if self._status != "restoring" or not self._session or not self._profile:
                return
            try:
                response = self._session.get(f"{BASE_URL}/api/v4/me", timeout=15)
                body = response.json() if response.status_code == 200 else {}
            except (requests.RequestException, ValueError):
                self._status = "network_error"
                self._message = "暂时无法校验已保存的知乎扫码会话。"
                return
            if response.status_code == 200 and isinstance(body, dict) and str(body.get("id")) == self._profile["id"]:
                self._status = "connected"
                self._message = "知乎扫码会话已恢复，可以读取收藏夹。"
            elif response.status_code == 401:
                self._status = "expired"
                self._message = "知乎扫码会话已失效，请重新登录。"
            else:
                self._status = "challenge_required"
                self._message = "知乎要求重新验证账号。"

    def status(self) -> dict:
        with self._lock:
            return {"status": self._status, "message": self._message, "profile": self._profile}

    def start(self) -> dict:
        with self._lock:
            session = _new_session()
            try:
                session.get(f"{BASE_URL}/signin", timeout=15).raise_for_status()
                # These requests establish device and captcha cookies used by Zhihu's QR flow.
                try:
                    session.post(f"{BASE_URL}/udid", json={}, timeout=10)
                    session.get(
                        f"{BASE_URL}/api/v3/oauth/captcha/v2?type=captcha_sign_in", timeout=10
                    )
                except requests.RequestException:
                    pass
                _xsrf_header(session)
                response = session.post(QR_URL, json={}, timeout=15)
                response.raise_for_status()
                data = response.json()
            except (requests.RequestException, ValueError) as error:
                raise RuntimeError("知乎二维码暂时无法生成，请稍后重试。") from error

            token = data.get("token") or data.get("qrcode_token")
            link = data.get("link")
            if not isinstance(token, str) or not isinstance(link, str) or not token or not link:
                raise RuntimeError("知乎二维码接口没有返回可用的二维码。")
            try:
                first_poll = _scan_response(session, token)
            except requests.RequestException as error:
                raise RuntimeError("知乎二维码状态暂时无法读取，请稍后重试。") from error
            if _security_challenge(first_poll):
                self._status = "qr_unavailable"
                self._message = "知乎要求安全验证；当前服务器无法直接扫码登录，请使用浏览器登录。"
                raise RuntimeError(self._message)
            if first_poll.status_code not in (200, 201):
                raise RuntimeError(f"知乎二维码状态接口返回 {first_poll.status_code}，请稍后重试。")
            image = qrcode.make(link)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            self._session = session
            self._token = token
            self._expires_at = time.time() + 120
            self._status = "qr_pending"
            self._message = "请用知乎 App 扫码，并在手机上确认登录。"
            self._profile = None
            return {
                **self.status(),
                "qr_data_url": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode(),
            }

    def poll(self) -> dict:
        with self._lock:
            if self._status == "connected" or not self._session or not self._token:
                return self.status()
            if time.time() >= self._expires_at:
                self._token = None
                self._status = "qr_expired"
                self._message = "二维码已过期，请刷新后重试。"
                return self.status()
            session = self._session
            try:
                response = _scan_response(session, self._token)
                if _security_challenge(response):
                    self._token = None
                    self._status = "qr_unavailable"
                    self._message = "知乎要求安全验证；当前服务器无法直接扫码登录，请使用浏览器登录。"
                    return self.status()
                response.raise_for_status()
                data = response.json()
            except (requests.RequestException, ValueError):
                self._message = "正在等待知乎确认扫码；如持续失败，请刷新二维码。"
                return self.status()
            if not isinstance(data, dict):
                return self.status()
            if data.get("status") == 1:
                self._status = "qr_scanned"
                self._message = "已扫码，请在知乎 App 中确认登录。"
            if data.get("z_c0"):
                session.cookies.set("z_c0", str(data["z_c0"]), domain=".zhihu.com")
            cookie_text = data.get("cookie") or data.get("cookies")
            if isinstance(cookie_text, str) and "z_c0=" in cookie_text:
                for part in cookie_text.split(";"):
                    name, separator, value = part.strip().partition("=")
                    if separator and name:
                        session.cookies.set(name, value, domain=".zhihu.com")
            if any(cookie.name == "z_c0" for cookie in session.cookies):
                self._verify_session()
            return self.status()

    def _verify_session(self) -> None:
        assert self._session is not None
        try:
            response = self._session.get(f"{BASE_URL}/api/v4/me", timeout=10)
            response.raise_for_status()
            body = response.json()
        except (requests.RequestException, ValueError):
            self._message = "扫码已完成，正在等待知乎确认登录状态。"
            return
        account_id = body.get("id") if isinstance(body, dict) else None
        if not account_id:
            self._message = "知乎尚未返回账号信息，请稍后重试。"
            return
        self._profile = {
            "id": str(account_id),
            "name": str(body.get("name") or "知乎用户")[:80],
            "url_token": str(body.get("url_token") or ""),
        }
        self._status = "connected"
        self._message = "知乎账号已验证，可以读取收藏夹。"
        self._token = None
        self._save_session()

    def _save_session(self) -> None:
        assert self._session is not None
        APP_HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
        APP_HOME.chmod(0o700)
        cookies = [
            {"name": cookie.name, "value": cookie.value,
             "domain": cookie.domain, "path": cookie.path}
            for cookie in self._session.cookies
            if cookie.domain == "zhihu.com" or cookie.domain.endswith(".zhihu.com")
        ]
        temp = COOKIE_FILE.with_suffix(".tmp")
        temp.write_text(
            json.dumps({"profile": self._profile, "cookies": cookies}, ensure_ascii=False),
            encoding="utf-8",
        )
        temp.chmod(0o600)
        temp.replace(COOKIE_FILE)
        COOKIE_FILE.chmod(0o600)

    async def get_json(self, path: str) -> dict:
        if not path.startswith("/api/v4/") or ".." in path or "//" in path:
            raise ValueError("不允许访问该知乎接口")
        return await asyncio.to_thread(self._get_json, path)

    def _get_json(self, path: str) -> dict:
        with self._lock:
            if self._status != "connected" or self._session is None:
                raise ZhihuAuthError("请先验证知乎账号")
            current_session = self._session
        try:
            with self._request_lock:
                response = current_session.get(
                    f"{BASE_URL}{path}", timeout=20, allow_redirects=False
                )
        except requests.RequestException as error:
            raise ZhihuFetchError("知乎请求超时或连接失败") from error
        if response.status_code == 401:
            with self._lock:
                if self._session is current_session:
                    self._status = "not_connected"
                    self._message = "知乎会话已失效，请重新登录。"
                    self._profile = None
                    self._session.close()
                    self._session = None
                    COOKIE_FILE.unlink(missing_ok=True)
            raise ZhihuAuthError("知乎会话已失效，请重新登录。")
        if response.status_code == 403:
            if _security_challenge(response):
                with self._lock:
                    self._status = "challenge_required"
                    self._message = "知乎要求安全验证，请使用页面内浏览器登录。"
                raise ZhihuAuthError(self._message)
            raise ZhihuFetchError("知乎拒绝访问当前资源（HTTP 403）")
        if response.status_code == 429:
            raise ZhihuFetchError("知乎请求过于频繁，请稍后重试")
        if response.status_code != 200:
            raise ZhihuFetchError(f"知乎接口返回 HTTP {response.status_code}")
        if "json" not in response.headers.get("content-type", ""):
            raise ZhihuFetchError("知乎接口没有返回 JSON 数据")
        try:
            body = response.json()
        except ValueError as error:
            raise ZhihuFetchError("知乎返回的数据无法解析") from error
        if not isinstance(body, dict):
            raise ZhihuFetchError("知乎返回的数据格式不正确")
        return body

    def disconnect(self) -> dict:
        with self._lock:
            if self._session:
                self._session.close()
            self._session = None
            self._token = None
            self._profile = None
            self._status = "not_connected"
            self._message = "已清除知乎扫码登录会话；本地文章保留。"
            COOKIE_FILE.unlink(missing_ok=True)
            return self.status()

    def cancel_pending(self) -> None:
        with self._lock:
            if self._status == "connected":
                return
            if self._session:
                self._session.close()
            self._session = None
            self._token = None
            self._profile = None
            self._status = "not_connected"
            self._message = "尚未连接知乎账号"


zhihu_qr = ZhihuQrLogin()
