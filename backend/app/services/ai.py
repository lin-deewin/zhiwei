from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path

import httpx

from app.core.config import get_ai_config


class AIRequestError(Exception):
    """A configured AI provider could not complete a request."""


async def _opencode_completion(config: dict, messages: list[dict[str, str]]) -> str:
    executable = shutil.which("opencode") or "/home/linqp/.opencode/bin/opencode"
    if not Path(executable).is_file():
        raise AIRequestError("找不到本机 OpenCode 命令")

    prompt = "\n\n".join(f"{message['role']}: {message['content']}" for message in messages)
    isolated_config = {
        "permission": {"*": "deny"},
        "agent": {
            "library-chat": {
                "mode": "primary",
                "tools": {"*": False},
                "permission": {"edit": "deny", "bash": "deny", "webfetch": "deny"},
                "maxSteps": 1,
            }
        },
        "mcp": {},
        "plugin": [],
    }
    environment = os.environ.copy()
    environment["OPENCODE_CONFIG_CONTENT"] = json.dumps(isolated_config)
    try:
        process = await asyncio.create_subprocess_exec(
            executable,
            "run",
            "--agent", "library-chat",
            "--model", config["chat_model"],
            "--format", "json",
            prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=environment,
            cwd=str(Path.home()),
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=120)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise AIRequestError("OpenCode 请求超时") from None
    except OSError as error:
        raise AIRequestError("无法启动本机 OpenCode") from error

    if process.returncode:
        raise AIRequestError(f"OpenCode 请求失败（退出码 {process.returncode}）")
    text_parts: list[str] = []
    for line in stdout.decode("utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "text":
            text_parts.append(event.get("part", {}).get("text", ""))
    answer = "".join(text_parts).strip()
    if not answer:
        raise AIRequestError("OpenCode 没有返回文本回答")
    return answer


async def chat_completion(messages: list[dict[str, str]], max_tokens: int = 1000) -> str:
    config = get_ai_config()
    if not config["base_url"] or not config["chat_model"]:
        raise ValueError("AI_NOT_CONFIGURED")
    if config["base_url"] == "opencode://local":
        return await _opencode_completion(config, messages)
    headers = {"Content-Type": "application/json"}
    if config["api_key"]:
        headers["Authorization"] = f"Bearer {config['api_key']}"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{config['base_url']}/chat/completions",
            headers=headers,
            json={"model": config["chat_model"], "temperature": 0.2,
                  "max_tokens": max_tokens, "messages": messages},
        )
        response.raise_for_status()
        body = response.json()
    answer = body["choices"][0]["message"]["content"]
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("EMPTY_MODEL_RESPONSE")
    return answer.strip()
