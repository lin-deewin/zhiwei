from __future__ import annotations

import json
import uuid

from app.core.database import session
from app.services.library import now


def _catalog() -> dict[str, dict]:
    from app.services.knowledge_graph import nodes

    return {item["source_id"]: item for item in nodes()}


def _validated_sources(note_id: str, source_ids: list[str]) -> list[dict]:
    if len(source_ids) > 32:
        raise ValueError("一篇个人笔记最多引用 32 份资料")
    catalog = _catalog()
    unique = list(dict.fromkeys(source_ids))
    own_id = "personal_note:" + note_id
    if own_id in unique:
        raise ValueError("个人笔记不能引用自身")
    missing = [source_id for source_id in unique if source_id not in catalog]
    if missing:
        raise ValueError("引用资料不存在或已删除，请刷新后重新选择")
    return [catalog[source_id] for source_id in unique]


def _validated_tags(tags: list[str] | None) -> list[str] | None:
    if tags is None:
        return None
    if len(tags) > 12:
        raise ValueError("每条个人笔记最多添加 12 个标签")
    result: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        tag = str(raw).strip()
        if not tag or len(tag) > 24 or any(ord(character) < 32 for character in tag):
            raise ValueError("标签不能为空，且长度不能超过 24 个字符")
        key = tag.casefold()
        if key not in seen:
            seen.add(key)
            result.append(tag)
    return result


def _tags(db, note_id: str) -> list[str]:
    rows = db.execute(
        "SELECT tag FROM personal_note_tags WHERE note_id=? ORDER BY tag COLLATE NOCASE",
        (note_id,),
    ).fetchall()
    return [row[0] for row in rows]


def _sources(db, note_id: str) -> list[dict]:
    return [
        dict(row)
        for row in db.execute(
            "SELECT source_id,source_type,title_snapshot,url_snapshot,created_at "
            "FROM personal_note_sources WHERE note_id=? ORDER BY created_at,source_id",
            (note_id,),
        )
    ]


def get_personal_note(note_id: str) -> dict:
    with session() as db:
        row = db.execute("SELECT * FROM personal_notes WHERE id=?", (note_id,)).fetchone()
        if not row:
            raise LookupError("个人笔记不存在")
        result = dict(row)
        result["sources"] = _sources(db, note_id)
        result["tags"] = _tags(db, note_id)
    available = set(_catalog())
    for source in result["sources"]:
        source["available"] = source["source_id"] in available
    return result


def list_personal_notes(q: str = "", page: int = 1, page_size: int = 20) -> dict:
    query = q.strip()[:300]
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    where = ""
    params: tuple = ()
    if query:
        where = """WHERE n.title LIKE ? OR n.body_md LIKE ?
                   OR EXISTS (SELECT 1 FROM personal_note_tags t
                              WHERE t.note_id=n.id AND t.tag LIKE ?)"""
        params = (f"%{query}%", f"%{query}%", f"%{query}%")
    with session() as db:
        total = db.execute(f"SELECT COUNT(*) FROM personal_notes n {where}", params).fetchone()[0]
        rows = db.execute(
            f"""SELECT n.id,n.title,n.revision,n.created_at,n.updated_at,
                       substr(n.body_md,1,180) AS excerpt,
                       (SELECT COUNT(*) FROM personal_note_sources s WHERE s.note_id=n.id) AS source_count
                FROM personal_notes n {where}
                ORDER BY n.updated_at DESC,n.id LIMIT ? OFFSET ?""",
            (*params, page_size, (page - 1) * page_size),
        ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["tags"] = _tags(db, row["id"])
            items.append(item)
    return {"items": items, "total": total, "page": page, "page_size": page_size}
def create_personal_note(payload: dict) -> dict:
    title = str(payload.get("title") or "").strip()[:1000]
    body = str(payload.get("body_md") or "")
    if len(body) > 100000:
        raise ValueError("笔记正文不能超过 100000 个字符")
    note_id = uuid.uuid4().hex
    source_ids = payload.get("source_ids") or []
    sources = _validated_sources(note_id, source_ids) if source_ids else []
    tags = _validated_tags(payload.get("tags", [])) or []
    timestamp = now()
    with session() as db:
        db.execute(
            "INSERT INTO personal_notes(id,title,body_md,revision,created_at,updated_at) VALUES(?,?,?,1,?,?)",
            (note_id, title, body, timestamp, timestamp),
        )
        for source in sources:
            db.execute(
                "INSERT INTO personal_note_sources(note_id,source_id,source_type,title_snapshot,url_snapshot,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (note_id, source["source_id"], source["source_type"], source["title"],
                 source.get("url"), timestamp),
            )
        for tag in tags:
            db.execute("INSERT INTO personal_note_tags(note_id,tag,created_at) VALUES(?,?,?)", (note_id, tag, timestamp))
        snapshot = _sources(db, note_id)
        db.execute(
            """INSERT INTO personal_note_versions(note_id,revision,title,body_md,sources_json,created_at)
               VALUES(?,1,?,?,?,?)""",
            (note_id, title, body, json.dumps(snapshot, ensure_ascii=False), timestamp),
        )
    return get_personal_note(note_id)
