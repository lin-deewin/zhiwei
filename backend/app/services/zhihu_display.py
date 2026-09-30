from __future__ import annotations

import asyncio
import secrets
import shutil
import subprocess
from pathlib import Path

from app.core.config import APP_HOME


class VirtualDisplay:
    """A private X server used only by the managed Zhihu Chrome process."""

    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self.authority: Path | None = None
        self.name: str | None = None

    async def start(self) -> dict[str, str]:
        if self.process and self.process.returncode is None and self.name and self.authority:
            return {"DISPLAY": self.name, "XAUTHORITY": str(self.authority)}
        if not shutil.which("Xvfb") or not shutil.which("xauth"):
            raise RuntimeError("服务器缺少 Xvfb 或 xauth")
        runtime = APP_HOME / "browser-profile" / "display"
        runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        runtime.chmod(0o700)
        for number in range(90, 190):
            if Path(f"/tmp/.X11-unix/X{number}").exists():
                continue
            authority = runtime / f"xauth-{number}"
            authority.unlink(missing_ok=True)
            authority.touch(mode=0o600)
            authority.chmod(0o600)
            auth = await asyncio.create_subprocess_exec(
                "xauth", "-f", str(authority), "add", f":{number}", ".",
                secrets.token_hex(16), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if await auth.wait() != 0:
                raise RuntimeError("无法创建私有显示器认证文件")
            process = await asyncio.create_subprocess_exec(
                "Xvfb", f":{number}", "-screen", "0", "1280x960x24", "-nolisten", "tcp",
                "-auth", str(authority), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            for _ in range(30):
                if process.returncode is not None:
                    break
                if Path(f"/tmp/.X11-unix/X{number}").exists():
                    self.process = process
                    self.authority = authority
                    self.name = f":{number}"
                    return {"DISPLAY": self.name, "XAUTHORITY": str(authority)}
                await asyncio.sleep(0.1)
            if process.returncode is None:
                process.terminate()
                await process.wait()
            authority.unlink(missing_ok=True)
        raise RuntimeError("无法启动私有虚拟显示器")

    async def close(self) -> None:
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
        if self.authority:
            self.authority.unlink(missing_ok=True)
        self.process = None
        self.authority = None
        self.name = None
