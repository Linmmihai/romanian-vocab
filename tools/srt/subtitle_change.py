#!/usr/bin/env python3
"""Batch replace text in subtitle files, with automatic backups."""

import argparse
import shutil
from pathlib import Path


def replace_in_file(path: Path, old: str, new: str, dry_run: bool) -> int:
    content = path.read_text(encoding="utf-8-sig", errors="replace")
    count = content.count(old)
    if count and not dry_run:
        path.write_text(content.replace(old, new), encoding="utf-8-sig")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch replace text in .srt files")
    parser.add_argument("old", help="Text to replace")
    parser.add_argument("new", help="Replacement text")
    parser.add_argument("path", nargs="?", default=".", help="SRT file or folder")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Preview changes without writing files")
    mode.add_argument("--apply", action="store_true", help="Write replacements to files (same as omitting --dry-run)")
    parser.add_argument("--no-backup", action="store_true", help="Skip backup folder creation")
    args = parser.parse_args()

    target = Path(args.path).expanduser().resolve()
    files = [target] if target.is_file() else sorted(target.glob("*.srt"))
    if not files:
        print(f"No .srt files found: {target}")
        return 0

    if target.is_dir() and not args.no_backup and not args.dry_run:
        backup = target.with_name(target.name + "_backup")
        if not backup.exists():
            shutil.copytree(target, backup)
            print(f"Backup created: {backup}")
        else:
            print(f"Backup already exists: {backup}")

    changed_files = 0
    total_replacements = 0
    for file in files:
        count = replace_in_file(file, args.old, args.new, args.dry_run)
        if count:
            changed_files += 1
            total_replacements += count
            action = "Would update" if args.dry_run else "Updated"
            print(f"{action}: {file.name} ({count} replacement(s))")

    print(f"Files changed: {changed_files}; replacements: {total_replacements}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
