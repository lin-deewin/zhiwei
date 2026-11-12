from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import uuid
from functools import wraps
from pathlib import Path
from urllib.parse import unquote, urlparse

import yaml

from app.core.config import get_library_dir, library_scope
from app.core.database import session
from app.services import knowledge_graph
from app.services.knowledge import save_research
from app.services.personal_notes import update_personal_note
from app.services.library import import_markdown, now
from app.services.rag import _records
from app.services.reading_workspace import patch_annotation, patch_note

_LOCK = threading.RLock()
IMAGE = re.compile(r'!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)')
SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}
MAX_BYTES = 10 * 1024 * 1024


def captured_library(call):
    @wraps(call)
    def wrapped(*args, **kwargs):
        with _LOCK, library_scope(get_library_dir()):
            return call(*args, **kwargs)

    return wrapped


def _asset_path(path: Path, root: Path, url: str) -> Path:
    candidate = path.parent / unquote(url)
    cursor = root
    # Examine original path before resolving; symlink/../file must also be rejected.
    try:
        relative = candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("图片路径越界") from error
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("图片路径包含符号链接")
    normalized = Path(os.path.abspath(candidate))
    if not normalized.is_relative_to(root):
        raise ValueError("图片路径越界")
    return _safe(root, normalized.relative_to(root).as_posix())


@captured_library
def configuration() -> dict:
    library = get_library_dir().resolve()
    path = library / "app-data/markdown-config.json"
    if path.is_file():
        result = json.loads(path.read_text())
    else:
        result = {
            "directory": str(library / "Obsidian"),
            "library_id": uuid.uuid4().hex,
            "auto_sync": False,
        }
        _atomic(library, path, json.dumps(result).encode())
    return result


@captured_library
def configure(directory: str, auto_sync: bool = False) -> dict:
    library = get_library_dir().resolve()
    root = Path(directory).expanduser().absolute()
    if (
        root.resolve() != root
        or root == library
        or library.is_relative_to(root)
        or root.is_relative_to(library / "app-data")
        or root.is_relative_to(library / "articles")
    ):
        raise ValueError("请选择独立的 Markdown 目录，不能使用资料库根目录、系统父目录或符号链接")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    result = {**configuration(), "directory": str(root), "auto_sync": auto_sync}
    _atomic(library, library / "app-data/markdown-config.json", json.dumps(result).encode())
    return result


