#!/usr/bin/env python3
"""One-command SRT review workflow."""

import argparse
import csv
import sys
from dataclasses import dataclass
from pathlib import Path

import srt_qc


REVIEW_PRIORITY = {
    "PARSE": 100,
    "TIME INVALID": 98,
    "TIME OVERLAP": 95,
    "LINE TOO LONG": 90,
    "MULTI LINE": 85,
    "INLINE NEWLINE": 80,
    "UNMATCHED": 70,
    "CAPITALISATION": 55,
    "POSSIBLE MISSING PERIOD": 50,
    "SPACING": 30,
    "LOW CPS": 25,
    "HIGH CPS": 20,
    "SHORT DURATION": 15,
}

_UNKNOWN_RULES_WARNED: set[str] = set()


@dataclass
class ReviewItem:
    priority: int
    file: str
    sub_index: int
    timecode: str
    rule: str
    detail: str
    text: str
    suggestion: str = ""
    auto_fixed: bool = False


def duration_seconds(sub: srt_qc.Subtitle) -> float:
    return max(0, sub.end_ms - sub.start_ms) / 1000


def cps(sub: srt_qc.Subtitle) -> float:
    duration = duration_seconds(sub)
    if duration <= 0:
        return 0
    return srt_qc.visible_len(sub.text) / duration


def collect_extra_review_items(
    path: Path,
    max_cps: float,
    min_cps: float,
    min_duration_ms: int,
) -> list[ReviewItem]:
    """Collect optional timing and reading-speed items.

    PARSE items are intentionally excluded here because srt_qc.process_path()
    already emits them; including them again would duplicate rows in the review
    queue when --include-speed is used.
    """
    subtitles, _ = srt_qc.parse_srt(path)
    items: list[ReviewItem] = []

    for sub in subtitles:
        seconds = duration_seconds(sub)
        rate = cps(sub)
        if 0 < sub.end_ms - sub.start_ms < min_duration_ms:
            items.append(
                ReviewItem(
                    priority=REVIEW_PRIORITY["SHORT DURATION"],
                    file=path.name,
                    sub_index=sub.index,
                    timecode=sub.timecode,
                    rule="SHORT DURATION",
                    detail=f"Duration is {sub.end_ms - sub.start_ms} ms; minimum review target is {min_duration_ms} ms",
                    text=sub.text,
                )
            )
        if seconds > 0 and rate > max_cps:
            items.append(
                ReviewItem(
                    priority=REVIEW_PRIORITY["HIGH CPS"],
                    file=path.name,
                    sub_index=sub.index,
                    timecode=sub.timecode,
                    rule="HIGH CPS",
                    detail=f"Reading speed is {rate:.1f} chars/sec; target max is {max_cps:.1f}",
                    text=sub.text,
                )
            )
        if seconds >= 2 and srt_qc.visible_len(sub.text) > 0 and rate < min_cps:
            items.append(
                ReviewItem(
                    priority=REVIEW_PRIORITY["LOW CPS"],
                    file=path.name,
                    sub_index=sub.index,
                    timecode=sub.timecode,
                    rule="LOW CPS",
                    detail=f"Reading speed is {rate:.1f} chars/sec; this may indicate missing text",
                    text=sub.text,
                )
            )
    return items


def issue_to_review_item(issue: srt_qc.Issue) -> ReviewItem:
    priority = REVIEW_PRIORITY.get(issue.rule)
    if priority is None:
        if issue.rule not in _UNKNOWN_RULES_WARNED:
            print(
                f"Warning: unknown rule '{issue.rule}', assigning default priority 10",
                file=sys.stderr,
            )
            _UNKNOWN_RULES_WARNED.add(issue.rule)
        priority = 10
    if issue.auto_fixed:
        priority = max(1, priority - 40)
    return ReviewItem(
        priority=priority,
        file=issue.file,
        sub_index=issue.sub_index,
        timecode=issue.timecode,
        rule=issue.rule,
        detail=issue.detail,
        text=issue.original,
        suggestion=issue.fixed,
        auto_fixed=issue.auto_fixed,
    )


def collect_files(path: Path) -> list[Path]:
    files = srt_qc.collect_srt_files(path)
    if not files:
        return []
    return files


