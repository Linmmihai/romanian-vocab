#!/usr/bin/env python3
"""
Local Personal Workflow Agent

A small browser-based agent for people who prefer plain-language tasks over CLI
commands. It starts with safe local project workflows and is intentionally built
so new tool adapters can be added without changing the UI.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


AGENT_DIR = Path(__file__).resolve().parent
TOOLS_DIR = AGENT_DIR.parent
PROJECT_ROOT = TOOLS_DIR.parent
SRT_TOOLS_DIR = TOOLS_DIR / "srt"
DEFAULT_SRT_DIR = TOOLS_DIR / "content_original" / "srt"
DEFAULT_VIDEO_DIR = TOOLS_DIR / "content_original" / "video"
RUNS_DIR = AGENT_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)
VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".m4v"}
MEDIA_SUFFIXES = VIDEO_SUFFIXES | {".mp3", ".wav", ".aac", ".flac", ".m4a", ".png", ".jpg", ".jpeg", ".gif", ".webp"}
IGNORED_DIR_NAMES = {".git", "__pycache__", ".netlify", "runs", "node_modules", ".venv", "venv", "content_original"}
MAX_REQUEST_BYTES = 64 * 1024


@dataclass
class ToolAction:
    id: str
    title: str
    description: str
    command: list[str]
    cwd: Path
    mutates_files: bool = False


RUNS: dict[str, dict[str, Any]] = {}
PENDING_ACTIONS: dict[str, ToolAction] = {}
STATE_LOCK = threading.RLock()


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def now_label() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def find_project_files(limit: int = 80) -> list[str]:
    files: list[str] = []
    for path in sorted(PROJECT_ROOT.rglob("*"), key=lambda item: rel(item)):
        if any(part in IGNORED_DIR_NAMES for part in path.parts):
            continue
        if path.is_file() and not path.name.startswith(".") and path.suffix.lower() not in MEDIA_SUFFIXES:
            files.append(rel(path))
        if len(files) >= limit:
            break
    return files


def count_files(folder: Path, suffixes: set[str]) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for path in folder.iterdir() if path.is_file() and path.suffix.lower() in suffixes)


def project_inventory() -> dict[str, Any]:
    return {
        "files": find_project_files(),
        "media": {
            "videos": count_files(DEFAULT_VIDEO_DIR, VIDEO_SUFFIXES),
            "srt_files": count_files(DEFAULT_SRT_DIR, {".srt"}),
        },
    }


def netlify_state() -> dict[str, Any] | None:
    state_path = PROJECT_ROOT / ".netlify" / "state.json"
    if not state_path.exists():
        return None
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"error": "Netlify state file exists but is not valid JSON."}


def summarize_csv(csv_path: Path, max_rows: int = 8) -> dict[str, Any] | None:
    if not csv_path.exists():
        return None
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
    except UnicodeDecodeError:
        with csv_path.open("r", encoding="utf-8", errors="replace", newline="") as f:
            rows = list(csv.DictReader(f))
    return {
        "path": rel(csv_path),
        "count": len(rows),
        "rows": rows[:max_rows],
    }


def number_from_name(path: Path) -> int | None:
    match = re.search(r"(\d+)(?=\D*$)", path.stem)
    return int(match.group(1)) if match else None


def matching_video_srt_pairs(limit: int = 2) -> list[tuple[Path, Path]]:
    if not DEFAULT_VIDEO_DIR.is_dir() or not DEFAULT_SRT_DIR.is_dir():
        return []
    videos = sorted(
        (path for path in DEFAULT_VIDEO_DIR.iterdir() if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES),
        key=lambda path: (number_from_name(path) is None, number_from_name(path) or 0, path.name),
    )
    pairs: list[tuple[Path, Path]] = []
    for video in videos:
        number = number_from_name(video)
        if number is None:
            continue
        srt = DEFAULT_SRT_DIR / f"{number:04d}.srt"
        if srt.exists():
            pairs.append((video, srt))
            if len(pairs) >= limit:
                break
    return pairs


def has_transcription_engine() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None or importlib.util.find_spec("whisper") is not None


def make_action(
    title: str,
    description: str,
    command: list[str],
    cwd: Path = PROJECT_ROOT,
    mutates_files: bool = False,
) -> ToolAction:
    return ToolAction(
        id=f"act_{uuid.uuid4().hex[:10]}",
        title=title,
        description=description,
        command=command,
        cwd=cwd,
        mutates_files=mutates_files,
    )


def tool_path(script_name: str) -> Path | None:
    for base in [SRT_TOOLS_DIR, TOOLS_DIR / "qc"]:
        candidate = base / script_name
        if candidate.exists():
            return candidate
    return None


def append_script_action(
    actions: list[ToolAction],
    script_name: str,
    title: str,
    description: str,
    args: list[str],
    notes: list[str],
    mutates_files: bool = False,
) -> None:
    script_path = tool_path(script_name)
    if not script_path:
        notes.append(f"I could not find `{script_name}`, so I did not create that run button.")
        return
    actions.append(
        make_action(
            title,
            description,
            [sys.executable, str(script_path), *args],
            cwd=TOOLS_DIR,
            mutates_files=mutates_files,
        )
    )


def classify(message: str) -> dict[str, Any]:
    text = message.lower().strip()
    original_text = message.strip()
    actions: list[ToolAction] = []
    notes: list[str] = []
    quick_data: dict[str, Any] = {}

    if not text:
        return {
            "reply": "Tell me what you want to do, for example: check subtitles, search subtitle text, show project files, or check deployment setup.",
            "actions": [],
            "quick_data": {},
        }

    wants_search = any(k in text for k in ["search", "find", "查找", "搜索"])
    wants_subtitle = any(k in text for k in ["subtitle", "srt", "字幕", "qc", "quality"])

    if wants_subtitle and not wants_search:
        srt_count = count_files(DEFAULT_SRT_DIR, {".srt"})
        if srt_count == 0:
            notes.append(f"I did not find SRT files in `{rel(DEFAULT_SRT_DIR)}`, so there is nothing to check yet.")
        elif any(k in text for k in ["fix", "repair", "修复", "改"]):
            append_script_action(
                actions,
                "srt_workflow.py",
                "Preview and fix safe SRT format issues",
                "Creates fixed subtitle files and reports. Language-level changes are not applied.",
                [str(DEFAULT_SRT_DIR), "--fix"],
                notes,
                mutates_files=True,
            )
        else:
            append_script_action(
                actions,
                "srt_workflow.py",
                "Check SRT subtitle quality",
                "Generates a manual review list with likely subtitle issues.",
                [str(DEFAULT_SRT_DIR)],
                notes,
            )
        pairs = matching_video_srt_pairs(limit=1)
        if pairs and has_transcription_engine():
            video, srt = pairs[0]
            append_script_action(
                actions,
                "srt_audio_batch.py",
                "Run audio/subtitle comparison on first matched video",
                f"Compares `{video.name}` with `{srt.name}` using local transcription. This can take a while.",
                [str(DEFAULT_VIDEO_DIR), str(DEFAULT_SRT_DIR), "--model", "tiny", "--language", "ro", "--limit", "1"],
                notes,
            )
        elif pairs:
            notes.append("I found matched video/SRT files, but local transcription packages are missing.")
        else:
            notes.append("I did not find matching numbered video/SRT pairs for audio comparison.")
        if actions:
            notes.append("I found local subtitle workflows in this workspace, so I prepared buttons for those.")

    if wants_search:
        search_phrase = original_text
        for prefix in ["search subtitle text", "find subtitle text", "search subtitles", "find subtitles", "search", "find", "查找", "搜索"]:
            if search_phrase.lower().startswith(prefix):
                search_phrase = search_phrase[len(prefix):].strip(" :：\"'")
                break
        if search_phrase:
            append_script_action(
                actions,
                "subtitle_find.py",
                "Search subtitle text",
                f"Searches Romanian subtitles for `{search_phrase}`.",
                [search_phrase, str(DEFAULT_SRT_DIR), "--literal"],
                notes,
            )
        else:
            notes.append("Please type the word or phrase after the search request, for example: `search subtitle text salut`.")
            quick_data["capabilities"] = [
                "Search example: search subtitle text salut",
                "Search example: find subtitles Bucuresti",
            ]

    if any(k in text for k in ["project", "files", "repo", "workspace", "文件", "项目"]):
        quick_data.update(project_inventory())
        notes.append("I listed the main project files without changing anything.")

    if any(k in text for k in ["deploy", "netlify", "deployment", "发布", "部署"]):
        quick_data["netlify"] = netlify_state()
        actions.append(
            make_action(
                "Show Git workspace status",
                "Checks what files changed before any deploy or publish step.",
                ["git", "status", "--short", "--branch"],
                cwd=PROJECT_ROOT,
            )
        )
        notes.append("This local agent can inspect deploy setup. Actual production deploys should stay confirmation-based.")

    if any(k in text for k in ["tool", "tools", "can you", "help", "agent", "工具", "能做"]):
        quick_data["capabilities"] = [
            "Check subtitle quality and create review reports",
            "Search subtitle text",
            "Inspect project files and Git status",
            "Inspect Netlify project state",
            "Prepare future connectors for Gmail, GitHub, Vercel, documents, spreadsheets, and reminders",
        ]

    if not actions and not quick_data:
        quick_data["capabilities"] = [
            "Try: check subtitles",
            "Try: search subtitle text",
            "Try: show project files",
            "Try: check deployment setup",
        ]
        notes.append("I do not have a specific workflow for that yet, but this is where we add one.")

    reply = "I prepared the relevant workflow options below."
    if notes:
        reply += " " + " ".join(notes)

    with STATE_LOCK:
        for action in actions:
            PENDING_ACTIONS[action.id] = action

    return {
        "reply": reply,
        "actions": [action.__dict__ | {"cwd": str(action.cwd)} for action in actions],
        "quick_data": quick_data,
    }


def run_action(action: ToolAction) -> str:
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    run_dir = RUNS_DIR / f"{now_label()}-{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    command = list(action.command)
    cwd = action.cwd
    record = {
        "id": run_id,
        "status": "running",
        "title": action.title,
        "command": command,
        "cwd": str(cwd),
        "started_at": time.time(),
        "run_dir": str(run_dir),
        "output": "",
        "returncode": None,
        "summaries": {},
        "mutates_files": action.mutates_files,
    }
    with STATE_LOCK:
        RUNS[run_id] = record

    def persist_record() -> None:
        visible_record = dict(record)
        (run_dir / "record.json").write_text(
            json.dumps(visible_record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (run_dir / "output.txt").write_text(record.get("output", ""), encoding="utf-8", errors="replace")

    def worker() -> None:
        try:
            proc = subprocess.run(
                command,
                cwd=str(cwd),
                text=True,
                capture_output=True,
                timeout=60 * 60,
            )
            output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
            record["output"] = output[-20000:]
            record["returncode"] = proc.returncode
            record["status"] = "done" if proc.returncode == 0 else "failed"
        except subprocess.TimeoutExpired as exc:
            record["status"] = "failed"
            record["output"] = f"Timed out.\n{exc.stdout or ''}\n{exc.stderr or ''}"
        except Exception as exc:  # noqa: BLE001 - show friendly error in local tool
            record["status"] = "failed"
            record["output"] = str(exc)
        finally:
            record["finished_at"] = time.time()
            for candidate in [
                TOOLS_DIR / "srt_workflow_output" / "reports" / "summary.txt",
                TOOLS_DIR / "srt_workflow_output" / "reports" / "manual_review.csv",
                TOOLS_DIR / "srt_audio_batch_output" / "audio_review.csv",
            ]:
                if candidate.suffix == ".csv":
                    summary = summarize_csv(candidate)
                    if summary:
                        record["summaries"][rel(candidate)] = summary
                elif candidate.exists():
                    record["summaries"][rel(candidate)] = {
                        "path": rel(candidate),
                        "text": candidate.read_text(encoding="utf-8", errors="replace")[:5000],
                    }
            persist_record()

    threading.Thread(target=worker, daemon=True).start()
    return run_id


INDEX_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Personal Workflow Agent</title>
  <style>
    :root{--bg:#f7f7f4;--panel:#fff;--text:#182033;--muted:#667085;--line:#dedbd2;--accent:#2364d8;--accent2:#0f766e;--danger:#b42318;--shadow:0 1px 3px rgba(24,32,51,.08)}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .top{border-bottom:1px solid var(--line);background:#fff;padding:14px 18px;position:sticky;top:0}
    .top h1{font-size:18px;margin:0}.top p{margin:4px 0 0;color:var(--muted);font-size:13px}
    main{max-width:980px;margin:0 auto;padding:18px;display:grid;grid-template-columns:1fr 320px;gap:16px}
    .panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}
    .chat{min-height:520px;padding:14px;display:flex;flex-direction:column;gap:12px}
    .messages{flex:1;display:grid;align-content:start;gap:10px}
    .msg{padding:11px 12px;border-radius:8px;line-height:1.45;font-size:14px;white-space:pre-wrap}
    .user{background:#e9f1ff;margin-left:12%}.agent{background:#f2f1eb;margin-right:8%}
    .composer{display:grid;grid-template-columns:1fr auto;gap:8px}
    textarea{width:100%;resize:none;border:1px solid var(--line);border-radius:8px;padding:11px;font:inherit;min-height:48px}
    button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:9px 12px;font-weight:650;cursor:pointer;color:var(--text)}
    button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
    button.safe{border-color:#99d6cf;color:var(--accent2)}
    button.warn{border-color:#f5b5ae;color:var(--danger)}
    .side{padding:14px}.side h2{font-size:14px;margin:0 0 10px}.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px}
    .chip{font-size:12px;color:var(--muted);background:#f2f1eb;border-radius:99px;padding:6px 9px;cursor:pointer}
    .actions{display:grid;gap:10px}.action{border:1px solid var(--line);border-radius:8px;padding:11px;background:#fff}
    .action h3{font-size:14px;margin:0 0 5px}.action p{font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.4}
    .code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#344054;background:#f6f5f0;border-radius:6px;padding:8px;overflow:auto;margin-bottom:8px}
    .data{font-size:13px;line-height:1.45}.data h3{font-size:13px;margin:10px 0 6px}.data ul{margin:6px 0 12px;padding-left:18px}
    .run{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.run pre{white-space:pre-wrap;max-height:260px;overflow:auto;background:#111827;color:#e5e7eb;padding:10px;border-radius:7px;font-size:12px}
    @media(max-width:800px){main{grid-template-columns:1fr}.user{margin-left:0}.agent{margin-right:0}}
  </style>
</head>
<body>
  <div class="top">
    <h1>Personal Workflow Agent</h1>
    <p>Use plain language. The agent prepares safe local workflows and shows results in the browser.</p>
  </div>
  <main>
    <section class="panel chat">
      <div id="messages" class="messages"></div>
      <div class="composer">
        <textarea id="input" placeholder="Example: check subtitles, search subtitle text, show project files, check deployment setup"></textarea>
        <button class="primary" id="send">Send</button>
      </div>
    </section>
    <aside class="panel side">
      <h2>Starter requests</h2>
      <div class="chips">
        <span class="chip">check subtitles</span>
        <span class="chip">fix subtitle format</span>
        <span class="chip">search subtitle text</span>
        <span class="chip">show project files</span>
        <span class="chip">check deployment setup</span>
        <span class="chip">what tools can you use?</span>
      </div>
      <h2>Workflow options</h2>
      <div id="actions" class="actions"></div>
      <div id="quick" class="data"></div>
      <div id="runs"></div>
    </aside>
  </main>
  <script>
    const messages = document.querySelector('#messages');
    const input = document.querySelector('#input');
    const actionsEl = document.querySelector('#actions');
    const quickEl = document.querySelector('#quick');
    const runsEl = document.querySelector('#runs');
    let lastActions = {};

    function addMsg(text, cls) {
      const el = document.createElement('div');
      el.className = `msg ${cls}`;
      el.textContent = text;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    function esc(text) {
      return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function renderQuick(data) {
      const parts = [];
      if (data.capabilities) {
        parts.push('<h3>Capabilities</h3><ul>' + data.capabilities.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>');
      }
      if (data.files) {
        parts.push('<h3>Project Files</h3><ul>' + data.files.slice(0, 24).map(x => `<li>${esc(x)}</li>`).join('') + '</ul>');
      }
      if (data.media) {
        parts.push('<h3>Workspace Media</h3><ul>' +
          `<li>${esc(data.media.srt_files)} subtitle files</li>` +
          `<li>${esc(data.media.videos)} video files</li>` +
          '</ul>');
      }
      if (data.netlify) {
        parts.push('<h3>Netlify State</h3><div class="code">' + esc(JSON.stringify(data.netlify, null, 2)) + '</div>');
      }
      quickEl.innerHTML = parts.join('');
    }

    function renderActions(actions) {
      lastActions = {};
      actionsEl.innerHTML = actions.map(action => {
        lastActions[action.id] = action;
        const cls = action.mutates_files ? 'warn' : 'safe';
        const label = action.mutates_files ? 'Run with file changes' : 'Run';
        return `<div class="action">
          <h3>${esc(action.title)}</h3>
          <p>${esc(action.description)}</p>
          <div class="code">${esc(action.command.join(' '))}</div>
          <button class="${cls}" data-run="${esc(action.id)}">${label}</button>
        </div>`;
      }).join('');
    }

    async function send() {
      const text = input.value.trim();
      if (!text) return;
      addMsg(text, 'user');
      input.value = '';
      const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:text})});
      const data = await res.json();
      addMsg(data.reply, 'agent');
      renderActions(data.actions || []);
      renderQuick(data.quick_data || {});
    }

    async function runAction(id) {
      const action = lastActions[id];
      if (!action) return;
      if (action.mutates_files && !confirm('This workflow can create or change files. Continue?')) return;
      const res = await fetch('/api/run', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action_id:id})});
      const data = await res.json();
      const box = document.createElement('div');
      box.className = 'run';
      box.id = data.run_id;
      box.innerHTML = `<strong>${esc(action.title)}</strong><p>Status: running</p>`;
      runsEl.prepend(box);
      pollRun(data.run_id);
    }

    async function pollRun(id) {
      const res = await fetch(`/api/run?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      const box = document.getElementById(id);
      if (!box) return;
      let summaries = '';
      if (data.summaries) {
        for (const [path, summary] of Object.entries(data.summaries)) {
          summaries += `<h3>${esc(path)}</h3>`;
          if (summary.text) summaries += `<pre>${esc(summary.text)}</pre>`;
          if (summary.rows) summaries += `<p>${summary.count} rows</p><pre>${esc(JSON.stringify(summary.rows, null, 2))}</pre>`;
        }
      }
      box.innerHTML = `<strong>${esc(data.title)}</strong><p>Status: ${esc(data.status)}${data.returncode !== null ? ` · code ${data.returncode}` : ''}</p>${summaries}<pre>${esc(data.output || '')}</pre>`;
      if (data.status === 'running') setTimeout(() => pollRun(id), 1200);
    }

    document.querySelector('#send').addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
    document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => { input.value = chip.textContent; send(); }));
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-run]');
      if (btn) runAction(btn.dataset.run);
    });
    addMsg('What do you want to handle first?', 'agent');
  </script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        parsed = urlparse(self.path)
        if parsed.path == "/":
            body = INDEX_HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/run":
            run_id = parse_qs(parsed.query).get("id", [""])[0]
            with STATE_LOCK:
                record = RUNS.get(run_id)
            if not record:
                self.send_json({"error": "Run not found"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json(record)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802 - stdlib API
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_REQUEST_BYTES:
                self.send_json({"error": "Request too large"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
            return

        if self.path == "/api/chat":
            self.send_json(classify(payload.get("message", "")))
            return
        if self.path == "/api/run":
            action_id = payload.get("action_id")
            with STATE_LOCK:
                action = PENDING_ACTIONS.get(action_id)
            if not action:
                self.send_json({"error": "Invalid action"}, HTTPStatus.BAD_REQUEST)
                return
            self.send_json({"run_id": run_action(action)})
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    port = int(os.environ.get("AGENT_PORT", "8787"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"Personal Workflow Agent running at {url}")
    if os.environ.get("AGENT_NO_BROWSER") != "1":
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAgent stopped.")


if __name__ == "__main__":
    main()
