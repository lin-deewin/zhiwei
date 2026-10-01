import asyncio
import json

import pytest

from app.services import ai


def test_opencode_standalone_configuration_and_safe_error(monkeypatch):
    seen = []

    class Process:
        returncode = 0

        async def communicate(self):
            return json.dumps({"type": "text", "part": {"text": "正常"}}).encode(), b""

    async def spawn(*args, **kwargs):
        seen.append((args, kwargs))
        return Process()

    monkeypatch.setattr(ai.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(ai.Path, "is_file", lambda _: True)
    monkeypatch.setattr(ai.shutil, "which", lambda _: "/usr/bin/opencode")
    result = asyncio.run(
        ai._opencode_completion(
            {"chat_model": "opencode/model"}, [{"role": "user", "content": "测试"}]
        )
    )
    assert result == "正常"
    assert "--standalone" in seen[0][0]
    config = json.loads(seen[0][1]["env"]["OPENCODE_CONFIG_CONTENT"])
    assert config["permission"]["*"] == "deny"
    assert config["agent"]["library-chat"]["tools"]["*"] is False

    async def error_output(self):
        return json.dumps(
            {"type": "error", "error": {"message": "429 quota secret-token private-body"}}
        ).encode(), b""

    monkeypatch.setattr(Process, "communicate", error_output)
    with pytest.raises(ai.AIRequestError, match="限流") as error:
        asyncio.run(ai._opencode_completion({"chat_model": "opencode/model"}, []))
    assert "secret-token" not in str(error.value)
