#!/usr/bin/env python3
"""Compare original and modified SRT folders by subtitle number."""

import argparse
import re
from pathlib import Path


def parse_srt(path: Path) -> list[tuple[str, str, str]]:
    content = path.read_text(encoding="utf-8-sig", errors="replace")
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    result = []
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = block.split("\n")
        if len(lines) >= 3:
            result.append((lines[0].strip(), lines[1].strip(), " ".join(line.strip() for line in lines[2:])))
    return result


def find_modified_file(modified_folder: Path, original_path: Path) -> Path | None:
    candidates = [
        modified_folder / original_path.name,
        modified_folder / f"{original_path.stem}_fixed{original_path.suffix}",
    ]
    return next((path for path in candidates if path.exists()), None)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare same-number SRT subtitles")
    parser.add_argument("original_folder")
    parser.add_argument("modified_folder")
    parser.add_argument("-o", "--output", default="changes_report.txt")
    args = parser.parse_args()

    original_folder = Path(args.original_folder).expanduser().resolve()
    modified_folder = Path(args.modified_folder).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()

    report: list[str] = []
    for original_path in sorted(original_folder.glob("*.srt")):
        modified_path = find_modified_file(modified_folder, original_path)
        if modified_path is None:
            report.extend([f"File missing in modified folder: {original_path.name}", "-" * 60])
            continue

        original = parse_srt(original_path)
        modified = parse_srt(modified_path)
        if len(original) != len(modified):
            report.extend(
                [
                    f"File: {original_path.name}",
                    f"Subtitle count differs: original={len(original)}, modified={len(modified)}",
                    "-" * 60,
                ]
            )

        for old, new in zip(original, modified):
            old_no, old_time, old_text = old
            new_no, new_time, new_text = new
            if old_text != new_text or old_time != new_time:
                report.extend(
                    [
                        f"File: {original_path.name}",
                        f"Original: #{old_no}  {old_time}",
                        old_text,
                        f"Modified: #{new_no}  {new_time}",
                        new_text,
                        "-" * 60,
                    ]
                )

    output.write_text("\n".join(report) + ("\n" if report else ""), encoding="utf-8")
    print(f"Comparison complete: {output}")
    print(f"Changed entries: {sum(1 for line in report if line.startswith('File: '))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
