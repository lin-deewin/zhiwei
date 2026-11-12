"""Read-only library integrity checks for V3 upgrades and data restoration.

This module does not initialize the app database, run migrations or modify files.
It compares all existing SQLite user tables by primary key and column value,
plus article file hashes. New migration tables/columns are allowed; dropping or
changing pre-existing user data is not.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
from pathlib import Path

IDENTITY_TABLES = (
    "contents", "annotations", "notes", "personal_notes", "research_notes",
    "knowledge_topics", "research_projects", "questions", "categories",
)
METADATA_TABLES = {"schema_version", "schema_migrations", "reading_migrations"}
DATABASE = Path("app-data/library.sqlite")


def _canonical(value) -> str:
    def normalize(item):
        if isinstance(item, bytes):
            return {"$blob_hex": item.hex()}
        if isinstance(item, float) and not math.isfinite(item):
            return {"$float": str(item)}
        if isinstance(item, tuple):
            return [normalize(part) for part in item]
        if isinstance(item, list):
            return [normalize(part) for part in item]
        if isinstance(item, dict):
            return {str(key): normalize(part) for key, part in item.items()}
        return item

    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _fingerprint(items: list[str]) -> str:
    payload = "\n".join(sorted(items)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _hash_file(path: Path) -> str:
    hash_value = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            hash_value.update(chunk)
    return hash_value.hexdigest()


def _table_snapshot(connection: sqlite3.Connection, table: str) -> dict:
    quoted = '"' + table.replace('"', '""') + '"'
    info = connection.execute(f"PRAGMA table_info({quoted})").fetchall()
    columns = [row["name"] for row in info]
    primary_key = [
        row["name"] for row in sorted(info, key=lambda item: item["pk"]) if row["pk"]
    ]
    rows = connection.execute(f"SELECT * FROM {quoted}").fetchall()
    if primary_key:
        rows.sort(key=lambda row: _canonical([row[column] for column in primary_key]))
        column_fingerprints = {}
        for column in columns:
            keyed_values = [
                ([row[key] for key in primary_key], row[column])
                for row in rows
            ]
            column_fingerprints[column] = hashlib.sha256(
                _canonical(keyed_values).encode("utf-8")
            ).hexdigest()
        row_fingerprint = None
    else:
        serialized = sorted(_canonical([row[column] for column in columns]) for row in rows)
        column_fingerprints = {}
        row_fingerprint = _fingerprint(serialized)
    return {
        "columns": columns,
        "primary_key": primary_key,
        "row_count": len(rows),
        "column_fingerprints": column_fingerprints,
        "row_fingerprint": row_fingerprint,
    }


def snapshot(library_dir: str | Path) -> dict:
    root = Path(library_dir).expanduser().resolve()
    database = root / DATABASE
    if not database.is_file():
        raise FileNotFoundError("资料库缺少 app-data/library.sqlite")
    connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError("数据库完整性检查未通过")
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise ValueError(f"数据库存在 {len(violations)} 个失效外键")
        table_names = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        user_tables = sorted(table_names - METADATA_TABLES)
        table_data = {
            table: _table_snapshot(connection, table) for table in user_tables
        }
        identities: dict[str, dict] = {}
        for table in IDENTITY_TABLES:
            detail = table_data.get(table)
            if detail and "id" in detail["columns"]:
                identities[table] = {
                    "count": detail["row_count"],
                    "sha256": detail["column_fingerprints"]["id"],
                }
        schema_version = (
            connection.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
            if "schema_version" in table_names else None
        )
        article_paths: list[str] = []
        if "contents" in table_names:
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(contents)")}
            if "markdown_path" in columns:
                article_paths = [
                    str(row[0]) for row in connection.execute("SELECT markdown_path FROM contents")
                    if row[0]
                ]
    finally:
        connection.close()

    files: list[str] = []
    missing_article_files = 0
    for relative in article_paths:
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise ValueError("数据库包含不安全的文章文件路径")
        candidate = root / path
        if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
            raise ValueError("数据库文章路径含符号链接或越界")
        if not candidate.is_file():
            missing_article_files += 1

    article_root = root / "articles"
    if article_root.exists():
        for path in article_root.rglob("*"):
            if path.is_symlink():
                raise ValueError("文章目录包含符号链接，无法保证文件完整性")
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                files.append(f"{relative}:{path.stat().st_size}:{_hash_file(path)}")

    return {
        "schema_version": schema_version,
        "database_integrity": integrity,
        "foreign_key_violations": 0,
        "identities": identities,
        "tables": table_data,
        "table_count": len(table_data),
        "article_file_count": len(files),
        "article_file_fingerprint": _fingerprint(files),
        "missing_article_files": missing_article_files,
    }


def compare(original: str | Path, candidate: str | Path) -> dict:
    before = snapshot(original)
    after = snapshot(candidate)
    issues: list[str] = []
    previous_tables = before["tables"]
    current_tables = after["tables"]

    for name in sorted(previous_tables):
        previous = previous_tables[name]
        current = current_tables.get(name)
        if current is None:
            issues.append(f"{name}: 目标资料库缺少原表")
            continue
        if previous["primary_key"] != current["primary_key"]:
            issues.append(f"{name}: 主键定义发生变化")
            continue
        if previous["row_count"] != current["row_count"]:
            issues.append(
                f"{name}: 记录数量变化（{previous['row_count']} -> {current['row_count']}）"
            )
        dropped_columns = sorted(set(previous["columns"]) - set(current["columns"]))
        if dropped_columns:
            issues.append(f"{name}: 丢失原字段 {', '.join(dropped_columns)}")
            continue
        if previous["primary_key"]:
            for column in previous["columns"]:
                if previous["column_fingerprints"][column] != current["column_fingerprints"][column]:
                    issues.append(f"{name}.{column}: 记录值发生变化")
        elif previous["columns"] != current["columns"] or previous["row_fingerprint"] != current["row_fingerprint"]:
            issues.append(f"{name}: 无主键表的记录内容或结构发生变化")

    if before["article_file_fingerprint"] != after["article_file_fingerprint"]:
        issues.append("文章文件清单或内容哈希发生变化")
    if before["missing_article_files"]:
        issues.append(f"基线资料库缺少 {before['missing_article_files']} 个正文文件")
    if after["missing_article_files"]:
        issues.append(f"目标资料库缺少 {after['missing_article_files']} 个正文文件")
    return {
        "passed": not issues,
        "issues": issues,
        "before": before,
        "after": after,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only V3 library integrity checker")
    commands = parser.add_subparsers(dest="command", required=True)
    single = commands.add_parser("snapshot")
    single.add_argument("--library", required=True, type=Path)
    check = commands.add_parser("compare")
    check.add_argument("--baseline", required=True, type=Path)
    check.add_argument("--candidate", required=True, type=Path)
    args = parser.parse_args()
    report = snapshot(args.library) if args.command == "snapshot" else compare(
        args.baseline, args.candidate
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.command == "compare" and not report["passed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