def _root() -> Path:
    root = Path(configuration()["directory"]).absolute()
    if root.resolve() != root:
        raise ValueError("Markdown 目录不能是符号链接")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def _safe(root: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("文件路径越界")
    target = root / path
    cursor = root
    for part in path.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("路径包含符号链接")
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("文件路径越界或使用了符号链接")
    return target


def _atomic(root: Path, target: Path, data: bytes) -> None:
    target = _safe(root, target.relative_to(root).as_posix())
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = target.parent / (".zhilib-" + secrets.token_hex(8) + ".tmp")
    try:
        with temp.open("xb") as stream:
            temp.chmod(0o600)
            stream.write(data)
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parse(path: Path) -> tuple[dict, str]:
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Markdown 文件超过 10 MB")
    text = path.read_text(encoding="utf-8-sig")
    meta = {}
    match = re.match(r"\A---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)", text)
    if match:
        if len(match.group(1)) > 50000:
            raise ValueError("元数据过长")
        meta = yaml.safe_load(match.group(1)) or {}
        if not isinstance(meta, dict):
            raise ValueError("元数据必须为对象")
        text = text[match.end() :]
    return meta, text


def _file_hash(path: Path, root: Path) -> str:
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError("文件超过 10 MB")
    parts = [_hash(data)]
    for image in IMAGE.findall(data.decode("utf-8-sig")):
        if urlparse(image).scheme:
            continue
        asset = _asset_path(path, root, image)
        if not asset.is_relative_to(root) or asset.is_symlink():
            raise ValueError("图片路径越界")
        if asset.is_file():
            if asset.stat().st_size > 20 * 1024 * 1024:
                raise ValueError("图片超过 20 MB")
            parts.append(_hash(asset.read_bytes()))
    return _hash("|".join(parts).encode())


def _record(source_id: str) -> dict:
    kind, _, record_id = source_id.partition(":")
    if kind == "article":
        with session() as db:
            row = db.execute("SELECT * FROM contents WHERE id=?", (record_id,)).fetchone()
        if row is None:
            raise LookupError("文章不存在")
        library = get_library_dir().resolve()
        path = _safe(library, row["markdown_path"])
        return {
            "title": row["title"],
            "body": path.read_text(encoding="utf-8-sig"),
            "kind": kind,
            "id": record_id,
            "path": row["markdown_path"],
            "url": row["url"],
            "author": row["author"],
        }
    if kind == "personal_note":
        with session() as db:
            note = db.execute("SELECT * FROM personal_notes WHERE id=?", (record_id,)).fetchone()
            if note is None:
                raise LookupError("个人笔记不存在")
            tags = [
                row[0] for row in db.execute(
                    "SELECT tag FROM personal_note_tags WHERE note_id=? ORDER BY tag COLLATE NOCASE",
                    (record_id,),
                )
            ]
            sources = [
                dict(row) for row in db.execute(
                    "SELECT source_id,source_type,title_snapshot,url_snapshot,created_at "
                    "FROM personal_note_sources WHERE note_id=? ORDER BY created_at,source_id",
                    (record_id,),
                )
            ]
        return {
            "title": note["title"],
            "body": note["body_md"],
            "kind": kind,
            "id": record_id,
            "revision": note["revision"],
            "tags": tags,
            "sources": sources,
        }
    table = {
        "note": "notes",
        "annotation": "annotations",
        "research": "research_notes",
        "topic": "knowledge_topics",
    }.get(kind)
    if not table:
        raise ValueError("不支持的资料类型")
    with session() as db:
        row = db.execute(f"SELECT * FROM {table} WHERE id=?", (record_id,)).fetchone()
    if not row:
        raise LookupError("资料不存在")
    return {
        "title": row["title"] if kind != "annotation" else "高亮批注",
        "body": row["comment_md"] if kind == "annotation" else row["body_md"],
        "kind": kind,
        "id": record_id,
        "revision": row["revision"]
        if kind in {"note", "annotation", "topic", "research"}
        else None,
        "sources": json.loads(row["sources_json"]) if kind in {"research", "topic"} else [],
        "question": row["question"] if kind == "research" else None,
    }


def _record_hash(record: dict) -> str:
    parts = [record["title"], record["body"]]
    if record["kind"] == "personal_note":
        parts.append(json.dumps(record.get("tags", []), ensure_ascii=False))
        source_fields = [
            {key: source.get(key) for key in ("source_id", "source_type", "title_snapshot", "url_snapshot")}
            for source in record.get("sources", [])
        ]
        parts.append(json.dumps(source_fields, ensure_ascii=False))
    if record["kind"] == "article":
        path = get_library_dir() / record["path"]
        parts.append(_file_hash(path, get_library_dir().resolve()))
    return _hash(json.dumps(parts, ensure_ascii=False).encode())


def _reverse_links(body: str, manifest: dict) -> str:
    mapping = {Path(p).with_suffix("").as_posix(): r["source_id"] for p, r in manifest.items()}

    def replace(match):
        target, sep, label = match.group(1).partition("|")
        base, hash_sep, heading = target.partition("#")
        source = mapping.get(base.removesuffix(".md"))
        return (
            "[["
            + (source + hash_sep + heading if source else target)
            + (sep + label if sep else "")
            + "]]"
        )

    return re.sub(r"\[\[([^\]\n]+)\]\]", replace, body)


@captured_library
def preview() -> dict:
    root = _root()
    cfg = configuration()
    with session() as db:
        manifest = {
            r["relative_path"]: dict(r) for r in db.execute("SELECT * FROM markdown_sync_files")
        }
    items = []
    ids = {}
    for path in sorted(root.rglob("*.md")):
        relative = path.relative_to(root).as_posix()
        if any(p.startswith(".") for p in path.relative_to(root).parts):
            continue
        try:
            _safe(root, relative)
            meta, _body = _parse(path)
            file_hash = _file_hash(path, root)
            baseline = manifest.get(relative)
            if not baseline and not meta.get("zhilib_source"):
                renamed = [
                    r
                    for p, r in manifest.items()
                    if r["file_hash"] == file_hash and not _safe(root, p).exists()
                ]
                if len(renamed) == 1:
                    baseline = renamed[0]
            source_id = meta.get("zhilib_source") or (baseline["source_id"] if baseline else None)
            if source_id and not isinstance(source_id, str):
                raise ValueError("资料 ID 无效")
            if source_id and meta.get("zhilib_library", cfg["library_id"]) != cfg["library_id"]:
                items.append(
                    {
                        "path": relative,
                        "status": "foreign",
                        "message": "来自其他资料库，请移除 zhilib_source 后作为新文章导入",
                    }
                )
                continue
            if source_id:
                record = _record(source_id)
                current_hash = _record_hash(record)
                if baseline:
                    file_changed = file_hash != baseline["file_hash"]
                    local_changed = current_hash != baseline["record_hash"]
                    state = (
                        "conflict"
                        if file_changed and local_changed
                        else "update"
                        if file_changed or baseline["relative_path"] != relative
                        else "export"
                        if local_changed
                        else "unchanged"
                    )
                else:
                    state = "adopt"
                ids.setdefault(source_id, []).append(len(items))
            else:
                state = "new"
            items.append(
                {
                    "path": relative,
                    "status": state,
                    "source_id": source_id,
                    "file_hash": file_hash,
                    "record_hash": current_hash if source_id else None,
                    "title": str(meta.get("title") or path.stem)[:1000],
                }
            )
        except (OSError, ValueError, LookupError, UnicodeError, yaml.YAMLError) as error:
            items.append(
                {
                    "path": relative,
                    "status": "error",
                    "message": str(error)
                    if isinstance(error, (ValueError, LookupError))
                    else type(error).__name__,
                }
            )
    for indices in ids.values():
        if len(indices) > 1:
            for i in indices:
                items[i]["status"] = "conflict"
                items[i]["message"] = "同一资料 ID 出现在多个文件中"
    present = {x["path"] for x in items}
    items.extend(
        {
            "path": p,
            "source_id": r["source_id"],
            "status": "missing",
            "message": "外部文件已删除，本地资料保留",
        }
        for p, r in manifest.items()
        if p not in present
    )
    return {"directory": str(root), "auto_sync": cfg["auto_sync"], "items": items}


def _manifest(path: str, source_id: str, file_hash: str, record_hash: str) -> None:
    with session() as db:
        db.execute(
            "DELETE FROM markdown_sync_files WHERE source_id=? AND relative_path!=?",
            (source_id, path),
        )
        db.execute(
            "INSERT OR REPLACE INTO markdown_sync_files VALUES (?,?,?,?,?)",
            (path, source_id, file_hash, record_hash, now()),
        )


@captured_library
def export_all() -> dict:
    with _LOCK:
        root = _root()
        cfg = configuration()
        records = _records(None, None)
        sources = [r["source_id"] for r in records]
        with session() as db:
            manifest = {
                r["source_id"]: dict(r) for r in db.execute("SELECT * FROM markdown_sync_files")
            }
        mapping = {
            sid: manifest.get(sid, {}).get("relative_path", sid.replace(":", "/") + ".md")
            for sid in sources
        }
        titles = {}
        for r in records:
            titles.setdefault(r["title"], []).append(r["source_id"])
        results = []
        for sid in sources:
            try:
                record = _record(sid)
                relative = mapping[sid]
                path = _safe(root, relative)
                baseline = manifest.get(sid)
                if path.exists() and (
                    not baseline or _file_hash(path, root) != baseline["file_hash"]
                ):
                    results.append(
                        {
                            "path": relative,
                            "status": "conflict",
                            "message": "外部文件有未导入修改，未覆盖",
                        }
                    )
                    continue
                if baseline and _record_hash(record) == baseline["record_hash"]:
                    results.append({"path": relative, "status": "unchanged"})
                    continue
                body = record["body"]

                def wikilink(match):
                    target, sep, label = match.group(1).partition("|")
                    base, hash_sep, heading = target.partition("#")
                    candidates = [base] if base in mapping else titles.get(base, [])
                    if len(candidates) != 1:
                        return match.group(0)
                    return (
                        "[["
                        + Path(mapping[candidates[0]]).with_suffix("").as_posix()
                        + hash_sep
                        + heading
                        + (sep + label if sep else "|" + base)
                        + "]]"
                    )

                body = re.sub(r"\[\[([^\]\n]+)\]\]", wikilink, body)
                if record["kind"] == "article":
                    asset_dir = (get_library_dir() / record["path"]).parent / "assets"
                    if asset_dir.is_dir():
                        for asset in asset_dir.iterdir():
                            if (
                                asset.is_file()
                                and not asset.is_symlink()
                                and asset.suffix.lower() in SUFFIXES
                            ):
                                destination = _safe(root, f"assets/{record['id']}/{asset.name}")
                                if (
                                    not destination.exists()
                                    or destination.read_bytes() != asset.read_bytes()
                                ):
                                    if destination.exists() and not baseline:
                                        raise ValueError("附件有未管理的修改，未覆盖")
                                    _atomic(root, destination, asset.read_bytes())
                    prefix = Path(relative).parent
                    asset_relative = Path("assets") / record["id"]
                    body = body.replace(
                        "(assets/",
                        "(" + os.path.relpath(asset_relative, prefix).replace("\\", "/") + "/",
                    )
                metadata = {
                    "zhilib_source": sid,
                    "zhilib_library": cfg["library_id"],
                    "title": record["title"],
                    "source_url": record.get("url"),
                    "author": record.get("author"),
                    "question": record.get("question"),
                    **({
                        "zhilib_kind": "personal_note",
                        "tags": record.get("tags", []),
                        "sources": record.get("sources", []),
                    } if record["kind"] == "personal_note" else {}),
                }
                output = (
                    "---\n"
                    + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False)
                    + "---\n"
                    + body
                ).encode()
                _atomic(root, path, output)
                if record.get("sources"):
                    _atomic(
                        root,
                        _safe(
                            root,
                            ".zhilib/evidence/" + record["kind"] + "-" + record["id"] + ".json",
                        ),
                        json.dumps(record["sources"], ensure_ascii=False).encode(),
                    )
                _manifest(relative, sid, _file_hash(path, root), _record_hash(record))
                results.append({"path": relative, "status": "exported"})
            except (OSError, ValueError, LookupError) as error:
                results.append(
                    {"path": mapping[sid], "status": "error", "message": type(error).__name__}
                )
        return {"directory": str(root), "items": results}


