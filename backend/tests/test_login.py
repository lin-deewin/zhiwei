from __future__ import annotations

import json
import stat

import pytest

from app.services import zhihu_account, zhihu_session
from app.services.zhihu_login import LoginDenied, ZhihuLoginManager, _login_page_allowed


def test_saved_session_filters_origins_and_requires_private_file(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(zhihu_session, "APP_HOME", tmp_path)
    session_file = tmp_path / "zhihu-browser-session.json"
    monkeypatch.setattr(zhihu_session, "SESSION_FILE", session_file)
    zhihu_session.save_session(
        {"id": "account-id", "name": "用户", "url_token": "user"},
        {"cookies": [
            {"name": "z_c0", "value": "secret", "domain": ".zhihu.com"},
            {"name": "other", "value": "private", "domain": "example.com"},
        ], "origins": [
            {"origin": "https://www.zhihu.com", "localStorage": []},
            {"origin": "https://example.com", "localStorage": []},
        ]},
        "Chrome test",
    )
    saved = zhihu_session.load_session()
    assert saved is not None
    assert [cookie["name"] for cookie in saved["storage_state"]["cookies"]] == ["z_c0"]
    assert [origin["origin"] for origin in saved["storage_state"]["origins"]] == [
        "https://www.zhihu.com"
    ]
    assert stat.S_IMODE(session_file.stat().st_mode) == 0o600
    session_file.write_text(json.dumps(["invalid"]))
    assert zhihu_session.load_session() is None
    session_file.unlink()
    session_file.symlink_to(tmp_path / "other.json")
    assert zhihu_session.load_session() is None


def test_login_owner_and_frame_path_boundary() -> None:
    manager = ZhihuLoginManager()
    manager._id = "login-id"
    manager._token = "private-token"
    manager.require_owner("login-id", "private-token")
    with pytest.raises(LoginDenied):
        manager.require_owner("login-id", "wrong-token")
    assert _login_page_allowed("https://www.zhihu.com/account/unhuman")
    assert _login_page_allowed("https://www.zhihu.com/signin?next=%2F")
    assert not _login_page_allowed("https://www.zhihu.com/question/123")
    assert not _login_page_allowed("https://evil.example/signin")


def test_connected_browser_takes_precedence_over_old_qr(monkeypatch) -> None:
    class Account:
        def __init__(self, status: str):
            self._status = status

        def status(self) -> dict:
            return {"status": self._status, "profile": None}

    browser = Account("connected")
    qr = Account("connected")
    monkeypatch.setattr(zhihu_account, "zhihu_browser", browser)
    monkeypatch.setattr(zhihu_account, "zhihu_qr", qr)
    assert zhihu_account.active_account() is browser
    assert zhihu_account.account_status()["status"] == "connected"
    browser._status = "not_connected"
    assert zhihu_account.active_account() is qr
