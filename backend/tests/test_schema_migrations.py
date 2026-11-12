from __future__ import annotations

import sqlite3

from app.core.database import connect, session, _initialize_schema
from app.services.library import import_markdown


def test_schema_migrations_are_versioned_and_idempotent(monkeypatch, tmp_path):
    library = tmp_path / "library"
    connection = connect(library)
    connection.close()

    with session(library) as db:
        assert db.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 4
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 4
        assert db.execute("SELECT name FROM schema_migrations WHERE version=2").fetchone()[0] == "personal_notes"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=3").fetchone()[0] == "reading_progress"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=4").fetchone()[0] == "personal_note_versions"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=4").fetchone()[0] == "personal_note_versions"
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='personal_note_sources'"
        ).fetchone()[0] == 1
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='reading_progress'"
        ).fetchone()[0] == 1
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='personal_note_versions'"
        ).fetchone()[0] == 1

    connection = connect(library)
    connection.close()
    with session(library) as db:
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=2").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=3").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=4").fetchone()[0] == 1


def test_legacy_migrations_preserve_existing_library_rows(monkeypatch, tmp_path):
    library = tmp_path / "library"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    item = import_markdown("legacy.md", "# 旧资料\n\n正文".encode())

    connection = sqlite3.connect(library / "app-data" / "library.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("DROP TABLE IF EXISTS personal_note_versions")
    connection.execute("DROP TABLE IF EXISTS reading_progress")
    connection.execute("DROP TABLE personal_note_sources")
    connection.execute("DROP TABLE personal_notes")
    connection.execute("DROP TABLE schema_migrations")
    connection.execute("UPDATE schema_version SET version=1")
    _initialize_schema(connection, library)
    connection.commit()
    connection.close()

    with session(library) as db:
        assert db.execute("SELECT title FROM contents WHERE id=?", (item["id"],)).fetchone()[0] == "旧资料"
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 4
        assert db.execute("SELECT name FROM schema_migrations WHERE version=2").fetchone()[0] == "personal_notes"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=3").fetchone()[0] == "reading_progress"
