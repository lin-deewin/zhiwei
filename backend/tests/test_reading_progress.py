from __future__ import annotations

import pytest

from app.services import reading_progress
from app.services.library import delete_content, import_markdown
from app.core.database import session


def test_reading_progress_recent_and_read_later_lifecycle(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    item = import_markdown("reading.md", "# 阅读测试\n\n正文".encode())

    initial = reading_progress.get_reading_progress(item["id"])
    assert initial["progress_ratio"] == 0
    assert initial["read_later"] is False

    saved = reading_progress.save_reading_progress(item["id"], {
        "progress_ratio": 0.42, "scroll_y": 320, "block_id": "paragraph-2",
    })
    assert saved["progress_ratio"] == pytest.approx(0.42)
    assert saved["scroll_y"] == 320
    assert saved["block_id"] == "paragraph-2"

    later = reading_progress.set_read_later(item["id"], True)
    assert later["read_later"] is True
    assert reading_progress.recently_read()[0]["id"] == item["id"]
    assert reading_progress.read_later()[0]["id"] == item["id"]

    removed = reading_progress.set_read_later(item["id"], False)
    assert removed["read_later"] is False
    assert reading_progress.read_later() == []

    assert delete_content(item["id"])
    with session() as db:
        assert db.execute("SELECT 1 FROM reading_progress WHERE content_id=?", (item["id"],)).fetchone() is None


def test_reading_progress_rejects_invalid_values(monkeypatch, tmp_path):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(tmp_path / "library"))
    item = import_markdown("reading.md", "# 阅读测试\n\n正文".encode())

    with pytest.raises(ValueError):
        reading_progress.save_reading_progress(item["id"], {"progress_ratio": 1.2, "scroll_y": 0})
    with pytest.raises(ValueError):
        reading_progress.save_reading_progress(item["id"], {"progress_ratio": 0.5, "scroll_y": -1})
    with pytest.raises(LookupError):
        reading_progress.get_reading_progress("missing-content")
