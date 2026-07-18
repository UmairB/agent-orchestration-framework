#!/bin/sh
# Run this on the Mac (umairs-mac-mini). Gathers the facts needed to confirm (or
# refute) whether the control node's global_workspace_descriptors.clone_url
# (ADR-010 Gap A extended) is visible on the worker's OWN local database, writes
# them to one file, and sends that file to the control node (umairs-msi) over
# tailscale (`tailscale file cp`). Written during the milestone-38 live soak
# (2026-07-18) after the first cross-machine-registry-sync fix failed against
# the real worker and the operator asked for direct evidence rather than a
# second unverified guess.
set -u

OUT="$HOME/aof-diag-$(date +%s).txt"
WS="1f164bd03ea535da"
DB="$HOME/.aof/mesh/work/projection.sqlite"

{
  echo "=== date ==="
  date -u
  echo
  echo "=== aof version on PATH ==="
  which aof
  aof --version 2>&1
  echo
  echo "=== global_workspace_descriptors: this specific workspace ==="
  if [ -f "$DB" ]; then
    sqlite3 "$DB" "SELECT workspace_id, project_root, clone_url, published_at FROM global_workspace_descriptors WHERE workspace_id='$WS';"
  else
    echo "NO DATABASE FILE AT $DB"
  fi
  echo
  echo "=== global_workspace_descriptors: ALL rows (workspace_id + clone_url only) ==="
  if [ -f "$DB" ]; then
    sqlite3 "$DB" "SELECT workspace_id, clone_url FROM global_workspace_descriptors;"
  fi
  echo
  echo "=== schema version ==="
  if [ -f "$DB" ]; then
    sqlite3 "$DB" "SELECT * FROM aof_schema;"
  fi
  echo
  echo "=== does clone_url column even exist on this machine's table? ==="
  if [ -f "$DB" ]; then
    sqlite3 "$DB" "PRAGMA table_info(global_workspace_descriptors);"
  fi
  echo
  echo "=== node record for the control node (umairs-msi) ==="
  cat "$HOME/.aof/mesh/nodes/umairs-msi.json" 2>&1
  echo
  echo "=== last 40 lines of the most recent mesh-serve log (stderr) ==="
  LATEST_ERR=$(ls -t "$HOME"/.aof/mesh/logs/mesh-serve.*.log.err 2>/dev/null | head -1)
  if [ -n "${LATEST_ERR:-}" ]; then
    echo "(from: $LATEST_ERR)"
    tail -40 "$LATEST_ERR"
  else
    echo "no mesh-serve log.err found under ~/.aof/mesh/logs/"
  fi
} > "$OUT" 2>&1

echo "Wrote $OUT"
tailscale file cp "$OUT" umairs-msi:
echo "Sent to umairs-msi via tailscale file cp."
