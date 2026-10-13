from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from urllib.parse import urlparse

from app.core.config import get_library_dir
from app.core.database import session

CONTENT_WRITE_LOCK = RLock()


def is_content_deleted(content_id: str) -> bool:
    with session() as db:
        return db.execute(
            "SELECT 1 FROM deleted_contents WHERE content_id=?", (content_id,)
        ).fetchone() is not None


def delete_content(content_id: str) -> bool:
    """Remove the owned article directory and retain a sync exclusion record."""
    with CONTENT_WRITE_LOCK, session() as db:
        row = db.execute("SELECT markdown_path FROM contents WHERE id=?", (content_id,)).fetchone()
        if not row:
            return db.execute(
                "SELECT 1 FROM deleted_contents WHERE content_id=?", (content_id,)
            ).fetchone() is not None
        if not re.fullmatch(r"(?:local_[a-f0-9]{32}|zhihu_(?:article|answer)_\d{1,30})", content_id):
            raise ValueError("文章标识无效，无法安全删除")
        root = get_library_dir().resolve()
        directory = root / "articles" / content_id
        expected = directory / "article.md"
        if (Path(row["markdown_path"]) != Path("articles") / content_id / "article.md"
                or directory.resolve() != directory or expected.is_symlink()
                or not directory.resolve().is_relative_to(root)
                or not expected.resolve().is_relative_to(directory.resolve())):
            raise ValueError("文章路径不安全，无法删除")
        db.execute(
            "INSERT OR IGNORE INTO deleted_contents(content_id,deleted_at) VALUES (?,?)",
            (content_id, now()),
        )
        if directory.exists():
            shutil.rmtree(directory)
        db.execute("DELETE FROM content_search WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM note_search WHERE content_id=?", (content_id,))
        db.execute("UPDATE reading_ai_jobs SET status='cancelled',stage='cancelled',cancel_requested=1,updated_at=? WHERE content_id=? AND status IN ('queued','running')",
                   (now(), content_id))
        db.execute("DELETE FROM reading_ai_results WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM reading_ai_jobs WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM annotations WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM notes WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM reading_content_state WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM content_revisions WHERE content_id=?", (content_id,))
        db.execute("DELETE FROM contents WHERE id=?", (content_id,))
    return True


def now() -> str:
    return datetime.now(UTC).isoformat()


def clean_title(value: str) -> str:
    value = re.sub(r"<[^>]*>", "", value).strip()
    return value[:300] or "未命名文章"


def excerpt(markdown: str, limit: int = 180) -> str:
    text = re.sub(r"```.*?```", " ", markdown, flags=re.DOTALL)
    text = re.sub(r"!\[[^]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[#>*`_~|-]", " ", text)
    return " ".join(text.split())[:limit]


def _question_ref(content: dict, metadata: dict) -> dict[str, str] | None:
    if content["kind"] != "answer":
        return None
    source = urlparse(str(content.get("url") or ""))
    match = re.fullmatch(r"/question/(\d{1,30})/answer/(\d{1,30})/?", source.path)
    source_id = (match.group(1) if match and source.scheme == "https"
                 and source.hostname == "www.zhihu.com"
                 and match.group(2) == str(content.get("remote_id") or "") else None)
    saved = metadata.get("question")
    saved_id = str(saved.get("id") or "") if isinstance(saved, dict) else ""
    if source_id and saved_id and source_id != saved_id:
        saved_id = ""
    question_id = source_id or (saved_id if re.fullmatch(r"\d{1,30}", saved_id) else None)
    if not question_id:
        return None
    saved_title = saved.get("title") if isinstance(saved, dict) and saved_id == question_id else None
    title = saved_title.strip() if isinstance(saved_title, str) and saved_title.strip() else content["title"]
    return {"id": question_id, "title": title[:300],
            "url": f"https://www.zhihu.com/question/{question_id}"}


