#!/usr/bin/env python3
"""
SRT quality checker and safe auto-fixer.

Daily workflow:
  python3 srt_qc.py /path/to/srt --no-fix --out report.csv
  python3 srt_qc.py /path/to/srt --fix

Default mode is report-only. Use --fix when you want safe formatting fixes:
  - one text line per subtitle block
  - each visible line <= --max-chars
  - whitespace and punctuation spacing cleanup
  - sequential subtitle numbering

Riskier language guesses, such as missing periods and capitalization across
subtitle boundaries, are reported for review by default. Add --fix-language to
apply those guesses too.
"""

import argparse
import csv
import os
import re
import sys
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


SENTENCE_END = set(".?!…")
CLOSING = set('"\'`)]}”’')
LEAD_CHARS = set(' "\'([{“‘-')
TAG_RE = re.compile(r"<[^>]+>")
TIME_RE = re.compile(
    r"^\s*(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})(.*)$"
)


@dataclass
class Subtitle:
    index: int
    start_ms: int
    end_ms: int
    settings: str
    raw_lines: list[str]

    @property
    def timecode(self) -> str:
        return f"{format_time(self.start_ms)} --> {format_time(self.end_ms)}{self.settings}"

    @property
    def text(self) -> str:
        return " ".join(line.strip() for line in self.raw_lines if line.strip())

    @property
    def visible_text(self) -> str:
        return strip_tags(self.text)

    @property
    def last_visible_char(self) -> str:
        text = self.visible_text.rstrip()
        while text and text[-1] in CLOSING:
            text = text[:-1].rstrip()
        return text[-1] if text else ""


@dataclass
class Issue:
    file: str
    sub_index: int
    timecode: str
    rule: str
    detail: str
    original: str
    fixed: str = ""
    auto_fixed: bool = False


def strip_tags(text: str) -> str:
    return TAG_RE.sub("", text)


def visible_len(text: str) -> int:
    return len(strip_tags(text))


def parse_time(value: str) -> int:
    hours, minutes, rest = value.strip().split(":")
    seconds, millis = rest.split(",")
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1_000
        + int(millis)
    )


