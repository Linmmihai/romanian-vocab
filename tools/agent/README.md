# Personal Workflow Agent

This is a first local version of the plain-language agent.

It gives you a browser page where you can ask for tasks like:

- `check subtitles`
- `fix subtitle format`
- `search subtitle text`
- `show project files`
- `check deployment setup`
- `what tools can you use?`

The current version integrates the tools already available in this workspace:

- SRT subtitle quality checks
- SRT safe-format fixing
- video/audio subtitle comparison
- subtitle text search
- project file overview with media folders summarized by count
- Git status inspection
- Netlify state inspection

## Start

Double-click:

```text
start_agent.command
```

Or run:

```bash
python3 tools/agent/app.py
```

Then open:

```text
http://127.0.0.1:8787
```

## Design

The agent has three parts:

1. Browser UI for plain-language requests.
2. Router that recognizes the requested workflow.
3. Tool actions that run approved local scripts and summarize the result.

Actions that may create or change files require confirmation in the browser.

Each run stores a small audit record in `agent/runs/`, including `record.json`
and `output.txt`. The generated run contents are ignored by Git.

## Next Integrations

Good next additions:

- Gmail: search, summarize, and draft replies.
- GitHub: summarize issues and pull requests.
- Vercel/Netlify: deploy checks and preview links.
- Documents and spreadsheets: generate reports from data.
- Reminders: follow-up prompts.

Those integrations need either app connector access from Codex or separate API credentials if this standalone local agent should call them directly.