def _import_images(body: str, path: Path, root: Path, content_id: str, write: bool = True) -> str:
    library = get_library_dir().resolve()
    destination = library / "articles" / content_id / "assets"

    def image(match):
        url = match.group(1)
        if urlparse(url).scheme:
            return match.group(0)
        source = _asset_path(path, root, url)
        if not source.is_relative_to(root):
            raise ValueError("图片路径越界")
        if not source.is_file():
            return match.group(0)
        if source.suffix.lower() not in SUFFIXES or source.stat().st_size > 20 * 1024 * 1024:
            raise ValueError("不支持的图片格式或大小")
        data = source.read_bytes()
        if source.parent == root / "assets" / content_id:
            name = source.name
        else:
            name = _hash(data)[:24] + source.suffix.lower()
        if write:
            _atomic(library, destination / name, data)
        return match.group(0).replace(url, "assets/" + name)

    return IMAGE.sub(image, body)


@captured_library
def apply(
    paths: list[str], expected: dict[str, str] | None = None, merged: dict[str, str] | None = None
) -> dict:
    with _LOCK:
        root = _root()
        check = {x["path"]: x for x in preview()["items"]}
        with session() as db:
            manifest = {
                r["relative_path"]: dict(r) for r in db.execute("SELECT * FROM markdown_sync_files")
            }
        results = []
        for relative in dict.fromkeys(paths):
            item = check.get(relative)
            resolve = bool(
                item
                and item["status"] == "conflict"
                and merged
                and merged.get(relative) == item.get("record_hash")
                and expected
                and expected.get(relative) == item.get("file_hash")
            )
            if not item or (item["status"] not in {"new", "update", "adopt"} and not resolve):
                results.append(
                    {"path": relative, "status": "skipped", "message": "冲突或不需要导入"}
                )
                continue
            if expected and expected.get(relative) != item["file_hash"]:
                results.append(
                    {
                        "path": relative,
                        "status": "conflict",
                        "message": "预览后文件已修改，请重新预览",
                    }
                )
                continue
            path = _safe(root, relative)
            try:
                if _file_hash(path, root) != item["file_hash"]:
                    raise ValueError("文件已修改，请重新预览")
                if resolve:
                    # Duplicate IDs are never resolved by replacing a record.
                    duplicates = [
                        x
                        for x in check.values()
                        if x.get("source_id") == item.get("source_id") and x["status"] != "missing"
                    ]
                    if len(duplicates) != 1:
                        raise ValueError("请先移除重复 ID 的文件")
                    original = _record(item["source_id"])
                    backup = ".zhilib/conflicts/" + uuid.uuid4().hex
                    _atomic(root, _safe(root, backup + "/local.md"), original["body"].encode())
                    _atomic(root, _safe(root, backup + "/external.md"), path.read_bytes())
                meta, body = _parse(path)
                body = _reverse_links(body, manifest)
                title = str(
                    meta.get("title")
                    or next(iter(re.findall(r"^#\s+(.+)$", body, re.MULTILINE)), path.stem)
                )[:1000]
                sid = item.get("source_id")
                if not sid:
                    prepared = (
                        body
                        if re.search(r"^#\s+", body, re.MULTILINE)
                        else "# " + title + "\n\n" + body
                    )
                    _import_images(prepared, path, root, "validation", write=False)
                    content = import_markdown(path.name, prepared.encode())
                    sid = "article:" + content["id"]
                    body = _import_images(prepared, path, root, content["id"])
                    target = get_library_dir() / content["markdown_path"]
                    _atomic(get_library_dir().resolve(), target, body.encode())
                    with session() as db:
                        db.execute(
                            "UPDATE contents SET title=?,content_hash=?,author=?,url=? WHERE id=?",
                            (
                                title,
                                _hash(body.encode()),
                                str(meta.get("author") or "")[:300],
                                _safe_url(meta.get("source_url") or meta.get("url")),
                                content["id"],
                            ),
                        )
                        db.execute(
                            "DELETE FROM content_search WHERE content_id=?", (content["id"],)
                        )
                        db.execute(
                            "INSERT INTO content_search VALUES (?,?,?)",
                            (content["id"], title, body),
                        )
                else:
                    record = _record(sid)
                    kind = record["kind"]
                    rid = record["id"]
                    if _record_hash(record) != item["record_hash"]:
                        raise ValueError("本地资料已修改，请重新预览")
                    if kind == "article":
                        body = _import_images(body, path, root, rid)
                        _atomic(
                            get_library_dir().resolve(),
                            get_library_dir() / record["path"],
                            body.encode(),
                        )
                        with session() as db:
                            db.execute(
                                "UPDATE contents SET title=?,content_hash=?,updated_at=? WHERE id=?",
                                (title, _hash(body.encode()), now(), rid),
                            )
                            db.execute("DELETE FROM content_search WHERE content_id=?", (rid,))
                            db.execute(
                                "INSERT INTO content_search VALUES (?,?,?)", (rid, title, body)
                            )
                    elif kind == "note":
                        patch_note(
                            rid, {"title": title, "body_md": body, "revision": record["revision"]}
                        )
                    elif kind == "annotation":
                        patch_annotation(rid, {"comment_md": body, "revision": record["revision"]})
                    elif kind == "research":
                        save_research(rid, title, body, record["revision"])
                    elif kind == "personal_note":
                        update_personal_note(rid, {
                            "title": title,
                            "body_md": body,
                            "revision": record["revision"],
                            "tags": meta.get("tags", record.get("tags", [])),
                        })
                    else:
                        knowledge_graph.save_topic(title, body, rid, record["revision"])
                if sid.startswith("article:"):
                    record = _record(sid)
                    metadata_path = (get_library_dir() / record["path"]).with_name("metadata.json")
                    metadata = (
                        json.loads(metadata_path.read_text()) if metadata_path.is_file() else {}
                    )
                    metadata.update(
                        title=record["title"],
                        author=record.get("author"),
                        url=record.get("url"),
                        content_hash=_hash(record["body"].encode()),
                    )
                    _atomic(
                        get_library_dir(),
                        metadata_path,
                        json.dumps(metadata, ensure_ascii=False).encode(),
                    )
                _manifest(relative, sid, _file_hash(path, root), _record_hash(_record(sid)))
                results.append({"path": relative, "source_id": sid, "status": "imported"})
            except (
                OSError,
                ValueError,
                RuntimeError,
                LookupError,
                UnicodeError,
                yaml.YAMLError,
            ) as error:
                results.append(
                    {
                        "path": relative,
                        "status": "error",
                        "message": str(error)
                        if isinstance(error, (ValueError, RuntimeError, LookupError))
                        else type(error).__name__,
                    }
                )
        return {"items": results}


def _safe_url(value) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    return (
        value
        if parsed.scheme in {"http", "https"}
        and parsed.netloc
        and not parsed.username
        and not parsed.password
        else None
    )


@captured_library
def sync_safe() -> dict:
    data = preview()
    safe = [x["path"] for x in data["items"] if x["status"] in {"new", "update"}]
    imported = (
        apply(safe, {x["path"]: x["file_hash"] for x in data["items"] if "file_hash" in x})
        if safe
        else {"items": []}
    )
    return {"imports": imported, "exports": export_all()}