def format_time(ms: int) -> str:
    ms = max(0, int(ms))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    seconds, ms = divmod(ms, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"


def normalize_newlines(content: str) -> str:
    return content.replace("\r\n", "\n").replace("\r", "\n")


def parse_srt(path: Path) -> tuple[list[Subtitle], list[str]]:
    errors: list[str] = []
    content = normalize_newlines(path.read_text(encoding="utf-8-sig", errors="replace"))
    blocks = re.split(r"\n\s*\n", content.strip()) if content.strip() else []
    subtitles: list[Subtitle] = []

    for block_no, block in enumerate(blocks, 1):
        lines = block.split("\n")
        if len(lines) < 3:
            errors.append(f"Block {block_no}: incomplete block")
            continue
        try:
            index = int(lines[0].strip())
        except ValueError:
            errors.append(f"Block {block_no}: invalid subtitle number {lines[0]!r}")
            continue

        match = TIME_RE.match(lines[1])
        if not match:
            errors.append(f"Block {block_no}: invalid timecode {lines[1]!r}")
            continue

        try:
            start_ms = parse_time(match.group(1))
            end_ms = parse_time(match.group(2))
        except ValueError:
            errors.append(f"Block {block_no}: invalid time value {lines[1]!r}")
            continue

        raw_lines = [line.rstrip() for line in lines[2:] if line.strip()]
        subtitles.append(
            Subtitle(
                index=index,
                start_ms=start_ms,
                end_ms=end_ms,
                settings=match.group(3) or "",
                raw_lines=raw_lines,
            )
        )

    return subtitles, errors


def write_srt(subtitles: Iterable[Subtitle], path: Path) -> None:
    with path.open("w", encoding="utf-8-sig", newline="\r\n") as handle:
        for index, sub in enumerate(subtitles, 1):
            handle.write(f"{index}\n")
            handle.write(f"{sub.timecode}\n")
            handle.write(f"{sub.text}\n\n")


def clean_spacing(text: str) -> str:
    text = text.replace("\\n", " ")
    text = re.sub(r"\s+", " ", text.strip())
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([!?;:])(?=[^\s\"')\]}”’])", r"\1 ", text)
    text = re.sub(r"(?<!\d),(?!\d)(?=[^\s\"')\]}”’])", ", ", text)
    text = re.sub(r"\.(?=[^\s.,!?;:\"')\]}”’])", ". ", text)
    text = re.sub(r"!{2,}", "!", text)
    text = re.sub(r"\?{2,}", "?", text)
    return text.strip()


def effective_first_char(text: str) -> str:
    stripped = text.strip()
    while stripped and stripped[0] in LEAD_CHARS:
        stripped = stripped[1:].lstrip()
    return stripped[0] if stripped else ""


def starts_uppercase(text: str) -> bool:
    char = effective_first_char(text)
    return bool(char) and char.isupper()


def starts_lowercase(text: str) -> bool:
    char = effective_first_char(text)
    return bool(char) and char.islower()


def first_alpha_pos(text: str) -> Optional[int]:
    in_tag = False
    for pos, char in enumerate(text):
        if char == "<":
            in_tag = True
            continue
        if char == ">":
            in_tag = False
            continue
        if in_tag or char in LEAD_CHARS:
            continue
        if char.isalpha():
            return pos
        if not char.isspace():
            return None
    return None


def uppercase_first_alpha(text: str) -> str:
    pos = first_alpha_pos(text)
    if pos is None:
        return text
    return text[:pos] + text[pos].upper() + text[pos + 1 :]


def append_period(text: str) -> str:
    stripped = text.rstrip()
    trailing = ""
    while stripped and stripped[-1] in CLOSING:
        trailing = stripped[-1] + trailing
        stripped = stripped[:-1].rstrip()
    return f"{stripped}.{trailing}"


def has_unmatched(text: str) -> Optional[str]:
    if text.count('"') % 2:
        return f"Unmatched straight double quote, count={text.count(chr(34))}"
    if text.count("(") != text.count(")"):
        return "Unmatched parentheses"
    if text.count("[") != text.count("]"):
        return "Unmatched square brackets"
    if text.count("{") != text.count("}"):
        return "Unmatched curly brackets"
    if text.count("“") != text.count("”"):
        return "Unmatched curly double quotes"
    if text.count("‘") != text.count("’"):
        return "Unmatched curly single quotes"
    return None


def split_text(text: str, max_chars: int) -> list[str]:
    text = clean_spacing(text)
    if visible_len(text) <= max_chars:
        return [text] if text else []

    return [
        part.strip()
        for part in textwrap.wrap(
            text,
            width=max_chars,
            break_long_words=True,
            break_on_hyphens=False,
        )
        if part.strip()
    ]


def split_timing(start_ms: int, end_ms: int, parts: list[str], min_ms: int) -> list[tuple[int, int]]:
    duration = max(0, end_ms - start_ms)
    if len(parts) <= 1:
        return [(start_ms, end_ms)]

    if duration < min_ms * len(parts):
        step = max(1, duration // len(parts))
        return [
            (start_ms + i * step, end_ms if i == len(parts) - 1 else start_ms + (i + 1) * step)
            for i in range(len(parts))
        ]

    total_len = sum(max(1, visible_len(part)) for part in parts)
    timings = []
    current = start_ms
    for i, part in enumerate(parts):
        if i == len(parts) - 1:
            part_end = end_ms
        else:
            part_duration = max(min_ms, int(duration * max(1, visible_len(part)) / total_len))
            remaining_parts = len(parts) - i - 1
            latest_end = end_ms - remaining_parts * min_ms
            part_end = min(current + part_duration, latest_end)
        timings.append((current, part_end))
        current = part_end
    return timings


def renumber(subtitles: list[Subtitle]) -> list[Subtitle]:
    for new_index, sub in enumerate(subtitles, 1):
        sub.index = new_index
    return subtitles


def add_issue(
    issues: list[Issue],
    filename: str,
    sub: Subtitle,
    rule: str,
    detail: str,
    original: str,
    fixed: str = "",
    auto_fixed: bool = False,
) -> None:
    issues.append(
        Issue(
            file=filename,
            sub_index=sub.index,
            timecode=sub.timecode,
            rule=rule,
            detail=detail,
            original=original[:120],
            fixed=fixed[:120],
            auto_fixed=auto_fixed,
        )
    )


def check_and_fix(
    subtitles: list[Subtitle],
    filename: str,
    max_chars: int,
    do_fix: bool,
    fix_language: bool,
    min_ms: int,
) -> tuple[list[Subtitle], list[Issue]]:
    issues: list[Issue] = []
    fixed_subs: list[Subtitle] = []

    previous_end = -1
    for sub in subtitles:
        original_text = sub.text
        cleaned = clean_spacing(original_text)
        parts = split_text(cleaned, max_chars)

        if len(sub.raw_lines) != 1:
            add_issue(
                issues,
                filename,
                sub,
                "MULTI LINE",
                f"Subtitle has {len(sub.raw_lines)} text lines; requirement is one text line",
                original_text,
                cleaned,
                auto_fixed=do_fix,
            )

        if cleaned != original_text:
            add_issue(
                issues,
                filename,
                sub,
                "SPACING",
                "Whitespace or punctuation spacing can be cleaned",
                original_text,
                cleaned,
                auto_fixed=do_fix,
            )

        if "\\n" in original_text:
            add_issue(
                issues,
                filename,
                sub,
                "INLINE NEWLINE",
                "Literal \\n found in subtitle text",
                original_text,
                cleaned,
                auto_fixed=do_fix,
            )

        for line_no, line in enumerate(sub.raw_lines, 1):
            length = visible_len(line.strip())
            if length > max_chars:
                add_issue(
                    issues,
                    filename,
                    sub,
                    "LINE TOO LONG",
                    f"Line {line_no}: {length} visible characters, limit is {max_chars}",
                    original_text,
                    " / ".join(parts),
                    auto_fixed=do_fix and all(visible_len(part) <= max_chars for part in parts),
                )

        if sub.raw_lines and all(visible_len(line.strip()) <= max_chars for line in sub.raw_lines):
            cleaned_length = visible_len(cleaned)
            if cleaned_length > max_chars:
                add_issue(
                    issues,
                    filename,
                    sub,
                    "LINE TOO LONG",
                    f"Joined one-line text would be {cleaned_length} visible characters, limit is {max_chars}",
                    original_text,
                    " / ".join(parts),
                    auto_fixed=do_fix and all(visible_len(part) <= max_chars for part in parts),
                )

        if previous_end > sub.start_ms:
            add_issue(
                issues,
                filename,
                sub,
                "TIME OVERLAP",
                "Start time is earlier than the previous subtitle end time",
                original_text,
            )
        if sub.end_ms <= sub.start_ms:
            add_issue(
                issues,
                filename,
                sub,
                "TIME INVALID",
                "End time must be later than start time",
                original_text,
            )
        previous_end = sub.end_ms

        unmatched = has_unmatched(cleaned)
        if unmatched:
            add_issue(issues, filename, sub, "UNMATCHED", unmatched, original_text)

        if do_fix and parts:
            timings = split_timing(sub.start_ms, sub.end_ms, parts, min_ms)
            for (part_start, part_end), part in zip(timings, parts):
                fixed_subs.append(
                    Subtitle(
                        index=0,
                        start_ms=part_start,
                        end_ms=part_end,
                        settings=sub.settings,
                        raw_lines=[part],
                    )
                )
        else:
            fixed_subs.append(sub)

    working = renumber(fixed_subs if do_fix else list(subtitles))

    for i in range(1, len(working)):
        prev = working[i - 1]
        curr = working[i]
        prev_last = prev.last_visible_char

        if prev_last in SENTENCE_END and starts_lowercase(curr.visible_text):
            fixed = uppercase_first_alpha(curr.text)
            if do_fix and fix_language:
                curr.raw_lines = [fixed]
            add_issue(
                issues,
                filename,
                curr,
                "CAPITALISATION",
                f"Previous subtitle ends with {prev_last!r}; this subtitle starts lowercase",
                curr.text,
                fixed,
                auto_fixed=do_fix and fix_language,
            )
        elif starts_uppercase(curr.visible_text) and prev_last and prev_last.isalnum():
            fixed = append_period(prev.text)
            if do_fix and fix_language:
                prev.raw_lines = [fixed]
            add_issue(
                issues,
                filename,
                prev,
                "POSSIBLE MISSING PERIOD",
                f"Next subtitle #{curr.index} starts uppercase, but this subtitle ends with {prev_last!r}",
                prev.text,
                fixed,
                auto_fixed=do_fix and fix_language,
            )

    return renumber(working), issues


RULE_ORDER = [
    "TIME INVALID",
    "TIME OVERLAP",
    "LINE TOO LONG",
    "MULTI LINE",
    "INLINE NEWLINE",
    "SPACING",
    "CAPITALISATION",
    "POSSIBLE MISSING PERIOD",
    "UNMATCHED",
]


def process_file(
    path: Path,
    out_dir: Optional[Path],
    max_chars: int,
    do_fix: bool,
    fix_language: bool,
    min_ms: int,
) -> list[Issue]:
    subtitles, parse_errors = parse_srt(path)
    issues = [
        Issue(
            file=path.name,
            sub_index=0,
            timecode="",
            rule="PARSE",
            detail=error,
            original="",
        )
        for error in parse_errors
    ]

    fixed_subtitles, found = check_and_fix(
        subtitles,
        path.name,
        max_chars=max_chars,
        do_fix=do_fix,
        fix_language=fix_language,
        min_ms=min_ms,
    )
    issues.extend(found)

    auto_count = sum(1 for issue in found if issue.auto_fixed)
    if do_fix and auto_count:
        target_dir = out_dir or path.parent
        target_dir.mkdir(parents=True, exist_ok=True)
        out_path = target_dir / f"{path.stem}_fixed{path.suffix}"
        write_srt(fixed_subtitles, out_path)
        print(f"  {path.name}: {len(issues)} issue(s), {auto_count} fixed -> {out_path.name}")
    else:
        print(f"  {path.name}: {len(issues)} issue(s)")
    return issues


def collect_srt_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() == ".srt" else []
    files = sorted(file for file in path.iterdir() if file.is_file() and file.suffix.lower() == ".srt")
    originals = [file for file in files if "_fixed" not in file.stem]
    return originals or files


def process_path(
    path: Path,
    out_dir: Optional[Path],
    max_chars: int,
    do_fix: bool,
    fix_language: bool,
    min_ms: int,
) -> list[Issue]:
    files = collect_srt_files(path)
    if not files:
        print(f"[WARNING] No .srt files found in: {path}")
        return []
    issues: list[Issue] = []
    for file in files:
        issues.extend(process_file(file, out_dir, max_chars, do_fix, fix_language, min_ms))
    return issues


def print_report(issues: list[Issue]) -> None:
    if not issues:
        print("\nNo issues found.")
        return

    by_file: dict[str, list[Issue]] = {}
    for issue in issues:
        by_file.setdefault(issue.file, []).append(issue)

    auto_count = sum(1 for issue in issues if issue.auto_fixed)
    manual_count = len(issues) - auto_count
    print("\n" + "-" * 72)
    print(f"TOTAL: {len(issues)} issue(s) across {len(by_file)} file(s)")
    print(f"Auto-fixed: {auto_count}   Needs review: {manual_count}")
    print("-" * 72)

    for filename, file_issues in by_file.items():
        print(f"\n{filename}")
        for issue in sorted(
            file_issues,
            key=lambda item: (
                item.sub_index,
                RULE_ORDER.index(item.rule) if item.rule in RULE_ORDER else 99,
            ),
        ):
            tag = "FIXED" if issue.auto_fixed else "REVIEW"
            print(f"  [{tag}] #{issue.sub_index:>4} {issue.timecode}")
            print(f"         {issue.rule}: {issue.detail}")
            if issue.original:
                print(f"         Before: {issue.original}")
            if issue.fixed:
                print(f"         After : {issue.fixed}")


def save_csv(issues: list[Issue], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["File", "Sub#", "Timecode", "Rule", "Auto-Fixed", "Detail", "Original", "Fixed"])
        for issue in issues:
            writer.writerow(
                [
                    issue.file,
                    issue.sub_index,
                    issue.timecode,
                    issue.rule,
                    "YES" if issue.auto_fixed else "NO",
                    issue.detail,
                    issue.original,
                    issue.fixed,
                ]
            )
    print(f"\nReport saved to: {out_path}")


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="SRT quality checker and safe auto-fixer")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(script_dir),
        help="SRT file or folder containing SRT files",
    )
    parser.add_argument("--out", default="", help="Save issue report to CSV")
    parser.add_argument("--out-dir", default="", help="Folder for *_fixed.srt files")
    parser.add_argument("--max-chars", type=int, default=45, help="Maximum visible chars per text line")
    parser.add_argument("--min-ms", type=int, default=500, help="Minimum timing for split subtitles")
    parser.add_argument("--fix", action="store_true", help="Write safe fixed SRT files")
    parser.add_argument(
        "--fix-language",
        action="store_true",
        help="Also apply capitalization and possible missing-period guesses",
    )
    parser.add_argument(
        "--no-fix",
        action="store_true",
        help="Compatibility alias for report-only mode",
    )
    args = parser.parse_args()

    target = Path(args.path).expanduser().resolve()
    if not target.exists():
        print(f"[ERROR] Path does not exist: {target}")
        return 1

    do_fix = bool(args.fix and not args.no_fix)
    out_dir = Path(args.out_dir).expanduser().resolve() if args.out_dir else None
    mode = "CHECK + SAFE FIX" if do_fix else "CHECK ONLY"
    if do_fix and args.fix_language:
        mode += " + LANGUAGE FIX"
    print(f"\n[{mode}] {target} (line limit: {args.max_chars})\n")

    issues = process_path(
        target,
        out_dir=out_dir,
        max_chars=args.max_chars,
        do_fix=do_fix,
        fix_language=args.fix_language,
        min_ms=args.min_ms,
    )
    print_report(issues)
    if args.out:
        save_csv(issues, Path(args.out).expanduser().resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
