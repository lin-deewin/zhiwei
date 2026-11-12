from __future__ import annotations

import sqlite3

import pytest

from app.core.backup import backup_library, restore_library, verify_backup


def _make_library(path):
    (path / "app-data").mkdir(parents=True)
    (path / "articles" / "article-1").mkdir(parents=True)
    connection = sqlite3.connect(path / "app-data" / "library.sqlite")
    connection.execute("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    connection.execute("INSERT INTO sample(value) VALUES('before backup')")
    connection.commit()
    connection.close()
    (path / "articles" / "article-1" / "article.md").write_text("# Article\n\nOriginal body", encoding="utf-8")
    (path / "app-data" / "settings.json").write_text('{"theme":"light"}', encoding="utf-8")


def test_backup_verify_and_restore_round_trip(tmp_path):
    source = tmp_path / "library"
    backup = tmp_path / "backup"
    restored = tmp_path / "restored"
    _make_library(source)

    created = backup_library(source, backup)
    assert created["file_count"] == 3
    assert verify_backup(backup)["valid"] is True

    (source / "articles" / "article-1" / "article.md").write_text("Changed after backup", encoding="utf-8")
    restored_report = restore_library(backup, restored)
    assert restored_report["database"]["integrity"] == "ok"
    assert (restored / "articles" / "article-1" / "article.md").read_text(encoding="utf-8") == "# Article\n\nOriginal body"
    connection = sqlite3.connect(restored / "app-data" / "library.sqlite")
    assert connection.execute("SELECT value FROM sample").fetchone()[0] == "before backup"
    connection.close()


def test_backup_verification_detects_modified_file(tmp_path):
    source = tmp_path / "library"
    backup = tmp_path / "backup"
    _make_library(source)
    backup_library(source, backup)
    (backup / "articles" / "article-1" / "article.md").write_text("tampered", encoding="utf-8")
    with pytest.raises(ValueError, match="checksum mismatch"):
        verify_backup(backup)


def test_backup_destination_must_be_outside_library_and_new(tmp_path):
    source = tmp_path / "library"
    _make_library(source)
    with pytest.raises(ValueError, match="must not contain one another"):
        backup_library(source, source / "backup")
    backup = tmp_path / "backup"
    backup.mkdir()
    with pytest.raises(FileExistsError):
        backup_library(source, backup)


@pytest.mark.skipif(__import__("os").name == "nt", reason="POSIX symlink semantics differ on Windows")
def test_backup_rejects_symlinks(tmp_path):
    source = tmp_path / "library"
    _make_library(source)
    (source / "articles" / "external-link").symlink_to(source / "articles" / "article-1", target_is_directory=True)
    with pytest.raises(ValueError, match="Symbolic links"):
        backup_library(source, tmp_path / "backup")
