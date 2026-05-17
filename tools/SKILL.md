---
name: srt-romanian-editor
description: Romanian SRT subtitle preprocessing, batch name cleanup, and QA review for the user's editing workflow. Use when Codex needs to process .srt files or folders, keep one text line per subtitle, enforce 45-character Romanian subtitle lines, preserve Romanian semantic phrase boundaries, replace recurring OCR/ASR name variants, report file/subtitle/timecode locations, or review subtitles for capitalization, punctuation, missing labels, time overlap, malformed quotes, and bad line breaks.
---

# Romanian SRT Editor

## Core Habit

Treat SRT work as a subtitle editing workflow, not just text replacement.

1. Inspect the exact input path first. Confirm whether it is a single `.srt` file or a folder.
2. Prefer output folders for preprocessing unless the user explicitly asks to modify in place.
3. For replacements, search and report locations before changing when the user asks for positioning; if the user says "directly replace", apply changes and then verify zero residuals.
4. Preserve `Amandei` unless the user explicitly asks to normalize it; it is a Romanian genitive form.
5. Use `rg` and the bundled script before writing custom one-off code.

## Main Script

Use [`scripts/srt_ro_tool.py`](scripts/srt_ro_tool.py) for repeatable work:

```bash
python3 /Users/miko/.codex/skills/srt-romanian-editor/scripts/srt_ro_tool.py preprocess INPUT_PATH --out OUTPUT_PATH
python3 /Users/miko/.codex/skills/srt-romanian-editor/scripts/srt_ro_tool.py replace-names INPUT_PATH --dry-run
python3 /Users/miko/.codex/skills/srt-romanian-editor/scripts/srt_ro_tool.py replace-names INPUT_PATH
python3 /Users/miko/.codex/skills/srt-romanian-editor/scripts/srt_ro_tool.py check INPUT_PATH --report /tmp/srt_review.csv
```

Operations:

- `preprocess`: parse SRT, merge unfinished sentences across cues, split into one-line cues no longer than 45 characters, and preserve Romanian phrase boundaries.
- `replace-names`: normalize the user's recurring name mistakes in place; use `--dry-run` first when the user did not explicitly ask for direct modification.
- `check`: report hard format issues and likely editorial issues without changing files. It preserves original text-line counts so it can detect real multi-line cues.

## Preprocessing Rules

Apply these constraints:

- One subtitle cue must have exactly one text line.
- The visible text of each cue must be `<= 45` characters.
- Do not cut inside natural Romanian grammar units.
- Avoid boundaries after or before small function words: `a`, `să`, `se`, `că`, `ca`, `pe`, `de`, `pentru`, `și`, `dar`, `care`, `când`, `cum`, `unde`.
- Prefer splits at sentence punctuation, commas, and clause starts.
- Good split example:
  - `Mama a murit`
  - `dar ea ne iubește întotdeauna.`
- Bad split example:
  - `Mama a`
  - `murit dar ea ne iubește întotdeauna.`

If source subtitles contain artificial punctuation like `pe. Mine`, treat the function-word sentence ending as suspicious and merge/re-split as `pe mine`.

## Name Cleanup

Normalize these recurring ASR/OCR variants when they are used as character names:

- `Amenda` -> `Amanda`
- `Enric` -> `Eric`
- `Hassel` -> `Hazel`
- `Luca` -> `Lucas`
- `gratis`, `Grey`, `Grey's`, `Gray`, `Greece`, `Gresie`, `GRESI`, `Gras`, `Grecii`, `Griji` -> `Grace`

Do not blindly replace non-name words:

- Keep `Amandei` unless requested.
- Keep `Group`, `Gata`, `Gunoi`, `Greșești`, `Greșesc`.

After name cleanup, verify residuals for old forms and count target names.

## QA Checklist

Always report locations as:

`filename.srt #subtitle_number timecode`

Check:

- leftover name variants and lowercase versions of `Hazel`, `Lucas`, `Eric`, `Amanda`;
- multi-line cue text;
- lines over 45 characters;
- malformed punctuation such as `.,`, `,.`, `...?`, spaces before punctuation;
- unmatched quotes, but recognize that a quote may open in one cue and close in the next;
- time overlaps;
- sentence starts that are lowercase after `.?!`;
- cues ending on function words such as `pe`, `să`, `că`, `pentru`, `de`, `și`;
- likely missing periods only as "needs review", not automatic edits.

When a finding is not certain, label it as a review candidate rather than a hard error.

Prefer this execution order for a full cleanup:

1. `check` the user-supplied folder and summarize issue categories.
2. `replace-names --dry-run`, then apply `replace-names` if the requested replacements are clear.
3. `preprocess` into a sibling output folder if line wrapping or semantic splitting is needed.
4. `check` the final output and report residual issues by location.
