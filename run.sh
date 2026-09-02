#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  exec "$ROOT/.venv/bin/python" app.py
fi

SITE="$(find "$ROOT/.pydeps" -type d -name "dist-packages" -o -type d -name "site-packages" 2>/dev/null | head -n 1 || true)"
if [[ -n "${SITE}" ]]; then
  export PYTHONPATH="${SITE}${PYTHONPATH:+:$PYTHONPATH}"
fi

exec python3 app.py
