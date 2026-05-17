#!/usr/bin/env python3
"""Batch local audio/SRT comparison for numbered video and SRT folders."""

import argparse
import csv
import re
import sys
import tempfile
from pathlib import Path

import srt_audio_compare


def number_from_video(path: Path) -> int | None:
    match = re.search(r"(\d+)(?=\D*$)", path.stem)
    return int(match.group(1)) if match else None


def pair_files(video_folder: Path, srt_folder: Path) -> list[tuple[Path, Path]]:
    pairs: list[tuple[Path, Path]] = []
    videos = sorted(
        (video for video in video_folder.iterdir() if video.suffix.lower() in {".mp4", ".mov", ".mkv", ".m4v"}),
        key=lambda path: (number_from_video(path) is None, number_from_video(path) or 0, path.name),
    )
    for video in videos:
        if video.suffix.lower() not in {".mp4", ".mov", ".mkv", ".m4v"}:
            continue
        number = number_from_video(video)
        if number is None:
            continue
        srt = srt_folder / f"{number:04d}.srt"
        if srt.exists():
            pairs.append((video, srt))
    return pairs


def append_review_items(all_items: list[srt_audio_compare.AudioReviewItem], output_csv: Path) -> None:
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "Priority",
                "File",
                "Sub#",
                "Timecode",
                "Issue",
                "Score",
                "SRT Text",
                "Transcript Text",
                "Detail",
            ]
        )
        for item in sorted(all_items, key=lambda value: (-value.priority, value.file, value.sub_index)):
            writer.writerow(
                [
                    item.priority,
                    item.file,
                    item.sub_index,
                    item.timecode,
                    item.issue,
                    f"{item.score:.3f}",
                    item.srt_text,
                    item.transcript_text,
                    item.detail,
                ]
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch compare local videos with matching numbered SRT files")
    parser.add_argument("video_folder")
    parser.add_argument("srt_folder")
    parser.add_argument("--out-dir", default="srt_audio_batch_output")
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="ro")
    parser.add_argument("--engine", choices=["auto", "faster-whisper", "whisper"], default="faster-whisper")
    parser.add_argument("--threshold", type=float, default=0.35)
    parser.add_argument("--padding-ms", type=int, default=150)
    parser.add_argument("--start", type=int, default=0, help="First video number to process")
    parser.add_argument("--end", type=int, default=0, help="Last video number to process")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of pairs to process")
    args = parser.parse_args()

    video_folder = Path(args.video_folder).expanduser().resolve()
    srt_folder = Path(args.srt_folder).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()

    if not video_folder.is_dir():
        print(f"Video folder does not exist: {video_folder}")
        return 1
    if not srt_folder.is_dir():
        print(f"SRT folder does not exist: {srt_folder}")
        return 1

    pairs = pair_files(video_folder, srt_folder)
    if args.start:
        pairs = [(video, srt) for video, srt in pairs if number_from_video(video) >= args.start]
    if args.end:
        pairs = [(video, srt) for video, srt in pairs if number_from_video(video) <= args.end]
    if args.limit:
        pairs = pairs[: args.limit]

    if not pairs:
        print("No matching video/SRT pairs found.")
        return 0

    all_items: list[srt_audio_compare.AudioReviewItem] = []
    transcript_dir = out_dir / "transcripts"
    transcript_dir.mkdir(parents=True, exist_ok=True)

    for index, (video, srt) in enumerate(pairs, 1):
        print(f"[{index}/{len(pairs)}] {video.name} + {srt.name}")
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                audio_path = Path(temp_dir) / "audio.wav"
                srt_audio_compare.extract_audio(video, audio_path)
                transcript = srt_audio_compare.transcribe(
                    audio_path,
                    args.engine,
                    args.model,
                    args.language or None,
                )

            srt_audio_compare.write_transcript_csv(
                transcript.segments,
                transcript_dir / f"{srt.stem}_transcript.csv",
            )
            items = srt_audio_compare.compare_srt_to_transcript(
                srt,
                transcript,
                threshold=args.threshold,
                padding_ms=args.padding_ms,
            )
            all_items.extend(items)
            print(f"  review items: {len(items)}")
        except Exception as exc:
            all_items.append(
                srt_audio_compare.AudioReviewItem(
                    priority=100,
                    file=srt.name,
                    sub_index=0,
                    timecode="",
                    issue="AUDIO COMPARE FAILED",
                    score=0,
                    srt_text="",
                    transcript_text="",
                    detail=str(exc),
                )
            )
            print(f"  failed: {exc}")

    review_csv = out_dir / "audio_review.csv"
    append_review_items(all_items, review_csv)
    print("\nBatch audio comparison complete")
    print(f"Pairs processed: {len(pairs)}")
    print(f"Review items: {len(all_items)}")
    print(f"Combined review CSV: {review_csv}")
    print(f"Transcript folder: {transcript_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
