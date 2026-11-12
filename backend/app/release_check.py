"""Read-only library integrity checks for V3 upgrades and data restoration.

This module does not initialize the app database, run migrations or modify files.
Use a verified backup and a restored copy to compare stable IDs and article bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

IDENTITY_TABLES = (
    "contents", "annotations", "notes", "personal_notes", "research_notes",
    "knowledge_topics", "research_projects", "questions", "categories",
)
DATABASE = Path("app-data/library.sqlite")


def _fingerprint(items: list[str]) -> str:
    payload = "\n".join(sorted(items)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _hash_file(path: Path) -> str:
    hash_value = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            hash_value.update(chunk)
    return hash_value.hexdigest()


def snapshot(library_dir: str | Path) -> dict:
    root = Path(library_dir).expanduser().resolve()
    database = root / DATABASE
    if not database.is_file():
        raise FileNotFoundError("资料库缺少 app-data/library.sqlite")
    connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError("数据库完整性检查未通过")
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise ValueError(f"数据库存在 {len(violations)} 个失效外键")
        tables = {row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        identities: dict[str, dict] = {}
        for table in IDENTITY_TABLES:
            if table not in tables:
                continue
            values = [str(row[0]) for row in connection.execute(f"SELECT id FROM {table}")]
            identities[table] = {"count": len(values), "sha256": _fingerprint(values)}
        schema_version = (
            connection.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
            if "schema_version" in tables else None
        )
        article_paths: list[str] = []
        if "contents" in tables:
            article_paths = [
                str(row[0]) for row in connection.execute("SELECT markdown_path FROM contents")
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
        "article_file_count": len(files),
        "article_file_fingerprint": _fingerprint(files),
        "missing_article_files": missing_article_files,
    }


def compare(original: str | Path, candidate: str | Path) -> dict:
    before = snapshot(original)
    after = snapshot(candidate)
    issues = []
    for name in sorted(set(before["identities"]) | set(after["identities"])):
        previous = before["identities"].get(name)
        current = after["identities"].get(name)
        if previous and not current:
            issues.append(f"{name}: 目标资料库缺少原表")
        elif previous and current and previous != current:
            issues.append(f"{name}: 稳定 ID 或数量发生变化")
        # An upgrade may add new tables, but must not lose rows in old tables.
    if before["article_file_fingerprint"] != after["article_file_fingerprint"]:
        issues.append("文章文件清单或内容哈希发生变化")
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
