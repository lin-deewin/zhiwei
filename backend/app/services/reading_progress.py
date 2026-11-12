from __future__ import annotations

import math

from app.core.database import session
from app.services.library import now


def _ensure_content(db, content_id: str) -> None:
    if not db.execute("SELECT 1 FROM contents WHERE id=?", (content_id,)).fetchone():
        raise LookupError("文章不存在")


def _serialize(row) -> dict:
    result = dict(row)
    result["progress_ratio"] = float(result["progress_ratio"])
    result["scroll_y"] = float(result["scroll_y"])
    result["read_later"] = bool(result["read_later"])
    return result


def get_reading_progress(content_id: str) -> dict:
    timestamp = now()
    with session() as db:
        _ensure_content(db, content_id)
        db.execute(
            """INSERT INTO reading_progress(content_id,progress_ratio,scroll_y,block_id,read_later,last_read_at,updated_at)
               VALUES(?,0,0,NULL,0,?,?)
               ON CONFLICT(content_id) DO UPDATE SET last_read_at=excluded.last_read_at,
                                                      updated_at=excluded.updated_at""",
            (content_id, timestamp, timestamp),
        )
        row = db.execute("SELECT * FROM reading_progress WHERE content_id=?", (content_id,)).fetchone()
    return _serialize(row)


def save_reading_progress(content_id: str, payload: dict) -> dict:
    try:
        ratio = float(payload.get("progress_ratio", 0))
        scroll_y = float(payload.get("scroll_y", 0))
    except (TypeError, ValueError) as error:
        raise ValueError("阅读进度必须是有效数字") from error
    if not math.isfinite(ratio) or not 0 <= ratio <= 1:
        raise ValueError("阅读进度必须在 0 到 1 之间")
    if not math.isfinite(scroll_y) or scroll_y < 0:
        raise ValueError("滚动位置不能是负数或非有限值")
    block_id = payload.get("block_id")
    if block_id is not None:
        block_id = str(block_id)
        if len(block_id) > 200:
            raise ValueError("正文区块标识过长")

    timestamp = now()
    with session() as db:
        _ensure_content(db, content_id)
        db.execute(
            """INSERT INTO reading_progress(content_id,progress_ratio,scroll_y,block_id,read_later,last_read_at,updated_at)
               VALUES(?,?,?,?,0,?,?)
               ON CONFLICT(content_id) DO UPDATE SET
                 progress_ratio=excluded.progress_ratio,
                 scroll_y=excluded.scroll_y,
                 block_id=excluded.block_id,
                 last_read_at=excluded.last_read_at,
                 updated_at=excluded.updated_at""",
            (content_id, ratio, scroll_y, block_id, timestamp, timestamp),
        )
        row = db.execute("SELECT * FROM reading_progress WHERE content_id=?", (content_id,)).fetchone()
    return _serialize(row)


def set_read_later(content_id: str, enabled: bool) -> dict:
    timestamp = now()
    with session() as db:
        _ensure_content(db, content_id)
        db.execute(
            """INSERT INTO reading_progress(content_id,progress_ratio,scroll_y,block_id,read_later,last_read_at,updated_at)
               VALUES(?,0,0,NULL,?,?,?)
               ON CONFLICT(content_id) DO UPDATE SET
                 read_later=excluded.read_later,
                 updated_at=excluded.updated_at""",
            (content_id, int(enabled), timestamp, timestamp),
        )
        row = db.execute("SELECT * FROM reading_progress WHERE content_id=?", (content_id,)).fetchone()
    return _serialize(row)


def _list(limit: int, *, later: bool) -> list[dict]:
    limit = min(100, max(1, int(limit)))
    where = "WHERE p.read_later=1" if later else ""
    order = "p.updated_at DESC" if later else "p.last_read_at DESC"
    with session() as db:
        rows = db.execute(
            f"""SELECT c.id,c.title,c.kind,c.author,c.url,c.excerpt,c.category_id,
                       p.progress_ratio,p.scroll_y,p.block_id,p.read_later,p.last_read_at,p.updated_at
                FROM reading_progress p
                JOIN contents c ON c.id=p.content_id
                {where}
                ORDER BY {order},c.id LIMIT ?""",
            (limit,),
        ).fetchall()
    return [_serialize(row) for row in rows]


def recently_read(limit: int = 50) -> list[dict]:
    return _list(limit, later=False)


def read_later(limit: int = 50) -> list[dict]:
    return _list(limit, later=True)
