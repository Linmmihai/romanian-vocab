#!/usr/bin/env python3
"""Search subtitle files and print filename, subtitle number, timecode, and text."""

import argparse
import re
from pathlib import Path


def iter_srt_blocks(path: Path):
    content = path.read_text(encoding="utf-8-sig", errors="replace")
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = block.split("\n")
        if len(lines) >= 3:
            yield lines[0].strip(), lines[1].strip(), " ".join(line.strip() for line in lines[2:])


def main() -> int:
    parser = argparse.ArgumentParser(description="Search text or regex in .srt files")
    parser.add_argument("pattern", help="Text or regex to search for")
    parser.add_argument("path", nargs="?", default=".", help="SRT file or folder")
    parser.add_argument("-i", "--ignore-case", action="store_true", help="Case-insensitive search")
    parser.add_argument("--literal", action="store_true", help="Treat pattern as plain text")
    args = parser.parse_args()

    flags = re.IGNORECASE if args.ignore_case else 0
    pattern = re.escape(args.pattern) if args.literal else args.pattern
    regex = re.compile(pattern, flags)

    target = Path(args.path).expanduser().resolve()
    if target.is_file():
        files = [target]
    else:
        files = sorted(target.glob("*.srt"))

    matches = 0
    for file in files:
        for sub_no, timecode, text in iter_srt_blocks(file):
            if regex.search(text):
                matches += 1
                print(f"{file.name}  #{sub_no}  {timecode}")
                print(text)
                print("-" * 60)

    print(f"Matches: {matches}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
