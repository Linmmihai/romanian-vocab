#!/usr/bin/env python3
"""Compare original and modified SRT folders using sequence alignment."""

import argparse
import difflib
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


def describe_entry(label: str, entry: tuple[str, str, str] | None) -> list[str]:
    if entry is None:
        return [f"{label}: <missing>"]
    number, timecode, text = entry
    return [f"{label}: #{number}  {timecode}", text]


def find_modified_file(modified_folder: Path, original_path: Path) -> Path | None:
    candidates = [
        modified_folder / original_path.name,
        modified_folder / f"{original_path.stem}_fixed{original_path.suffix}",
    ]
    return next((path for path in candidates if path.exists()), None)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare SRT folders even when subtitle counts changed")
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
        matcher = difflib.SequenceMatcher(None, [item[2] for item in original], [item[2] for item in modified])

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            span = max(i2 - i1, j2 - j1)
            for offset in range(span):
                old = original[i1 + offset] if i1 + offset < i2 else None
                new = modified[j1 + offset] if j1 + offset < j2 else None
                report.append(f"File: {original_path.name}")
                report.append(f"Change type: {tag}")
                report.extend(describe_entry("Original", old))
                report.extend(describe_entry("Modified", new))
                report.append("-" * 60)

    output.write_text("\n".join(report) + ("\n" if report else ""), encoding="utf-8")
    print(f"Comparison complete: {output}")
    print(f"Changed entries: {sum(1 for line in report if line.startswith('File: '))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
