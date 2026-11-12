from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

MANIFEST_NAME = "backup-manifest.json"
DATABASE_RELATIVE = PurePosixPath("app-data/library.sqlite")
SKIP_DATABASE_SIDECARS = {
    PurePosixPath("app-data/library.sqlite-wal"),
    PurePosixPath("app-data/library.sqlite-shm"),
}


def _secure_mode(path: Path, mode: int) -> None:
    if os.name != "nt":
        try:
            path.chmod(mode)
        except OSError:
            pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _database_report(path: Path) -> dict[str, Any]:
    connection = sqlite3.connect(path)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"SQLite integrity check failed: {integrity}")
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        return {"integrity": integrity, "foreign_key_violation_count": len(violations)}
    finally:
        connection.close()


def _copy_library_files(source: Path, target: Path) -> None:
    for root, directories, filenames in os.walk(source, topdown=True, followlinks=False):
        root_path = Path(root)
        relative_root = root_path.relative_to(source)
        safe_directories: list[str] = []
        for name in directories:
            candidate = root_path / name
            if candidate.is_symlink():
                raise ValueError(f"Symbolic links are not supported in a library backup: {candidate}")
            safe_directories.append(name)
            (target / relative_root / name).mkdir(parents=True, exist_ok=True)
        directories[:] = safe_directories

        for name in filenames:
            candidate = root_path / name
            relative = PurePosixPath((relative_root / name).as_posix())
            if relative == DATABASE_RELATIVE or relative in SKIP_DATABASE_SIDECARS:
                continue
            if candidate.is_symlink() or not candidate.is_file():
                raise ValueError(f"Unsupported filesystem entry in library backup: {candidate}")
            destination = target / Path(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            before_hash = _sha256(candidate)
            before_size = candidate.stat().st_size
            shutil.copy2(candidate, destination)
            if (
                _sha256(candidate) != before_hash
                or candidate.stat().st_size != before_size
                or _sha256(destination) != before_hash
                or destination.stat().st_size != before_size
            ):
                raise RuntimeError(f"Library file changed or copied inconsistently: {candidate}")


def _backup_database(source: Path, target: Path) -> dict[str, Any]:
    source_connection = sqlite3.connect(source, timeout=15)
    target_connection = sqlite3.connect(target)
    try:
        source_connection.backup(target_connection)
        target_connection.commit()
    finally:
        target_connection.close()
        source_connection.close()
    _secure_mode(target, 0o600)
    return _database_report(target)


def _safe_manifest_path(value: str) -> Path:
    relative = PurePosixPath(value)
    if "\\" in value or relative.is_absolute() or not relative.parts or ":" in relative.parts[0] or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError(f"Unsafe path in backup manifest: {value}")
    return Path(*relative.parts)


def verify_backup(backup_dir: Path | str) -> dict[str, Any]:
    root = Path(backup_dir).expanduser().resolve()
    manifest_path = root / MANIFEST_NAME
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise FileNotFoundError(f"Backup manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if manifest.get("format_version") != 1 or not isinstance(files, dict):
        raise ValueError("Unsupported or invalid backup manifest")
    database_name = DATABASE_RELATIVE.as_posix()
    if database_name not in files:
        raise ValueError("Backup manifest is missing the database checksum")
    if manifest.get("file_count") != len(files):
        raise ValueError("Backup manifest file count does not match its file list")

    total_bytes = 0
    for relative_name, expected in files.items():
        if not isinstance(relative_name, str) or not isinstance(expected, dict):
            raise ValueError("Invalid file entry in backup manifest")
        relative = _safe_manifest_path(relative_name)
        original_path = root / relative
        if original_path.is_symlink():
            raise ValueError(f"Backup file is missing or unsafe: {relative_name}")
        path = original_path.resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"Backup file is missing or unsafe: {relative_name}")
        expected_size = expected.get("size")
        expected_hash = expected.get("sha256")
        if not isinstance(expected_size, int) or expected_size < 0:
            raise ValueError(f"Invalid file size in backup manifest: {relative_name}")
        if not isinstance(expected_hash, str) or len(expected_hash) != 64 or any(
            character not in "0123456789abcdef" for character in expected_hash
        ):
            raise ValueError(f"Invalid SHA-256 in backup manifest: {relative_name}")
        if path.stat().st_size != expected_size or _sha256(path) != expected_hash:
            raise ValueError(f"Backup checksum mismatch: {relative_name}")
        total_bytes += path.stat().st_size

    actual_files: set[str] = set()
    for current_root, directories, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current_root)
        for directory in directories:
            if (current_path / directory).is_symlink():
                raise ValueError(f"Backup contains a symbolic link: {current_path / directory}")
        for filename in filenames:
            candidate = current_path / filename
            if candidate == manifest_path:
                continue
            if candidate.is_symlink() or not candidate.is_file():
                raise ValueError(f"Backup contains an unsupported filesystem entry: {candidate}")
            actual_files.add(candidate.relative_to(root).as_posix())
    if actual_files != set(files):
        missing = sorted(set(files) - actual_files)
        extra = sorted(actual_files - set(files))
        raise ValueError(f"Backup file set mismatch; missing={missing}, extra={extra}")
    if manifest.get("total_bytes") != total_bytes:
        raise ValueError("Backup manifest total size does not match its file list")

    database_path = root / Path(*DATABASE_RELATIVE.parts)
    database_report = _database_report(database_path)
    return {
        "valid": True,
        "file_count": len(manifest["files"]),
        "total_bytes": total_bytes,
        "database": database_report,
        "created_at": manifest.get("created_at"),
    }