def update_personal_note(note_id: str, payload: dict) -> dict:
    title = str(payload.get("title") or "").strip()[:1000]
    body = str(payload.get("body_md") or "")
    if len(body) > 100000:
        raise ValueError("笔记正文不能超过 100000 个字符")
    source_ids = payload.get("source_ids")
    sources = _validated_sources(note_id, source_ids) if source_ids is not None else None
    tags = _validated_tags(payload.get("tags"))
    timestamp = now()
    with session() as db:
        row = db.execute("SELECT revision FROM personal_notes WHERE id=?", (note_id,)).fetchone()
        if not row:
            raise LookupError("个人笔记不存在")
        if row["revision"] != payload.get("revision"):
            raise RuntimeError("个人笔记已在其他位置修改，请刷新后再保存")
        changed = db.execute(
            "UPDATE personal_notes SET title=?,body_md=?,revision=revision+1,updated_at=? "
            "WHERE id=? AND revision=?",
            (title, body, timestamp, note_id, payload["revision"]),
        ).rowcount
        if not changed:
            raise RuntimeError("个人笔记已在其他位置修改，请刷新后再保存")
        if sources is not None:
            db.execute("DELETE FROM personal_note_sources WHERE note_id=?", (note_id,))
            for source in sources:
                db.execute(
                    "INSERT INTO personal_note_sources(note_id,source_id,source_type,title_snapshot,url_snapshot,created_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (note_id, source["source_id"], source["source_type"], source["title"],
                     source.get("url"), timestamp),
                )
        if tags is not None:
            db.execute("DELETE FROM personal_note_tags WHERE note_id=?", (note_id,))
            for tag in tags:
                db.execute("INSERT INTO personal_note_tags(note_id,tag,created_at) VALUES(?,?,?)", (note_id, tag, timestamp))
        snapshot = _sources(db, note_id)
        db.execute(
            """INSERT INTO personal_note_versions(note_id,revision,title,body_md,sources_json,created_at)
               VALUES(?,?,?,?,?,?)""",
            (note_id, payload["revision"] + 1, title, body, json.dumps(snapshot, ensure_ascii=False), timestamp),
        )
    return get_personal_note(note_id)
def delete_personal_note(note_id: str, revision: int) -> None:
    source_id = "personal_note:" + note_id
    with session() as db:
        row = db.execute("SELECT revision FROM personal_notes WHERE id=?", (note_id,)).fetchone()
        if not row:
            raise LookupError("个人笔记不存在")
        if row["revision"] != revision:
            raise RuntimeError("个人笔记已在其他位置修改，请刷新后再删除")
        db.execute("DELETE FROM knowledge_links WHERE from_id=? OR to_id=?", (source_id, source_id))
        db.execute("DELETE FROM personal_notes WHERE id=? AND revision=?", (note_id, revision))



def list_personal_note_versions(note_id: str) -> list[dict]:
    with session() as db:
        if not db.execute("SELECT 1 FROM personal_notes WHERE id=?", (note_id,)).fetchone():
            raise LookupError("个人笔记不存在")
        rows = db.execute(
            """SELECT revision,title,created_at,length(body_md) AS body_length,sources_json
               FROM personal_note_versions WHERE note_id=? ORDER BY revision DESC""",
            (note_id,),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["source_count"] = len(json.loads(item.pop("sources_json")))
        result.append(item)
    return result


def get_personal_note_version(note_id: str, revision: int) -> dict:
    with session() as db:
        row = db.execute(
            """SELECT revision,title,body_md,sources_json,created_at
               FROM personal_note_versions WHERE note_id=? AND revision=?""",
            (note_id, revision),
        ).fetchone()
        if not row:
            raise LookupError("个人笔记版本不存在")
    result = dict(row)
    result["sources"] = json.loads(result.pop("sources_json"))
    return result



def delete_personal_notes(items: list[dict]) -> dict:
    if not items or len(items) > 50:
        raise ValueError("批量删除需要选择 1 到 50 条笔记")
    unique: dict[str, int] = {}
    for item in items:
        note_id = str(item.get("id", "")).strip()
        revision = int(item.get("revision", 0))
        if not note_id or revision < 1:
            raise ValueError("批量删除参数无效")
        if note_id in unique:
            raise ValueError("批量删除列表中存在重复笔记")
        unique[note_id] = revision

    with session() as db:
        for note_id, revision in unique.items():
            row = db.execute("SELECT revision FROM personal_notes WHERE id=?", (note_id,)).fetchone()
            if not row:
                raise LookupError("所选个人笔记中有记录已不存在，请刷新列表")
            if row["revision"] != revision:
                raise RuntimeError("所选个人笔记已被修改，请刷新列表后重试")
        for note_id in unique:
            source_id = "personal_note:" + note_id
            db.execute("DELETE FROM knowledge_links WHERE from_id=? OR to_id=?", (source_id, source_id))
            db.execute("DELETE FROM personal_notes WHERE id=?", (note_id,))
    return {"deleted": len(unique)}
