from __future__ import annotations

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
        return result


def list_personal_notes(q: str = "", page: int = 1, page_size: int = 20) -> dict:
    query = q.strip()[:300]
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    where = "WHERE n.title LIKE ? OR n.body_md LIKE ?" if query else ""
    params = (f"%{query}%", f"%{query}%") if query else ()
    with session() as db:
        total = db.execute(
            f"SELECT COUNT(*) FROM personal_notes n {where}", params
        ).fetchone()[0]
        rows = db.execute(
            f"""SELECT n.id,n.title,n.revision,n.created_at,n.updated_at,
                       substr(n.body_md,1,180) AS excerpt,
                       (SELECT COUNT(*) FROM personal_note_sources s WHERE s.note_id=n.id) AS source_count
                FROM personal_notes n {where}
                ORDER BY n.updated_at DESC,n.id LIMIT ? OFFSET ?""",
            (*params, page_size, (page - 1) * page_size),
        ).fetchall()
    return {"items": [dict(row) for row in rows], "total": total, "page": page, "page_size": page_size}


def create_personal_note(payload: dict) -> dict:
    title = str(payload.get("title") or "").strip()[:1000]
    body = str(payload.get("body_md") or "")
    if len(body) > 100000:
        raise ValueError("笔记正文不能超过 100000 个字符")
    note_id = uuid.uuid4().hex
    source_ids = payload.get("source_ids") or []
    sources = _validated_sources(note_id, source_ids) if source_ids else []
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
    return get_personal_note(note_id)


def update_personal_note(note_id: str, payload: dict) -> dict:
    title = str(payload.get("title") or "").strip()[:1000]
    body = str(payload.get("body_md") or "")
    if len(body) > 100000:
        raise ValueError("笔记正文不能超过 100000 个字符")
    source_ids = payload.get("source_ids")
    sources = _validated_sources(note_id, source_ids) if source_ids is not None else None
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
