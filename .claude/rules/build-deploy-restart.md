# Build, deploy & restart (this machine = Windows control node)

`aof.exe` is a **payload-first launcher** (TECH_DEBT item 1, shipped 2026-07-26): it loads the CLI
from `~/.aof/bin/src/cli.mjs` when present and only falls back to its embedded bundle
(`AOF_SEA_EMBEDDED=1`, or a release single-file install). The program is the payload, not the binary.

## The deploy loop (any `src/` or `ui/` change)

```
node scripts/install-local.mjs        # payload file-copy — NO SEA build (~seconds)
# then restart the desktop app (see below)
```

- `--skip-ui` when `ui/` didn't change.
- `--sea` ONLY when `scripts/sea-entry.mjs` (the launcher bootstrap) changed or for a release
  artefact — this is the 88 MB SEA rebuild; it is never needed for ordinary `src/` changes.
- `--desktop` ONLY when the Rust app (`app/desktop/`) changed (cargo build, Windows only).
- The installer stamps `BUILD_ID.json`, prunes `.bak` binaries to the newest 3, and tolerates a
  locked `node-pty` under a running daemon (skip-with-warning; stop the daemon to update it).

## Restart = restart the desktop app

`aof-mesh-desktop.exe` supervises both daemons — `aof.exe mesh serve --serve` and `aof.exe mesh ui`
run as its children and die with it. Do not start daemons by hand from an agent shell; relaunch the
supervisor and let it spawn them in its own environment (a hand-spawned daemon inherits the wrong
cwd/env — workspace identity is still partly cwd-derived, TECH_DEBT item 4):

```powershell
Stop-Process -Name aof-mesh-desktop -Force        # daemons die with the supervisor
Start-Process "$env:USERPROFILE\.aof\bin\aof-mesh-desktop.exe" -WorkingDirectory "$env:USERPROFILE\.aof\bin"
```

Agents: only do this when the operator explicitly asks for a restart; otherwise install and hand
back ("restart to pick this up").

## Verify at the source — never assume the deploy landed

- `~/.aof/bin/aof.exe --version` → `0.1.0 (payload <buildId>)`. `embedded` or a stale buildId means
  the payload didn't land or the launcher fell back.
- Both daemons print a `Build: payload <buildId>` line at startup.
- Fleet is `http://127.0.0.1:4181/?mode=fleet` (fixed port); the control stream/serve is `:4182`.
  The board is a separate per-workspace server on an EPHEMERAL port — never hand out a board port.

## The Mac worker (umairs-mac-mini)

`aof` there is an npm symlink into `~/Source/personal/agent-orchestration-framework` — deploy is
`git pull` + the operator restarting the worker daemon. Never start/restart it over SSH (an
SSH-spawned daemon has no login session → unauthenticated `claude`, burned runs). Reading state over
SSH is fine.

## Tests (hook-enforced, but know why)

Never run aof tests without `AOF_GLOBAL_HOME=$(mktemp -d)` — unisolated runs write fixtures into the
real `~/.aof` (config AND mesh stores) and pollute the live soak. Never run the full suite on this
machine — `global-work-propagation.test.mjs` binds `:4182`, which the live control daemon holds; run
focused suites via test-array imports instead.
