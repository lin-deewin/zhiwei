from __future__ import annotations

import json
import os
import secrets

from app.core.config import APP_HOME

SESSION_FILE = APP_HOME / "zhihu-browser-session.json"


def save_session(profile: dict[str, str], storage_state: dict, user_agent: str) -> None:
    APP_HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
    APP_HOME.chmod(0o700)
    cookies = [
        cookie for cookie in storage_state.get("cookies", [])
        if isinstance(cookie, dict) and (
            cookie.get("domain") == "zhihu.com"
            or str(cookie.get("domain", "")).endswith(".zhihu.com")
        )
    ]
    origins = [
        origin for origin in storage_state.get("origins", [])
        if isinstance(origin, dict) and origin.get("origin") == "https://www.zhihu.com"
    ]
    data = {"version": 1, "profile": profile, "storage_state": {
        "cookies": cookies, "origins": origins,
    }, "user_agent": user_agent}
    temp = APP_HOME / f".zhihu-browser-session-{secrets.token_hex(8)}.tmp"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        temp.replace(SESSION_FILE)
        SESSION_FILE.chmod(0o600)
    finally:
        temp.unlink(missing_ok=True)


def load_session() -> dict | None:
    if SESSION_FILE.is_symlink() or not SESSION_FILE.is_file():
        return None
    try:
        data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("storage_state"), dict):
        return None
    if not isinstance(data.get("profile"), dict) or not data["profile"].get("id"):
        return None
    return data


def delete_session() -> None:
    SESSION_FILE.unlink(missing_ok=True)