def list_contents(q: str = "", category_id: int | None = None, folder_id: str | None = None,
                  page: int = 1, page_size: int = 20, pending_only: bool = False,
                  sort: str = "synced", source: str = "all") -> dict:
    clauses: list[str] = []
    params: list[object] = []
    if source == "local":
        clauses.append("substr(c.id, 1, 6) = 'local_'")
    elif source in {"answer", "article"}:
        clauses.append("c.kind = ? AND substr(c.id, 1, 6) != 'local_'")
        params.append(source)
    if q:
        if len(q) >= 3:
            escaped = q.replace('"', '""')
            clauses.append("c.id IN (SELECT content_id FROM content_search WHERE content_search MATCH ?)")
            params.append(f'"{escaped}"')
        else:
            clauses.append("c.id IN (SELECT content_id FROM content_search WHERE body LIKE ? OR title LIKE ?)")
            params.extend([f"%{q}%", f"%{q}%"])
    if category_id is not None:
        clauses.append("c.category_id IN (SELECT id FROM categories WHERE id=? OR parent_id=?)")
        params.extend([category_id, category_id])
    if pending_only:
        clauses.append("c.category_id IS NULL")
    if folder_id:
        clauses.append("EXISTS (SELECT 1 FROM folder_contents fc WHERE fc.content_id=c.id AND fc.folder_id=?)")
        params.append(folder_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    order = "c.title COLLATE NOCASE ASC, c.id ASC" if sort == "title" else "c.last_synced_at DESC, c.collected_at DESC, c.created_at DESC, c.id DESC"
    with session() as db:
        total = db.execute(f"SELECT COUNT(*) FROM contents c{where}", params).fetchone()[0]
        rows = db.execute(
            f"""SELECT c.*,
                cat.name AS category_name, parent.name AS category_parent_name
                FROM contents c LEFT JOIN categories cat ON cat.id=c.category_id
                LEFT JOIN categories parent ON parent.id=cat.parent_id{where}
                ORDER BY {order} LIMIT ? OFFSET ?""",
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        return {"items": [dict(row) for row in rows], "total": total, "page": page,
                "page_size": page_size}


def get_content(content_id: str) -> dict | None:
    with session() as db:
        row = db.execute(
            """SELECT c.*, cat.name AS category_name, parent.name AS category_parent_name
               FROM contents c LEFT JOIN categories cat ON cat.id=c.category_id
               LEFT JOIN categories parent ON parent.id=cat.parent_id WHERE c.id=?""", (content_id,)
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        path = (get_library_dir() / result["markdown_path"]).resolve()
        valid_path = path.is_relative_to(get_library_dir().resolve())
        if not valid_path or not path.is_file():
            result["markdown"] = ""
            result["file_missing"] = True
        else:
            result["markdown"] = path.read_text(encoding="utf-8")
            result["file_missing"] = False
        metadata: dict = {}
        try:
            loaded = json.loads(path.with_name("metadata.json").read_text(encoding="utf-8")) if valid_path else {}
            metadata = loaded if isinstance(loaded, dict) else {}
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        result["question"] = _question_ref(result, metadata)
        result["folders"] = [dict(r) for r in db.execute(
            """SELECT f.id, f.name, f.url FROM folders f JOIN folder_contents fc ON fc.folder_id=f.id
               WHERE fc.content_id=? AND fc.source_status='active'""", (content_id,)
        ).fetchall()]
        return result


def import_markdown(filename: str, data: bytes) -> dict:
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("Markdown 文件不能超过 10 MB")
    markdown = data.decode("utf-8-sig")
    title = clean_title(Path(filename).stem)
    first_heading = re.search(r"^#\s+(.+)$", markdown, re.MULTILINE)
    if first_heading:
        title = clean_title(first_heading.group(1))
    content_id = "local_" + uuid.uuid4().hex
    digest = hashlib.sha256(data).hexdigest()
    relative = Path("articles") / content_id / "article.md"
    target = (get_library_dir() / relative).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(target)
    timestamp = now()
    metadata = {
        "schema_version": 1,
        "id": content_id,
        "kind": "article",
        "title": title,
        "author": None,
        "url": None,
        "source": "local_import",
        "folder_ids": [],
        "question": None,
        "category_id": None,
        "content_hash": digest,
        "imported_at": timestamp,
    }
    metadata_path = target.parent / "metadata.json"
    metadata_tmp = metadata_path.with_suffix(".tmp")
    metadata_tmp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata_tmp.replace(metadata_path)
    with session() as db:
        db.execute(
            """INSERT INTO contents(id, kind, title, markdown_path, excerpt, content_hash,
               created_at, updated_at) VALUES (?, 'article', ?, ?, ?, ?, ?, ?)""",
            (content_id, title, relative.as_posix(), excerpt(markdown), digest, timestamp, timestamp),
        )
        db.execute("INSERT INTO content_search(content_id, title, body) VALUES (?, ?, ?)",
                   (content_id, title, markdown))
    return get_content(content_id) or {}


def set_classification(content_id: str, category_id: int | None) -> dict | None:
    with session() as db:
        if not db.execute("SELECT 1 FROM contents WHERE id=?", (content_id,)).fetchone():
            return None
        if category_id is not None:
            category = db.execute("SELECT id FROM categories WHERE id=?", (category_id,)).fetchone()
            if not category:
                raise ValueError("所选分类不存在")
            if db.execute("SELECT 1 FROM categories WHERE parent_id=?", (category_id,)).fetchone():
                raise ValueError("请选择小类，或先为该大类创建子分类")
        db.execute("""UPDATE contents SET category_id=?,
                   classification_source=CASE WHEN ? IS NULL THEN 'none' ELSE 'manual' END,
                   classification_locked=CASE WHEN ? IS NULL THEN 0 ELSE 1 END,
                   classification_reason='', classified_content_hash=NULL WHERE id=?""",
                   (category_id, category_id, category_id, content_id))
        saved = db.execute("SELECT markdown_path FROM contents WHERE id=?", (content_id,)).fetchone()
    metadata_path = (get_library_dir() / saved["markdown_path"]).parent / "metadata.json"
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["category_id"] = category_id
            metadata["classification_source"] = "manual" if category_id is not None else "none"
            metadata["classification_reason"] = ""
            temporary = metadata_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(metadata_path)
        except (OSError, json.JSONDecodeError):
            pass
    return get_content(content_id)


def set_model_classification(content_id: str, category_id: int, reason: str) -> dict | None:
    with session() as db:
        current = db.execute("SELECT classification_locked,content_hash FROM contents WHERE id=?", (content_id,)).fetchone()
        if not current:
            return None
        if current["classification_locked"]:
            raise PermissionError("这篇文章已由你手动确认分类")
        category = db.execute("SELECT id FROM categories WHERE id=?", (category_id,)).fetchone()
        if not category:
            raise ValueError("模型返回的分类不存在")
        if db.execute("SELECT 1 FROM categories WHERE parent_id=?", (category_id,)).fetchone():
            raise ValueError("模型必须选择可用的小类")
        current_hash = current["content_hash"]
        db.execute("""UPDATE contents SET category_id=?, classification_source='model',
                   classification_locked=0, classification_reason=?, classified_content_hash=? WHERE id=?""",
                   (category_id, reason[:300], current_hash, content_id))
        saved = db.execute("SELECT markdown_path FROM contents WHERE id=?", (content_id,)).fetchone()
    metadata_path = (get_library_dir() / saved["markdown_path"]).parent / "metadata.json"
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["category_id"] = category_id
            metadata["classification_source"] = "model"
            metadata["classification_reason"] = reason[:300]
            temporary = metadata_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(metadata_path)
        except (OSError, json.JSONDecodeError):
            pass
    return get_content(content_id)


def set_rules_classification(content_id: str, category_id: int | None, reason: str,
                             content_hash: str) -> dict | None:
    """Save an offline suggestion without taking the user's manual lock."""
    with session() as db:
        current = db.execute(
            "SELECT classification_locked,content_hash FROM contents WHERE id=?", (content_id,)
        ).fetchone()
        if not current:
            return None
        if current["classification_locked"]:
            raise PermissionError("这篇文章已由你手动确认分类")
        if current["content_hash"] != content_hash:
            raise ValueError("正文哈希已变化，请重新读取后分类")
        previous = db.execute(
            "SELECT category_id,classification_source,classification_locked,classification_reason,classified_content_hash,markdown_path FROM contents WHERE id=?",
            (content_id,),
        ).fetchone()
        if category_id is not None:
            category = db.execute("SELECT id,parent_id FROM categories WHERE id=?", (category_id,)).fetchone()
            if not category:
                raise ValueError("分类不存在")
            if db.execute("SELECT 1 FROM categories WHERE parent_id=?", (category_id,)).fetchone():
                raise ValueError("分类必须是小类")
        db.execute("""UPDATE contents SET category_id=?, classification_source=?,
                   classification_locked=0, classification_reason=?, classified_content_hash=?
                   WHERE id=?""", (category_id, "rules" if category_id is not None else "none",
                                    reason[:300], content_hash, content_id))
        saved = db.execute("SELECT markdown_path FROM contents WHERE id=?", (content_id,)).fetchone()
    if not _update_metadata_classification(saved["markdown_path"], category_id,
                                           "rules" if category_id is not None else "none", reason):
        with session() as db:
            db.execute("""UPDATE contents SET category_id=?,classification_source=?,classification_locked=?,
                         classification_reason=?,classified_content_hash=? WHERE id=?""",
                       (previous["category_id"], previous["classification_source"], previous["classification_locked"],
                        previous["classification_reason"], previous["classified_content_hash"], content_id))
        raise OSError("分类元数据写入失败")
    return get_content(content_id)


def _update_metadata_classification(markdown_path: str, category_id: int | None,
                                    source: str, reason: str) -> bool:
    metadata_path = (get_library_dir() / markdown_path).parent / "metadata.json"
    if not metadata_path.is_file():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["category_id"] = category_id
        metadata["classification_source"] = source
        metadata["classification_reason"] = reason[:300]
        temporary = metadata_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(metadata_path)
        return True
    except (OSError, json.JSONDecodeError):
        return False
