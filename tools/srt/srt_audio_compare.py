#!/usr/bin/env python3
"""Local video transcription and SRT comparison."""

import argparse
import csv
import difflib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import srt_qc


@dataclass
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class TranscriptResult:
    segments: list[TranscriptSegment]
    words: list[TranscriptSegment]


@dataclass
class AudioReviewItem:
    priority: int
    file: str
    sub_index: int
    timecode: str
    issue: str
    score: float
    srt_text: str
    transcript_text: str
    detail: str


def find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def extract_audio(video_path: Path, audio_path: Path) -> None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            "Cannot find ffmpeg. Install ffmpeg or imageio-ffmpeg before running local transcription."
        )

    command = [
        ffmpeg,
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(audio_path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def transcribe_faster_whisper(audio_path: Path, model_size: str, language: str | None) -> TranscriptResult:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("Missing faster-whisper. Install it with: python3 -m pip install faster-whisper") from exc

    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        word_timestamps=True,
    )
    transcript_segments: list[TranscriptSegment] = []
    transcript_words: list[TranscriptSegment] = []

    for segment in segments:
        text = segment.text.strip()
        if text:
            transcript_segments.append(
                TranscriptSegment(
                    start_ms=int(segment.start * 1000),
                    end_ms=int(segment.end * 1000),
                    text=text,
                )
            )
        for word in segment.words or []:
            word_text = word.word.strip()
            if word_text:
                transcript_words.append(
                    TranscriptSegment(
                        start_ms=int(word.start * 1000),
                        end_ms=int(word.end * 1000),
                        text=word_text,
                    )
                )
    return TranscriptResult(segments=transcript_segments, words=transcript_words)


def transcribe_openai_whisper(audio_path: Path, model_size: str, language: str | None) -> TranscriptResult:
    try:
        import whisper
    except ImportError as exc:
        raise RuntimeError("Missing whisper. Install it with: python3 -m pip install openai-whisper") from exc

    model = whisper.load_model(model_size)
    result = model.transcribe(str(audio_path), language=language)
    segments = [
        TranscriptSegment(
            start_ms=int(segment["start"] * 1000),
            end_ms=int(segment["end"] * 1000),
            text=segment["text"].strip(),
        )
        for segment in result.get("segments", [])
        if segment.get("text", "").strip()
    ]
    return TranscriptResult(segments=segments, words=[])


def transcribe(audio_path: Path, engine: str, model_size: str, language: str | None) -> TranscriptResult:
    if engine == "faster-whisper":
        return transcribe_faster_whisper(audio_path, model_size, language)
    if engine == "whisper":
        return transcribe_openai_whisper(audio_path, model_size, language)

    try:
        return transcribe_faster_whisper(audio_path, model_size, language)
    except RuntimeError as faster_error:
        try:
            return transcribe_openai_whisper(audio_path, model_size, language)
        except RuntimeError as whisper_error:
            raise RuntimeError(f"{faster_error}\n{whisper_error}") from whisper_error


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text.lower())
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def similarity(left: str, right: str) -> float:
    left_norm = normalize_text(left)
    right_norm = normalize_text(right)
    if not left_norm and not right_norm:
        return 1.0
    if not left_norm or not right_norm:
        return 0.0
    return difflib.SequenceMatcher(None, left_norm, right_norm).ratio()


def overlap_ms(start_a: int, end_a: int, start_b: int, end_b: int) -> int:
    return max(0, min(end_a, end_b) - max(start_a, start_b))


def transcript_for_subtitle(
    sub: srt_qc.Subtitle,
    units: list[TranscriptSegment],
    padding_ms: int,
) -> tuple[str, list[TranscriptSegment]]:
    start = sub.start_ms - padding_ms
    end = sub.end_ms + padding_ms
    matches = [segment for segment in units if overlap_ms(start, end, segment.start_ms, segment.end_ms) > 0]
    return " ".join(segment.text for segment in matches).strip(), matches


