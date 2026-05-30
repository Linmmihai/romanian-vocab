#!/bin/zsh
cd "$(dirname "$0")"

PORT=4174
URL="http://127.0.0.1:${PORT}/english.html"

if ! lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  python3 -m http.server "${PORT}" >/tmp/english-phrase-trainer.log 2>&1 &
  sleep 1
fi

open "${URL}"
