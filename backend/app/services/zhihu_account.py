from __future__ import annotations

from app.services.zhihu_browser import ZhihuBrowser, zhihu_browser
from app.services.zhihu_qr import ZhihuQrLogin, zhihu_qr


def active_account() -> ZhihuBrowser | ZhihuQrLogin:
    if zhihu_browser.status()["status"] == "connected":
        return zhihu_browser
    if zhihu_qr.status()["status"] == "connected":
        return zhihu_qr
    return zhihu_browser


def account_status() -> dict:
    browser = zhihu_browser.status()
    qr = zhihu_qr.status()
    if browser["status"] == "connected":
        return browser
    if qr["status"] == "connected":
        return qr
    if browser["status"] != "not_connected":
        return browser
    return qr if qr["status"] != "not_connected" else browser
