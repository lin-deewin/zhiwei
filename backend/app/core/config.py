from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock

APP_HOME = Path(os.environ.get("ZHILIB_HOME", Path.home() / ".local/share/zhihu-library"))
CONFIG_FILE = APP_HOME / "config.json"
_lock = RLock()


def _read_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write_config(config: dict) -> None:
    APP_HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        APP_HOME.chmod(0o700)
    except OSError:
        pass
    temp = CONFIG_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        temp.chmod(0o600)
    except OSError:
        pass
    temp.replace(CONFIG_FILE)
    try:
        CONFIG_FILE.chmod(0o600)
    except OSError:
        pass


def get_library_dir() -> Path:
    override = os.environ.get("ZHILIB_LIBRARY_DIR")
    if override:
        return Path(override).expanduser().resolve()
    config = _read_config()
    configured = config.get("library_dir")
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path.home() / "Documents" / "ZhihuLibrary").resolve()


def set_library_dir(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir() or not os.access(path, os.W_OK):
        raise ValueError("目录不存在或不可写")
    with _lock:
        config = _read_config()
        config["library_dir"] = str(path)
        _write_config(config)
    return path


def get_ai_config() -> dict:
    config = _read_config()
    return {
        "base_url": config.get("ai_base_url", ""),
        "chat_model": config.get("ai_chat_model", ""),
        "embedding_model": config.get("ai_embedding_model", ""),
        "api_key": config.get("ai_api_key", ""),
    }


def set_ai_config(base_url: str, chat_model: str, embedding_model: str, api_key: str | None,
                  clear_api_key: bool = False) -> dict:
    with _lock:
        config = _read_config()
        config["ai_base_url"] = base_url.rstrip("/")
        config["ai_chat_model"] = chat_model
        config["ai_embedding_model"] = embedding_model
        if clear_api_key:
            config.pop("ai_api_key", None)
        elif api_key is not None and api_key.strip():
            config["ai_api_key"] = api_key.strip()
        _write_config(config)
    return {
        "base_url": base_url.rstrip("/"),
        "chat_model": chat_model,
        "embedding_model": embedding_model,
        "api_key_set": bool(get_ai_config()["api_key"]),
    }
