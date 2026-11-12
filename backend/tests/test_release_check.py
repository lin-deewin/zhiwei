from __future__ import annotations

import sqlite3

from app.core.backup import backup_library, restore_library
from app.release_check import compare, snapshot
from app.services.library import import_markdown
from app.services.personal_notes import create_personal_note


def _seed(monkeypatch, root):
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(root))
    article = import_markdown("source.md", "# 可靠来源\n\n正文保持不变".encode())
    create_personal_note({
        "title": "我的学习结论",
        "body_md": "先理解，再形成个人观点。",
        "source_ids": ["article:" + article["id"]],
        "tags": ["学习"],
    })
    return article


def test_backup_round_trip_preserves_ids_and_markdown_hashes(monkeypatch, tmp_path):
    source = tmp_path / "library"
    _seed(monkeypatch, source)
    backup = tmp_path / "backup"
    restored = tmp_path / "restored"
    backup_library(source, backup)
    restore_library(backup, restored)
    result = compare(source, restored)
    assert result["passed"], result["issues"]
    assert result["before"]["identities"]["personal_notes"]["count"] == 1
    assert result["before"]["identities"]["contents"]["count"] == 1
    assert result["before"]["article_file_count"] >= 1


def test_release_check_detects_article_file_mutation(monkeypatch, tmp_path):
    source = tmp_path / "library"
    _seed(monkeypatch, source)
    restored = tmp_path / "restored"
    backup_library(source, tmp_path / "backup")
    restore_library(tmp_path / "backup", restored)
    article_file = next((restored / "articles").rglob("*.md"))
    article_file.write_text("未经批准的新版本", encoding="utf-8")
    report = compare(source, restored)
    assert report["passed"] is False
    assert "文章文件清单或内容哈希发生变化" in report["issues"]


def test_release_check_detects_deleted_personal_note(monkeypatch, tmp_path):
    source = tmp_path / "library"
    _seed(monkeypatch, source)
    restored = tmp_path / "restored"
    backup_library(source, tmp_path / "backup")
    restore_library(tmp_path / "backup", restored)
    connection = sqlite3.connect(restored / "app-data/library.sqlite")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("DELETE FROM personal_notes")
    connection.commit()
    connection.close()
    report = compare(source, restored)
    assert report["passed"] is False
    assert "personal_notes: 稳定 ID 或数量发生变化" in report["issues"]


def test_snapshot_is_read_only_and_reports_schema_version(monkeypatch, tmp_path):
    source = tmp_path / "library"
    _seed(monkeypatch, source)
    before = (source / "app-data/library.sqlite").stat().st_mtime_ns
    report = snapshot(source)
    assert report["database_integrity"] == "ok"
    assert report["foreign_key_violations"] == 0
    assert report["schema_version"] == 6
    assert (source / "app-data/library.sqlite").stat().st_mtime_ns == before
