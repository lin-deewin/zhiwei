from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify

from app.core.config import get_library_dir
from app.core.database import article_dir, session
from app.services.library import clean_title, excerpt, now

IMAGE_TYPES = {
    "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/gif": ("gif", lambda data: data.startswith((b"GIF87a", b"GIF89a"))),
    "image/webp": ("webp", lambda data: data.startswith(b"RIFF") and data[8:12] == b"WEBP"),
    "image/avif": ("avif", lambda data: data[4:12] in (b"ftypavif", b"ftypavis")),
}


class UnsupportedContent(ValueError):
    pass


def _remote_time(value: object) -> str | None:
    try:
        return datetime.fromtimestamp(int(value), UTC).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _normalise(item: dict) -> dict:
    content = item.get("content")
    if not isinstance(content, dict):
        raise UnsupportedContent("收藏条目没有正文对象")
    kind = content.get("type")
    remote_id = str(content.get("id") or "")
    if kind not in {"answer", "article"} or not re.fullmatch(r"\d{1,30}", remote_id):
        raise UnsupportedContent("暂不支持该收藏类型")
    html = content.get("content")
    if not isinstance(html, str) or not html.strip():
        raise UnsupportedContent("知乎未提供可保存的正文")
    question = content.get("question") if isinstance(content.get("question"), dict) else None
    title = content.get("title") if kind == "article" else (question or {}).get("title")
    author = content.get("author") if isinstance(content.get("author"), dict) else {}
    source_url = content.get("url") or ""
    parsed = urlparse(str(source_url))
    if parsed.hostname not in {"www.zhihu.com", "zhuanlan.zhihu.com"}:
        source_url = ""
    elif parsed.scheme == "http":
        source_url = parsed._replace(scheme="https").geturl()
    elif parsed.scheme != "https":
        source_url = ""
    return {
        "id": f"zhihu_{kind}_{remote_id}",
        "kind": kind,
        "remote_id": remote_id,
        "title": clean_title(str(title or "未命名回答")),
        "author": str(author.get("name") or "")[:150] or None,
        "url": source_url,
        "html": html,
        "remote_html_hash": hashlib.sha256(html.encode("utf-8")).hexdigest(),
        "remote_created_at": _remote_time(content.get("created_time") or content.get("created")),
        "remote_updated_at": _remote_time(content.get("updated_time") or content.get("updated")),
        "collected_at": str(item.get("created") or ""),
        "question": {
            "id": str(question.get("id") or ""),
            "title": str(question.get("title") or ""),
            "url": str(question.get("url") or ""),
        } if question else None,
    }


def _existing_state(content: dict) -> str:
    path = article_dir(content["id"]) / "article.md"
    with session() as db:
        row = db.execute("SELECT title, author, content_hash FROM contents WHERE id=?",
                         (content["id"],)).fetchone()
    if not row:
        return "new"
    if not path.is_file():
        return "update"
    if hashlib.sha256(path.read_bytes()).hexdigest() != row["content_hash"]:
        return "conflict"
    metadata_path = path.parent / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "update"
    if (metadata.get("remote_html_hash") == content["remote_html_hash"]
            and row["title"] == content["title"] and row["author"] == content["author"]):
        return "unchanged"
    return "update"


def _asset_type(mime: str, data: bytes) -> str | None:
    candidate = IMAGE_TYPES.get(mime.split(";", 1)[0].lower())
    if candidate and candidate[1](data):
        return candidate[0]
    return None


async def _download_image(client: httpx.AsyncClient, url: str) -> tuple[str, bytes] | None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not (
        parsed.hostname == "zhimg.com" or parsed.hostname.endswith(".zhimg.com")
    ):
        return None
    try:
        async with client.stream("GET", url, follow_redirects=False) as response:
            if response.status_code != 200:
                return None
            if int(response.headers.get("content-length", "0")) > 15 * 1024 * 1024:
                return None
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > 15 * 1024 * 1024:
                    return None
                chunks.append(chunk)
            data = b"".join(chunks)
            extension = _asset_type(response.headers.get("content-type", ""), data)
            return (extension, data) if extension else None
    except (httpx.HTTPError, ValueError):
        return None


async def _convert(content: dict, client: httpx.AsyncClient) -> tuple[str, dict[str, bytes], int]:
    soup = BeautifulSoup(content["html"], "html.parser")
    for tag in soup(["script", "style", "iframe", "form", "object"]):
        tag.decompose()
    assets: dict[str, bytes] = {}
    failures = 0
    image_cache: dict[str, str | None] = {}
    for index, image in enumerate(soup.find_all("img")):
        source = str(image.get("data-original") or image.get("data-actualsrc")
                     or image.get("src") or "")
        if source.startswith("//"):
            source = "https:" + source
        if index >= 50:
            failures += 1
            image.decompose()
            continue
        if source not in image_cache:
            downloaded = await _download_image(client, source)
            if downloaded:
                extension, data = downloaded
                filename = f"{hashlib.sha256(data).hexdigest()}.{extension}"
                assets[filename] = data
                image_cache[source] = "assets/" + filename
            else:
                image_cache[source] = None
        local_source = image_cache[source]
        if local_source:
            image["src"] = local_source
        elif source.startswith("https://"):
            image["src"] = source
            failures += 1
        else:
            image.decompose()
            failures += 1
    for link in soup.find_all("a"):
        href = str(link.get("href") or "")
        if href.startswith("//"):
            link["href"] = "https:" + href
        elif href and not href.startswith(("https://", "http://", "#")):
            link.unwrap()
    body = markdownify(str(soup), heading_style="ATX").strip()
    return f"# {content['title']}\n\n{body}\n", assets, failures