def write_review_csv(items: list[ReviewItem], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "Priority",
                "File",
                "Sub#",
                "Timecode",
                "Rule",
                "Detail",
                "Text",
                "Suggestion",
                "Auto-Fixed",
            ]
        )
        for item in items:
            writer.writerow(
                [
                    item.priority,
                    item.file,
                    item.sub_index,
                    item.timecode,
                    item.rule,
                    item.detail,
                    item.text,
                    item.suggestion,
                    "YES" if item.auto_fixed else "NO",
                ]
            )


def write_summary(items: list[ReviewItem], path: Path) -> None:
    counts: dict[str, int] = {}
    files: set[str] = set()
    for item in items:
        counts[item.rule] = counts.get(item.rule, 0) + 1
        files.add(item.file)

    manual_count = sum(1 for item in items if not item.auto_fixed)
    fixed_count = sum(1 for item in items if item.auto_fixed)
    top_n = min(20, len(items))

    lines = [
        "SRT workflow summary",
        "",
        f"Total review items : {len(items)}",
        f"  Needs manual review : {manual_count}",
        f"  Auto-fixed          : {fixed_count}",
        f"Files with review items: {len(files)}",
        "",
        "By rule:",
    ]
    for rule, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0])):
        lines.append(f"  {rule}: {count}")

    lines.extend(["", f"Top {top_n} review items (of {len(items)} total):"])
    for item in items[:top_n]:
        lines.append(f"  P{item.priority} {item.file} #{item.sub_index} {item.rule}: {item.detail}")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run SRT QC and create a prioritized manual-review queue")
    parser.add_argument("path", help="SRT file or folder")
    parser.add_argument("--work-dir", default="srt_workflow_output", help="Output folder for reports and fixed files")
    parser.add_argument("--fix", action="store_true", help="Write safe fixed SRT files")
    parser.add_argument("--fix-language", action="store_true", help="Also apply language guesses during fixing (requires --fix)")
    parser.add_argument("--max-chars", type=int, default=45)
    parser.add_argument("--min-ms", type=int, default=500)
    parser.add_argument("--include-speed", action="store_true", help="Also add reading-speed items to manual_review.csv")
    parser.add_argument("--max-cps", type=float, default=24.0, help="Flag subtitles above this reading speed")
    parser.add_argument("--min-cps", type=float, default=1.5, help="Flag long subtitles below this speed")
    parser.add_argument("--strict", action="store_true", help="Exit with code 1 if any review items are found")
    args = parser.parse_args()

    if args.fix_language and not args.fix:
        print("Warning: --fix-language has no effect without --fix", file=sys.stderr)

    target = Path(args.path).expanduser().resolve()
    if not target.exists():
        print(f"Path does not exist: {target}")
        return 1

    work_dir = Path(args.work_dir).expanduser().resolve()
    report_dir = work_dir / "reports"
    fixed_dir = work_dir / "fixed_srt"
    report_dir.mkdir(parents=True, exist_ok=True)

    files = collect_files(target)
    if not files:
        print(f"No .srt files found: {target}")
        return 0

    qc_issues = srt_qc.process_path(
        target,
        out_dir=fixed_dir if args.fix else None,
        max_chars=args.max_chars,
        do_fix=args.fix,
        fix_language=args.fix_language,
        min_ms=args.min_ms,
    )

    review_items = [issue_to_review_item(issue) for issue in qc_issues]
    if args.include_speed:
        for file in files:
            review_items.extend(
                collect_extra_review_items(
                    file,
                    max_cps=args.max_cps,
                    min_cps=args.min_cps,
                    min_duration_ms=args.min_ms,
                )
            )

    review_items.sort(key=lambda item: (-item.priority, item.file, item.sub_index, item.rule))

    full_report = report_dir / "qc_report.csv"
    review_report = report_dir / "manual_review.csv"
    summary = report_dir / "summary.txt"

    srt_qc.save_csv(qc_issues, full_report)
    write_review_csv(review_items, review_report)
    write_summary(review_items, summary)

    print("\nWorkflow complete")
    print(f"Files scanned         : {len(files)}")
    print(f"Manual-review items   : {sum(1 for i in review_items if not i.auto_fixed)}")
    print(f"Auto-fixed items      : {sum(1 for i in review_items if i.auto_fixed)}")
    print(f"Full QC report        : {full_report}")
    print(f"Prioritized review queue: {review_report}")
    print(f"Summary               : {summary}")
    if args.fix:
        print(f"Fixed SRT folder      : {fixed_dir}")
    if args.strict and review_items:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
