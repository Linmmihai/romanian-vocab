#!/usr/bin/env python3
"""Count video files and total duration in a folder."""

import argparse
import json
import subprocess
from pathlib import Path


VIDEO_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".m4v",
    ".mpeg",
    ".mpg",
    ".3gp",
    ".ts",
    ".mts",
    ".m2ts",
    ".vob",
    ".ogv",
}


def format_duration(seconds: float) -> str:
    seconds = int(round(seconds))
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def get_duration(path: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        data = json.loads(result.stdout)
        return float(data["format"]["duration"])
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Count videos and total duration")
    parser.add_argument("folder", nargs="?", default=".", help="Folder to scan")
    parser.add_argument("--no-recursive", action="store_true", help="Only scan the top folder")
    args = parser.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        print(f"Folder does not exist: {folder}")
        return 1

    pattern = "*" if args.no_recursive else "**/*"
    files = sorted(
        path
        for path in folder.glob(pattern)
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
    )
    if not files:
        print(f"No video files found: {folder}")
        return 0

    total_seconds = 0.0
    failed: list[Path] = []
    for number, file in enumerate(files, 1):
        duration = get_duration(file)
        rel = file.relative_to(folder)
        if duration is None:
            failed.append(rel)
            print(f"[{number:>4}] {rel} -> read failed")
        else:
            total_seconds += duration
            print(f"[{number:>4}] {rel} -> {format_duration(duration)}")

    print("\nSummary")
    print(f"Video files: {len(files)}")
    print(f"Read failed: {len(failed)}")
    print(f"Total duration: {format_duration(total_seconds)} ({total_seconds:.1f} seconds)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
