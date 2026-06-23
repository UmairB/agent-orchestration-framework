#!/usr/bin/env bash
# run.sh — reproduce the milestone-10 all-local-within-Claude spike.
# Run from this directory (Git Bash on Windows). Requires: claude CLI authed, uv.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"

# 1. Install the pinned graphify + the anthropic SDK extra (the --backend claude path needs it).
uv tool install graphifyy --with anthropic

# --- PATH A: shim-fronted --backend claude (proves the ANTHROPIC_BASE_URL shim contract) ---
PORT=8787
node claude-shim.mjs --port "$PORT" &
SHIM=$!
sleep 2
ANTHROPIC_API_KEY="dummy-local" \
ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" \
ANTHROPIC_MODEL="claude-sonnet-4-6" \
  graphify extract ./fixture --backend claude --out .
kill "$SHIM" 2>/dev/null || true
echo "shim run -> graphify-out/graph.json ; evidence in requests.log + last-extraction-prompt.txt"

# --- PATH B: native built-in claude-cli backend (NO shim, NO key, NO base URL) ---
# graphify 0.8.44 ships a `claude-cli` backend that shells to `claude -p` itself.
GRAPHIFY_CLAUDE_CLI_MODEL=claude-sonnet-4-6 \
  graphify extract ./fixture --backend claude-cli --out ./native-run
echo "native run -> native-run/graphify-out/graph.json (est. cost \$0.0000)"
