from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.core.backup import backup_library, restore_library, verify_backup
from app.core.config import get_library_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="Back up, verify or restore a local Zhihu library.")
    commands = parser.add_subparsers(dest="command", required=True)

    backup = commands.add_parser("backup", help="Create a consistent library backup.")
    backup.add_argument("--source", type=Path, default=get_library_dir())
    backup.add_argument("--destination", type=Path, required=True)

    verify = commands.add_parser("verify", help="Verify backup file checksums and SQLite integrity.")
    verify.add_argument("--backup", type=Path, required=True)

    restore = commands.add_parser("restore", help="Restore a verified backup to a new directory.")
    restore.add_argument("--backup", type=Path, required=True)
    restore.add_argument("--destination", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "backup":
        result = backup_library(args.source, args.destination)
    elif args.command == "verify":
        result = verify_backup(args.backup)
    else:
        result = restore_library(args.backup, args.destination)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