def backup_library(source_dir: Path | str, destination_dir: Path | str) -> dict[str, Any]:
    source = Path(source_dir).expanduser().resolve()
    destination = Path(destination_dir).expanduser().resolve()
    database = source / Path(*DATABASE_RELATIVE.parts)
    if not source.is_dir() or not database.is_file():
        raise FileNotFoundError("Source is not a valid Zhihu library directory")
    if destination.exists():
        raise FileExistsError(f"Backup destination already exists: {destination}")
    if destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError("Backup destination and source library must not contain one another")

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.name}.tmp-{uuid.uuid4().hex}"
    temporary.mkdir(mode=0o700)
    try:
        _copy_library_files(source, temporary)
        database_target = temporary / Path(*DATABASE_RELATIVE.parts)
        database_target.parent.mkdir(parents=True, exist_ok=True)
        database_report = _backup_database(database, database_target)

        files: dict[str, dict[str, Any]] = {}
        total_bytes = 0
        for path in sorted(item for item in temporary.rglob("*") if item.is_file()):
            relative = path.relative_to(temporary).as_posix()
            files[relative] = {"size": path.stat().st_size, "sha256": _sha256(path)}
            total_bytes += path.stat().st_size

        manifest = {
            "format_version": 1,
            "created_at": datetime.now(UTC).isoformat(),
            "database": database_report,
            "file_count": len(files),
            "total_bytes": total_bytes,
            "files": files,
        }
        manifest_path = temporary / MANIFEST_NAME
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        _secure_mode(manifest_path, 0o600)
        _secure_mode(temporary, 0o700)
        os.replace(temporary, destination)
        return {
            "backup_dir": str(destination),
            "file_count": len(files),
            "total_bytes": total_bytes,
            "database": database_report,
            "created_at": manifest["created_at"],
        }
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def restore_library(backup_dir: Path | str, destination_dir: Path | str) -> dict[str, Any]:
    backup = Path(backup_dir).expanduser().resolve()
    destination = Path(destination_dir).expanduser().resolve()
    if destination.exists():
        raise FileExistsError(f"Restore destination already exists: {destination}")
    if destination.is_relative_to(backup) or backup.is_relative_to(destination):
        raise ValueError("Restore destination and backup directory must not contain one another")
    report = verify_backup(backup)

    manifest = json.loads((backup / MANIFEST_NAME).read_text(encoding="utf-8"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.name}.restore-{uuid.uuid4().hex}"
    temporary.mkdir(mode=0o700)
    try:
        for relative_name in manifest["files"]:
            relative = _safe_manifest_path(relative_name)
            original_source = backup / relative
            if original_source.is_symlink():
                raise ValueError(f"Unsafe source path in backup: {relative_name}")
            source = original_source.resolve()
            if not source.is_relative_to(backup):
                raise ValueError(f"Unsafe source path in backup: {relative_name}")
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        restored_db = temporary / Path(*DATABASE_RELATIVE.parts)
        database_report = _database_report(restored_db)
        os.replace(temporary, destination)
        return {
            "restored_dir": str(destination),
            "file_count": report["file_count"],
            "total_bytes": report["total_bytes"],
            "database": database_report,
        }
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
