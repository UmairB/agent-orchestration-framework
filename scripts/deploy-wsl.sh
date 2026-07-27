#!/usr/bin/env bash
# scripts/deploy-wsl.sh — push this working tree into the WSL worker node's own clone.
#
# Invoked by `node scripts/install-local.mjs --wsl` (which computes the /mnt/… path and
# picks the distro); runnable by hand for a fast src-only iteration:
#
#   wsl -d Ubuntu-22.04 -- bash /mnt/c/Source/umair/aof/scripts/deploy-wsl.sh \
#       /mnt/c/Source/umair/aof ~/source/aof .aof-wsl-deploy
#
# WHY THE DISTRO NEEDS A SEPARATE TREE AT ALL (it is not duplication for its own sake):
#   - node-pty ships prebuilds for darwin-{arm64,x64} and win32-{arm64,x64} ONLY. There
#     is no linux-x64 prebuild, so the distro must COMPILE it against its own Node —
#     the Windows repo's node_modules holds a win32 binary the distro cannot load.
#   - Node resolves symlinks BEFORE resolving node_modules, so symlinking the distro's
#     src/ at the Windows src/ would make `import "ws"` resolve from the WINDOWS tree's
#     node_modules and fail. Copying is what keeps resolution on the native tree.
#
# It carries UNCOMMITTED work, which is the whole point of a local test node and the one
# thing the Mac worker's `git pull` flow cannot do.
#
# $1 = this repo, as a distro-visible path (/mnt/c/…)   $2 = distro-side repo dir
# $3 = the deploy-stamp filename (holds the sha256 of the lockfile last installed from)
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# nvm defines `node`/`npm` as shell FUNCTIONS from ~/.bashrc, which a non-login shell
# never sources — source it explicitly or this runs with no Node at all. nvm is not
# `set -u` clean, so -u stays off across the source.
set +u
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
set -u

SRC="$1"
# Expand a leading ~ without eval (the argument is an operator-supplied path).
DST="$2"
case "$DST" in
  "~/"*) DST="$HOME/$(printf '%s' "$DST" | cut -c3-)" ;;
  "~")   DST="$HOME" ;;
esac
STAMP="$DST/$3"

[ -d "$SRC/src" ] || { echo "no src/ at $SRC (path translation failed?)" >&2; exit 1; }
[ -d "$DST/.git" ] || { echo "no aof clone at $DST — provision the distro first" >&2; exit 1; }

# 1. the source tree. src/bundle rides inside src/, so this covers the asset sidecars.
#    node_modules is NEVER copied — it is the Windows tree.
rm -rf "$DST/src"
cp -r "$SRC/src" "$DST/src"
cp "$SRC/package.json" "$DST/package.json"
echo "  synced src/ ($(find "$DST/src" -name '*.mjs' | wc -l) modules)"

# The WORKSPACE config travels too. It is machine-neutral (no paths), and it carries
# `mesh.workspaceId` — the DURABLE CROSS-MACHINE workspace anchor. Without it both ends
# fall back to the path derivation (sha256 of the project root), which necessarily
# diverges between C:\Source\umair\aof and ~/source/aof; the control then refuses every
# streamed frame as `unknown-workspace` and DISCARDS 100% of the worker's rows. That is
# not hypothetical — it is the failure workspace-identity.mjs's own header records
# ("silently discarded 100% of its frames for days"), and it was live on this mesh.
if [ -f "$SRC/.aof/aof.config.json" ]; then
  mkdir -p "$DST/.aof"
  cp "$SRC/.aof/aof.config.json" "$DST/.aof/aof.config.json"
  echo "  synced .aof/aof.config.json (workspaceId anchor)"
fi

# 2. dependency drift. A src-only sync is fast and almost always right, but a lockfile
#    change needs a native reinstall + node-pty rebuild — skipping that silently leaves
#    a stale native binary that fails at daemon start, far from its cause.
LOCK="$SRC/package-lock.json"
HASH="$(sha256sum "$LOCK" 2>/dev/null | cut -d' ' -f1)"
PREV="$(cat "$STAMP" 2>/dev/null || echo none)"
PTY="$DST/node_modules/node-pty/build/Release/pty.node"
if [ "$HASH" != "$PREV" ] || [ ! -f "$PTY" ]; then
  echo "  lockfile changed (or node-pty absent) — reinstalling natively"
  cd "$DST" || exit 1
  # --workspaces=false: the worker needs the ROOT runtime closure only; the ui workspace
  # is build-time frontend tooling a worker never uses (~200 MB avoided).
  npm ci --omit=dev --workspaces=false 2>&1 | tail -3
  if [ ! -f "$PTY" ]; then
    echo "  building node-pty from source (no linux-x64 prebuild ships)"
    ( cd node_modules/node-pty && npx --yes node-gyp rebuild 2>&1 | tail -3 )
  fi
  [ -f "$PTY" ] || { echo "  node-pty did not build — the worker cannot run PTY sessions" >&2; exit 1; }
  printf '%s' "$HASH" > "$STAMP"
else
  echo "  lockfile unchanged — native install kept"
fi

# 3. report what the distro ACTUALLY runs now, read from the distro itself.
cd "$DST" || exit 1
echo "  node-pty : $(node -e "require('node-pty'); process.stdout.write('loads OK')" 2>&1 | tail -1)"
echo "  aof      : $(command -v aof || echo "NOT LINKED — run 'npm link' in $DST")"
echo "  version  : $(aof --version 2>&1 | head -1)"
echo
echo "  NOTE: a running worker daemon keeps its in-memory module graph — restart it to pick this up."
