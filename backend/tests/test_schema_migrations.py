from __future__ import annotations

import sqlite3

from app.core.database import connect, session, _initialize_schema
from app.services import personal_notes
from app.services.library import import_markdown


def test_schema_migrations_are_versioned_and_idempotent(monkeypatch, tmp_path):
    library = tmp_path / "library"
    connection = connect(library)
    connection.close()

    with session(library) as db:
        assert db.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 5
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 5
        assert db.execute("SELECT name FROM schema_migrations WHERE version=2").fetchone()[0] == "personal_notes"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=3").fetchone()[0] == "reading_progress"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=4").fetchone()[0] == "personal_note_versions"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=5").fetchone()[0] == "personal_note_tags"
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='personal_note_sources'"
        ).fetchone()[0] == 1
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='reading_progress'"
        ).fetchone()[0] == 1
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='personal_note_versions'"
        ).fetchone()[0] == 1
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='personal_note_tags'"
        ).fetchone()[0] == 1

    connection = connect(library)
    connection.close()
    with session(library) as db:
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=2").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=3").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=4").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM schema_migrations WHERE version=5").fetchone()[0] == 1


def test_legacy_migrations_preserve_existing_library_rows(monkeypatch, tmp_path):
    library = tmp_path / "library"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    item = import_markdown("legacy.md", "# 旧资料\n\n正文".encode())

    connection = sqlite3.connect(library / "app-data" / "library.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("DROP TABLE IF EXISTS personal_note_tags")
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
        assert db.execute("SELECT version FROM schema_version").fetchone()[0] == 5
        assert db.execute("SELECT name FROM schema_migrations WHERE version=2").fetchone()[0] == "personal_notes"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=3").fetchone()[0] == "reading_progress"
        assert db.execute("SELECT name FROM schema_migrations WHERE version=4").fetchone()[0] == "personal_note_versions"



def test_personal_note_history_migration_backfills_existing_notes(monkeypatch, tmp_path):
    library = tmp_path / "library"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    article = import_markdown("source.md", "# 来源资料\n\n正文".encode())
    note = personal_notes.create_personal_note({
        "title": "迁移前的笔记",
        "body_md": "已经存在的内容。",
        "source_ids": ["article:" + article["id"]],
    })

    connection = sqlite3.connect(library / "app-data" / "library.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("DROP TABLE personal_note_versions")
    connection.execute("DELETE FROM schema_migrations WHERE version=4")
    connection.execute("UPDATE schema_version SET version=3")
    _initialize_schema(connection, library)
    connection.commit()
    connection.close()

    version = personal_notes.get_personal_note_version(note["id"], 1)
    assert version["title"] == "迁移前的笔记"
    assert version["body_md"] == "已经存在的内容。"
    assert version["sources"][0]["source_id"] == "article:" + article["id"]



def test_upgrade_auto_backup_preserves_previous_schema_and_content(monkeypatch, tmp_path):
    library = tmp_path / "library"
    monkeypatch.setenv("ZHILIB_LIBRARY_DIR", str(library))
    article = import_markdown("before.md", "# 升级前资料\n\n不能丢失".encode())

    # Simulate an old database with user content and an upgrade pending.
    connection = sqlite3.connect(library / "app-data" / "library.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute("DELETE FROM schema_migrations WHERE version=5")
    connection.execute("UPDATE schema_version SET version=4")
    # Intentionally do not commit: the initializer must not deadlock when the
    # caller has uncommitted setup statements.
    _initialize_schema(connection, library)
    connection.commit()
    connection.close()

    files = sorted((library / "app-data" / "backups").glob("library-before-schema-v5-*.sqlite"))
    assert len(files) == 1
    old = sqlite3.connect(files[0])
    try:
        assert old.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert old.execute("SELECT version FROM schema_version").fetchone()[0] == 4
        assert old.execute("SELECT title FROM contents WHERE id=?", (article["id"],)).fetchone()[0] == "升级前资料"
    finally:
        old.close()

    # A second initializer pass on the upgraded DB must not create another backup.
    with sqlite3.connect(library / "app-data" / "library.sqlite") as current:
        current.row_factory = sqlite3.Row
        _initialize_schema(current, library)
    assert len(list((library / "app-data" / "backups").glob("library-before-schema-v5-*.sqlite"))) == 1