def compare_srt_to_transcript(
    srt_path: Path,
    transcript: TranscriptResult,
    threshold: float,
    padding_ms: int,
) -> list[AudioReviewItem]:
    subtitles, parse_errors = srt_qc.parse_srt(srt_path)
    items: list[AudioReviewItem] = []
    units = transcript.words or transcript.segments

    for error in parse_errors:
        items.append(
            AudioReviewItem(
                priority=100,
                file=srt_path.name,
                sub_index=0,
                timecode="",
                issue="PARSE",
                score=0,
                srt_text="",
                transcript_text="",
                detail=error,
            )
        )

    for sub in subtitles:
        transcript_text, _matched_segments = transcript_for_subtitle(sub, units, padding_ms)
        score = similarity(sub.text, transcript_text)
        if not transcript_text:
            items.append(
                AudioReviewItem(
                    priority=85,
                    file=srt_path.name,
                    sub_index=sub.index,
                    timecode=sub.timecode,
                    issue="NO TRANSCRIPT NEAR SUBTITLE",
                    score=score,
                    srt_text=sub.text,
                    transcript_text="",
                    detail="No transcribed speech overlaps this subtitle timing",
                )
            )
        elif score < threshold:
            items.append(
                AudioReviewItem(
                    priority=80 if score < threshold / 2 else 60,
                    file=srt_path.name,
                    sub_index=sub.index,
                    timecode=sub.timecode,
                    issue="LOW TEXT MATCH",
                    score=score,
                    srt_text=sub.text,
                    transcript_text=transcript_text,
                    detail=f"Similarity {score:.2f} is below threshold {threshold:.2f}",
                )
            )

    for segment in transcript.segments:
        covered = any(
            overlap_ms(sub.start_ms - padding_ms, sub.end_ms + padding_ms, segment.start_ms, segment.end_ms) > 0
            for sub in subtitles
        )
        if not covered:
            items.append(
                AudioReviewItem(
                    priority=75,
                    file=srt_path.name,
                    sub_index=0,
                    timecode=f"{srt_qc.format_time(segment.start_ms)} --> {srt_qc.format_time(segment.end_ms)}",
                    issue="TRANSCRIPT WITHOUT SUBTITLE",
                    score=0,
                    srt_text="",
                    transcript_text=segment.text,
                    detail="Transcribed speech has no nearby subtitle",
                )
            )

    items.sort(key=lambda item: (-item.priority, item.file, item.sub_index, item.timecode))
    return items


def write_transcript_csv(segments: list[TranscriptSegment], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Start", "End", "Text"])
        for segment in segments:
            writer.writerow([srt_qc.format_time(segment.start_ms), srt_qc.format_time(segment.end_ms), segment.text])


def write_review_csv(items: list[AudioReviewItem], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
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
        for item in items:
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
    parser = argparse.ArgumentParser(description="Transcribe a local video and compare it with an SRT file")
    parser.add_argument("video", help="Video file, such as .mp4")
    parser.add_argument("srt", help="Matching .srt file")
    parser.add_argument("--out-dir", default="srt_audio_output", help="Output folder")
    parser.add_argument("--engine", choices=["auto", "faster-whisper", "whisper"], default="auto")
    parser.add_argument("--model", default="base", help="Whisper model size, such as tiny/base/small/medium")
    parser.add_argument("--language", default="", help="Optional language code, such as ro, en, zh")
    parser.add_argument("--threshold", type=float, default=0.35, help="Low-match threshold")
    parser.add_argument("--padding-ms", type=int, default=150, help="Timing padding when matching transcript to SRT")
    args = parser.parse_args()

    video_path = Path(args.video).expanduser().resolve()
    srt_path = Path(args.srt).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()

    if not video_path.is_file():
        print(f"Video file does not exist: {video_path}")
        return 1
    if not srt_path.is_file():
        print(f"SRT file does not exist: {srt_path}")
        return 1

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "audio.wav"
            print("Extracting audio...")
            extract_audio(video_path, audio_path)

            print(f"Transcribing locally with model '{args.model}'...")
            transcript = transcribe(audio_path, args.engine, args.model, args.language or None)

        transcript_csv = out_dir / "transcript_segments.csv"
        review_csv = out_dir / "audio_review.csv"
        write_transcript_csv(transcript.segments, transcript_csv)

        review_items = compare_srt_to_transcript(
            srt_path,
            transcript,
            threshold=args.threshold,
            padding_ms=args.padding_ms,
        )
        write_review_csv(review_items, review_csv)
    except RuntimeError as exc:
        print(str(exc))
        return 2
    except subprocess.CalledProcessError:
        print("Audio extraction failed. Please check that the video file is valid.")
        return 2

    print("\nAudio comparison complete")
    print(f"Transcript segments: {len(transcript.segments)}")
    print(f"Transcript words: {len(transcript.words)}")
    print(f"Review items: {len(review_items)}")
    print(f"Transcript CSV: {transcript_csv}")
    print(f"Audio review CSV: {review_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