def _atomic_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def _record_membership(content_id: str, folder_id: str, seen_at: str) -> list[str]:
    with session() as db:
        db.execute(
            """INSERT INTO folder_contents(folder_id,content_id,first_seen_at,last_seen_at)
               VALUES (?,?,?,?) ON CONFLICT(folder_id,content_id) DO UPDATE SET
               last_seen_at=excluded.last_seen_at,source_status='active'""",
            (folder_id, content_id, seen_at, seen_at),
        )
        db.execute("UPDATE contents SET last_synced_at=? WHERE id=?", (seen_at, content_id))
        return [row[0] for row in db.execute(
            "SELECT folder_id FROM folder_contents WHERE content_id=? AND source_status='active'",
            (content_id,),
        )]


def _update_metadata_folders(content_id: str, folder_ids: list[str]) -> None:
    path = article_dir(content_id) / "metadata.json"
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        metadata["folder_ids"] = folder_ids
        _atomic_bytes(path, json.dumps(metadata, ensure_ascii=False, indent=2).encode("utf-8"))
    except (OSError, ValueError):
        pass


def _persist(content: dict, markdown: str, assets: dict[str, bytes], folder_id: str,
             seen_at: str, asset_failures: int, state: str) -> str:
    root = get_library_dir().resolve()
    directory = article_dir(content["id"]).resolve()
    if not directory.is_relative_to(root):
        raise ValueError("文章路径超出资料目录")
    for filename, data in assets.items():
        target = (directory / "assets" / filename).resolve()
        if not target.is_relative_to(directory):
            raise ValueError("图片路径超出文章目录")
        if not target.exists():
            _atomic_bytes(target, data)
    markdown_bytes = markdown.encode("utf-8")
    if state == "conflict":
        _atomic_bytes(directory / "article.remote.md", markdown_bytes)
        folder_ids = _record_membership(content["id"], folder_id, seen_at)
        _update_metadata_folders(content["id"], folder_ids)
        return "conflict"

    relative = Path("articles") / content["id"] / "article.md"
    _atomic_bytes(directory / "article.md", markdown_bytes)
    digest = hashlib.sha256(markdown_bytes).hexdigest()
    timestamp = now()
    with session() as db:
        db.execute(
            """INSERT INTO contents(id,kind,remote_id,title,author,url,markdown_path,excerpt,
               content_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,
               url=excluded.url,markdown_path=excluded.markdown_path,excerpt=excluded.excerpt,
               content_hash=excluded.content_hash,updated_at=excluded.updated_at""",
            (content["id"], content["kind"], content["remote_id"], content["title"],
             content["author"], content["url"], relative.as_posix(), excerpt(markdown),
             digest, timestamp, timestamp),
        )
        db.execute("DELETE FROM content_search WHERE content_id=?", (content["id"],))
        db.execute("INSERT INTO content_search(content_id,title,body) VALUES (?,?,?)",
                   (content["id"], content["title"], markdown))
    folder_ids = _record_membership(content["id"], folder_id, seen_at)
    metadata_path = directory / "metadata.json"
    prior_metadata: dict = {}
    try:
        loaded = json.loads(metadata_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            prior_metadata = loaded
    except (OSError, ValueError):
        pass
    metadata = {
        "schema_version": 1,
        "id": content["id"],
        "kind": content["kind"],
        "remote_id": content["remote_id"],
        "title": content["title"],
        "author": content["author"],
        "url": content["url"],
        "source": "zhihu_favorite",
        "folder_ids": folder_ids,
        "question": content["question"],
        "remote_created_at": content["remote_created_at"],
        "remote_updated_at": content["remote_updated_at"],
        "collected_at": content["collected_at"],
        "remote_html_hash": content["remote_html_hash"],
        "content_hash": digest,
        "asset_failures": asset_failures,
        "synced_at": timestamp,
    }
    for key in ("category_id", "classification_source", "classification_reason"):
        if key in prior_metadata:
            metadata[key] = prior_metadata[key]
    _atomic_bytes(metadata_path,
                  json.dumps(metadata, ensure_ascii=False, indent=2).encode("utf-8"))
    if content["kind"] == "answer":
        from app.services.questions import link_saved_answer
        link_saved_answer(content["id"], metadata)
    return "partial" if asset_failures else ("new" if state == "new" else "updated")


async def save_favorite(item: dict, folder_id: str, seen_at: str,
                        client: httpx.AsyncClient) -> str:
    content = _normalise(item)
    try:
        collected_at = datetime.fromisoformat(content["collected_at"]).astimezone(UTC).isoformat()
    except (ValueError, TypeError):
        collected_at = None
    state = await asyncio.to_thread(_existing_state, content)
    if state == "unchanged":
        folder_ids = await asyncio.to_thread(_record_membership, content["id"], folder_id, seen_at)
        await asyncio.to_thread(_update_metadata_folders, content["id"], folder_ids)
        with session() as db:
            db.execute("UPDATE contents SET collected_at=COALESCE(?,collected_at) WHERE id=?", (collected_at, content["id"]))
        return "unchanged"
    markdown, assets, failures = await _convert(content, client)
    result = await asyncio.to_thread(
        _persist, content, markdown, assets, folder_id, seen_at, failures, state,
    )
    with session() as db:
        db.execute("UPDATE contents SET collected_at=COALESCE(?,collected_at) WHERE id=?", (collected_at, content["id"]))
    return result
