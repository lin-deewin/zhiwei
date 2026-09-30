from __future__ import annotations

import sqlite3
import json
from datetime import datetime, UTC
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.core.config import get_library_dir

SCHEMA = """
PRAGMA foreign_keys = ON;
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

"""


def connect() -> sqlite3.Connection:
    library = get_library_dir()
    (library / "app-data").mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(library / "app-data" / "library.sqlite", timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(SCHEMA)
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
    return connection


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    connection = connect()
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
