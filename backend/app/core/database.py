from __future__ import annotations

import sqlite3
import json
from threading import Lock
from datetime import datetime, UTC
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.core.config import get_library_dir

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS semantic_vectors (
 model TEXT NOT NULL, chunk_id TEXT NOT NULL, source_id TEXT NOT NULL,
 vector_json TEXT NOT NULL, PRIMARY KEY(model,chunk_id)
);
CREATE TABLE IF NOT EXISTS semantic_jobs (
 id TEXT PRIMARY KEY, model TEXT NOT NULL, status TEXT NOT NULL,
 processed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retrieval_cases (
 id TEXT PRIMARY KEY, question TEXT NOT NULL, expected_sources_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_topics (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1, sources_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topic_drafts (
 id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES knowledge_topics(id) ON DELETE CASCADE,
 body_md TEXT NOT NULL, sources_json TEXT NOT NULL, base_revision INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_links (
 from_id TEXT NOT NULL, to_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, PRIMARY KEY(from_id,to_id)
);
CREATE TABLE IF NOT EXISTS research_versions (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES research_notes(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body_md TEXT NOT NULL, sources_json TEXT NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_projects (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, question TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_turns (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
 question TEXT NOT NULL, answer TEXT NOT NULL, sources_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_notes (
 project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
 note_id TEXT NOT NULL REFERENCES research_notes(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,note_id)
);
CREATE TABLE IF NOT EXISTS markdown_sync_files (
 relative_path TEXT PRIMARY KEY, source_id TEXT NOT NULL UNIQUE,
 file_hash TEXT NOT NULL, record_hash TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  body_md TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','saved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_notes_status ON research_notes(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
CREATE TABLE IF NOT EXISTS contents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'article',
  remote_id TEXT,
  title TEXT NOT NULL,
  author TEXT,
  url TEXT,
  markdown_path TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  classification_source TEXT NOT NULL DEFAULT 'manual',
  classification_locked INTEGER NOT NULL DEFAULT 0,
  classification_reason TEXT NOT NULL DEFAULT '',
  classified_content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL,
  UNIQUE(kind, remote_id)
);
CREATE TABLE IF NOT EXISTS deleted_contents (
  content_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(parent_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_sibling_unique
  ON categories(COALESCE(parent_id, -1), name);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  name TEXT NOT NULL,
  url TEXT,
  last_scanned_at TEXT,
  scan_status TEXT NOT NULL DEFAULT 'unknown'
);
CREATE TABLE IF NOT EXISTS folder_contents (
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY(folder_id, content_id)
);
CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  folder_ids TEXT NOT NULL,
  total INTEGER,
  scanned INTEGER NOT NULL DEFAULT 0,
  downloaded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contents_updated ON contents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contents_category ON contents(category_id);
CREATE INDEX IF NOT EXISTS idx_folder_contents_content ON folder_contents(content_id);
CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(
  content_id UNINDEXED, title, body, tokenize='trigram'
);
CREATE TABLE IF NOT EXISTS classification_jobs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  classified INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NOT NULL DEFAULT '',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classification_job_items (
  job_id TEXT NOT NULL REFERENCES classification_jobs(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(job_id, content_id)
);
CREATE INDEX IF NOT EXISTS idx_classification_jobs_created ON classification_jobs(created_at DESC);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  classification_source TEXT NOT NULL DEFAULT 'none',
  classification_locked INTEGER NOT NULL DEFAULT 0,
  classification_reason TEXT NOT NULL DEFAULT '',
  classified_input_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS question_contents (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  link_source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(question_id, content_id)
);
CREATE INDEX IF NOT EXISTS idx_question_contents_content ON question_contents(content_id);
CREATE TABLE IF NOT EXISTS question_classification_jobs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0, classified INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0, error_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS question_classification_job_items (
  job_id TEXT NOT NULL REFERENCES question_classification_jobs(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(job_id, question_id)
);
CREATE TABLE IF NOT EXISTS reading_library_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), library_id TEXT NOT NULL UNIQUE
);
INSERT OR IGNORE INTO reading_library_meta(singleton,library_id)
  VALUES (1, lower(hex(randomblob(16))));
CREATE TABLE IF NOT EXISTS content_revisions (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  body_hash TEXT NOT NULL,
  normalization_version INTEGER NOT NULL,
  markdown_snapshot TEXT NOT NULL,
  blocks_json TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(content_id,body_hash,normalization_version),
  UNIQUE(content_id,id)
);
CREATE TABLE IF NOT EXISTS reading_content_state (
  content_id TEXT PRIMARY KEY REFERENCES contents(id) ON DELETE CASCADE,
  current_revision_id TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  observed_at TEXT NOT NULL,
  FOREIGN KEY(content_id,current_revision_id) REFERENCES content_revisions(content_id,id)
);
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  original_revision_id TEXT NOT NULL,
  original_anchor_json TEXT NOT NULL,
  current_revision_id TEXT,
  current_anchor_json TEXT,
  anchor_status TEXT NOT NULL DEFAULT 'resolved' CHECK(anchor_status IN ('resolved','ambiguous','orphaned','pending')),
  color TEXT NOT NULL DEFAULT 'yellow' CHECK(color IN ('yellow','green','blue')),
  comment_md TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(content_id,original_revision_id) REFERENCES content_revisions(content_id,id),
  FOREIGN KEY(content_id,current_revision_id) REFERENCES content_revisions(content_id,id)
);
CREATE INDEX IF NOT EXISTS idx_annotations_content ON annotations(content_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  origin_ai_result_id TEXT REFERENCES reading_ai_results(id) ON DELETE SET NULL,
  origin_metadata_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_content ON notes(content_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS reading_ai_jobs (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('summary','explain','key_points')),
  selection_anchor_json TEXT,
  input_manifest_json TEXT NOT NULL,
  config_json TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  reuse_key TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','interrupted')),
  stage TEXT NOT NULL DEFAULT 'prepare',
  completed_steps INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(content_id,revision_id) REFERENCES content_revisions(content_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_active_reuse ON reading_ai_jobs(reuse_key)
  WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS reading_ai_job_steps (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES reading_ai_jobs(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL, input_hash TEXT NOT NULL, status TEXT NOT NULL,
  output_text TEXT, updated_at TEXT NOT NULL, UNIQUE(job_id,step_no)
);
CREATE TABLE IF NOT EXISTS reading_ai_results (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES reading_ai_jobs(id),
  content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL, action TEXT NOT NULL, reuse_key TEXT NOT NULL,
  result_json TEXT NOT NULL, rendered_md TEXT NOT NULL, citations_json TEXT NOT NULL,
  generation_meta_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(content_id,revision_id) REFERENCES content_revisions(content_id,id)
);
CREATE INDEX IF NOT EXISTS idx_reading_results_content ON reading_ai_results(content_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reading_requests (
  request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
  target_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_import_items (
  export_id TEXT NOT NULL, record_type TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
  PRIMARY KEY(export_id,record_type,source_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(
  record_id UNINDEXED, record_type UNINDEXED, content_id UNINDEXED,
  user_title, user_body, quote_text, article_title, tokenize='trigram'
);

"""


_schema_lock = Lock()
_initialized_databases: set[tuple[Path, int, int]] = set()


def connect(library: Path | None = None) -> sqlite3.Connection:
    library = library or get_library_dir()
    database_path = library / "app-data" / "library.sqlite"
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        # Schema writes belong to initialization, not every read request. The
        # inode also detects a database replaced at the same library path.
        with _schema_lock:
            stat = database_path.stat()
            key = (database_path.resolve(), stat.st_dev, stat.st_ino)
            if key not in _initialized_databases:
                _initialize_schema(connection, library)
                connection.commit()
                _initialized_databases.add(key)
        return connection
    except Exception:
        connection.close()
        raise


def _migration_personal_notes(connection: sqlite3.Connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS personal_notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            body_md TEXT NOT NULL DEFAULT '',
            revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS personal_note_sources (
            note_id TEXT NOT NULL REFERENCES personal_notes(id) ON DELETE CASCADE,
            source_id TEXT NOT NULL,
            source_type TEXT NOT NULL CHECK(source_type IN
                ('article','note','annotation','research','topic','personal_note')),
            title_snapshot TEXT NOT NULL,
            url_snapshot TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY(note_id, source_id)
        )
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_personal_notes_updated
        ON personal_notes(updated_at DESC)
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_personal_note_sources_source
        ON personal_note_sources(source_id)
    """)


def _migration_reading_progress(connection: sqlite3.Connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS reading_progress (
            content_id TEXT PRIMARY KEY REFERENCES contents(id) ON DELETE CASCADE,
            progress_ratio REAL NOT NULL DEFAULT 0 CHECK(progress_ratio >= 0 AND progress_ratio <= 1),
            scroll_y REAL NOT NULL DEFAULT 0 CHECK(scroll_y >= 0),
            block_id TEXT,
            read_later INTEGER NOT NULL DEFAULT 0 CHECK(read_later IN (0,1)),
            last_read_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_reading_progress_recent
        ON reading_progress(last_read_at DESC)
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_reading_progress_later
        ON reading_progress(read_later,updated_at DESC)
    """)


def _migration_personal_note_versions(connection: sqlite3.Connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS personal_note_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL REFERENCES personal_notes(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL CHECK(revision > 0),
            title TEXT NOT NULL DEFAULT '',
            body_md TEXT NOT NULL DEFAULT '',
            sources_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            UNIQUE(note_id, revision)
        )
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_personal_note_versions_history
        ON personal_note_versions(note_id, revision DESC)
    """)
    existing = connection.execute(
        "SELECT id,revision,title,body_md,updated_at FROM personal_notes"
    ).fetchall()
    for note in existing:
        sources = connection.execute(
            """SELECT source_id,source_type,title_snapshot,url_snapshot,created_at
               FROM personal_note_sources WHERE note_id=? ORDER BY created_at,source_id""",
            (note[0],),
        ).fetchall()
        snapshot = [
            {
                "source_id": row[0],
                "source_type": row[1],
                "title_snapshot": row[2],
                "url_snapshot": row[3],
                "created_at": row[4],
            }
            for row in sources
        ]
        connection.execute(
            """INSERT OR IGNORE INTO personal_note_versions
               (note_id,revision,title,body_md,sources_json,created_at)
               VALUES(?,?,?,?,?,?)""",
            (note[0], note[1], note[2], note[3], json.dumps(snapshot, ensure_ascii=False), note[4]),
        )


def _migration_personal_note_tags(connection: sqlite3.Connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS personal_note_tags (
            note_id TEXT NOT NULL REFERENCES personal_notes(id) ON DELETE CASCADE,
            tag TEXT NOT NULL CHECK(length(tag) BETWEEN 1 AND 24),
            created_at TEXT NOT NULL,
            PRIMARY KEY(note_id, tag)
        )
    """)
    connection.execute("""
        CREATE INDEX IF NOT EXISTS idx_personal_note_tags_tag
        ON personal_note_tags(tag, note_id)
    """)


_VERSIONED_MIGRATIONS = (
    (2, "personal_notes", _migration_personal_notes),
    (3, "reading_progress", _migration_reading_progress),
    (4, "personal_note_versions", _migration_personal_note_versions),
    (5, "personal_note_tags", _migration_personal_note_tags),
)


def _apply_versioned_migrations(connection: sqlite3.Connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    """)
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(1,'legacy_baseline',?)",
        (datetime.now(UTC).isoformat(),),
    )
    for version, name, apply in _VERSIONED_MIGRATIONS:
        if connection.execute(
            "SELECT 1 FROM schema_migrations WHERE version=?", (version,)
        ).fetchone():
            continue
        savepoint = f"schema_migration_{version}"
        connection.execute(f"SAVEPOINT {savepoint}")
        try:
            apply(connection)
            connection.execute(
                "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
                (version, name, datetime.now(UTC).isoformat()),
            )
            connection.execute("UPDATE schema_version SET version=?", (version,))
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
        except Exception:
            connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
            raise


def _backup_if_upgrade_required(
    connection: sqlite3.Connection, library: Path, tables: set[str]
) -> Path | None:
    # A newly created database has nothing to protect. Existing user data must
    # be backed up before both legacy ALTER statements and versioned migrations.
    if not tables.intersection({"contents", "research_notes", "personal_notes", "annotations"}):
        return None
    target_version = _VERSIONED_MIGRATIONS[-1][0]
    existing = set()
    if "schema_migrations" in tables:
        existing = {
            row[0] for row in connection.execute("SELECT version FROM schema_migrations")
        }
    version_upgrade = any(version not in existing for version, _, _ in _VERSIONED_MIGRATIONS)
    legacy_upgrade = "content_revisions" not in tables
    if not version_upgrade and not legacy_upgrade:
        return None

    backup_dir = library / "app-data" / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        backup_dir.chmod(0o700)
    except OSError:
        pass
    path = backup_dir / (
        f"library-before-schema-v{target_version}-"
        f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')}.sqlite"
    )
    destination = sqlite3.connect(path)
    try:
        connection.backup(destination)
        destination.commit()
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("升级前数据库备份完整性检查失败")
    except Exception:
        destination.close()
        path.unlink(missing_ok=True)
        raise
    finally:
        try:
            destination.close()
        except Exception:
            pass
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return path


def _initialize_schema(connection: sqlite3.Connection, library: Path) -> None:
    connection.execute("PRAGMA journal_mode = WAL")
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    _backup_if_upgrade_required(connection, library, tables)
    connection.executescript(SCHEMA)
    research_columns = {row["name"] for row in connection.execute("PRAGMA table_info(research_notes)")}
    if "revision" not in research_columns:
        connection.execute("ALTER TABLE research_notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
    topic_columns = {row["name"] for row in connection.execute("PRAGMA table_info(knowledge_topics)")}
    if "sources_json" not in topic_columns:
        connection.execute("ALTER TABLE knowledge_topics ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[]'")
    connection.execute("CREATE TABLE IF NOT EXISTS reading_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)")
    connection.execute("INSERT OR IGNORE INTO reading_migrations(version,applied_at) VALUES(1,?)",
                        (datetime.now(UTC).isoformat(),))
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(contents)")}
    if "classification_source" not in columns:
        connection.execute("ALTER TABLE contents ADD COLUMN classification_source TEXT NOT NULL DEFAULT 'manual'")
    if "classification_locked" not in columns:
        connection.execute("ALTER TABLE contents ADD COLUMN classification_locked INTEGER NOT NULL DEFAULT 0")
    if "classification_reason" not in columns:
        connection.execute("ALTER TABLE contents ADD COLUMN classification_reason TEXT NOT NULL DEFAULT ''")
    if "classified_content_hash" not in columns:
        connection.execute("ALTER TABLE contents ADD COLUMN classified_content_hash TEXT")
    if "last_synced_at" not in columns:
        connection.execute("ALTER TABLE contents ADD COLUMN last_synced_at TEXT")
        connection.execute("ALTER TABLE contents ADD COLUMN collected_at TEXT")
        for row in connection.execute("SELECT id,markdown_path FROM contents").fetchall():
            path = (library / row["markdown_path"]).resolve().with_name("metadata.json")
            collected = None
            if path.is_relative_to(library.resolve()):
                try:
                    metadata = json.loads(path.read_text(encoding="utf-8"))
                    value = metadata.get("collected_at")
                    if value:
                        collected = datetime.fromisoformat(str(value)).astimezone(UTC).isoformat()
                except (OSError, ValueError, TypeError, AttributeError):
                    pass
            seen = connection.execute("SELECT MAX(last_seen_at) FROM folder_contents WHERE content_id=?", (row["id"],)).fetchone()[0]
            if seen:
                job = connection.execute("SELECT created_at FROM sync_jobs WHERE created_at<=? AND updated_at>=? ORDER BY created_at DESC LIMIT 1", (seen, seen)).fetchone()
                seen = job[0] if job else seen
            connection.execute("UPDATE contents SET last_synced_at=?,collected_at=? WHERE id=?", (seen, collected, row["id"]))
        connection.commit()

    _apply_versioned_migrations(connection)


@contextmanager
def session(library: Path | None = None) -> Iterator[sqlite3.Connection]:
    connection = connect(library)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def article_dir(content_id: str) -> Path:
    return get_library_dir() / "articles" / content_id
