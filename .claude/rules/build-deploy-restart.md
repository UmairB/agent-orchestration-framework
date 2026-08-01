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
- `--wsl` to ALSO push the tree to the WSL worker node (below).
- The installer stamps `BUILD_ID.json`, prunes `.bak` binaries to the newest 3, and tolerates a
  locked `node-pty` under a running daemon (skip-with-warning; stop the daemon to update it).

## Restart = restart the desktop app

`aof-mesh-desktop.exe` supervises both daemons — `aof.exe mesh serve --serve` and `aof.exe mesh ui`
run as its children and die with it. Do not start daemons by hand from an agent shell; relaunch the
supervisor and let it spawn them in its own environment (a hand-spawned daemon inherits the wrong
cwd/env — workspace identity is still partly cwd-derived, TECH_DEBT item 4).

The restart flow (operator, 2026-07-27): QUIT the desktop app (its own UI — a graceful exit, never
`Stop-Process -Force`), then relaunch through the CLI verb:

```
aof mesh desktop run
```

Agents: only do this when the operator explicitly asks for a restart; otherwise install and hand
back ("restart to pick this up"). Never force-kill the process.

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

## The WSL worker node (the local second machine)

A WSL2 distro is a full mesh node — own kernel, IP, filesystem and aof identity — which makes it the
cheapest way to test cross-machine behaviour without the Mac. It runs `fabric: "direct"` (no
overlay); the Windows control node is reachable from the guest on **every** IPv4 the host owns
(measured 2026-07-27: the WSL switch gateway, the LAN address, and even the Tailscale address, since
NAT routes to the host which owns it locally). No firewall rule is needed — the Hyper-V
`DefaultInboundAction = Block` governs traffic INTO the WSL VM, not the host↔guest NAT path.

Deploy (from the Windows repo):

```
node scripts/install-local.mjs --wsl --skip-ui     # ~5s on the incremental path
```

- The distro keeps its **own clone** (`~/source/aof`, `npm link`ed, `origin` = this repo) — it can
  neither run the Windows payload nor share this tree. Two hard reasons, both measured:
  **(a)** node-pty ships prebuilds for `darwin-*`/`win32-*` only — no `linux-x64` — so the distro
  must compile it; this repo's `node_modules` holds a win32 binary Linux cannot load. **(b)** Node
  resolves symlinks *before* `node_modules`, so symlinking the distro's `src/` at this one would make
  `import "ws"` resolve from the win32 tree and fail. The copy is what keeps resolution native.
- It carries **uncommitted** work — the point of a local test node, and the one thing the Mac's
  `git pull` flow cannot do. (`git fetch origin` inside `~/source/aof` pulls committed state instead.)
- `scripts/deploy-wsl.sh` is the distro-side half, and is runnable by hand. It reinstalls natively
  ONLY when `package-lock.json`'s sha changes (stamped in `.aof-wsl-deploy`) — a src-only sync after
  a dependency bump would otherwise leave a stale native binary that fails at daemon start, far from
  its cause.
- `--wsl <distro>` targets a named distro; `--wsl-dir` overrides `~/source/aof`.
- A restart is still required — modules load once at daemon start.

### The distro is deliberately SELF-CONTAINED (`/etc/wsl.conf`, 2026-07-27)

WSL appends the entire Windows PATH into every Linux shell by default, which dragged
`C:\Program Files\nodejs` (Windows node + npm, plus a stray `aof` shim from a host `npm link`) and
`AppData\Roaming\nvm` (**nvm-windows**) ahead of the Linux toolchain. Symptoms it caused: a bare
`npm ci` in the distro ran *Windows* npm against the Linux tree and failed with a bogus
`Invalid: lock file's @aof/ui@0.1.0 does not satisfy @aof/ui@`; and `nvm use 22` executed
nvm-**windows**, silently leaving `node` unresolvable. `/etc/wsl.conf` now pins:

```ini
[boot]
systemd=true                  # PRE-EXISTING — Docker Desktop integration + any systemd unit
[interop]
enabled = true
appendWindowsPath = false     # the fix — /mnt/c stays mounted, exes callable by full path
[network]
hostname = aof-wsl            # a guest otherwise INHERITS the Windows hostname
[user]
default = umair
```

plus `/usr/local/bin/{node,npm,npx,aof,claude}` symlinked, so the toolchain wins in **every** shell
type — including the non-login, non-interactive environment a worker daemon gets, which otherwise
has no Linux Node and no `claude` at all (the same class as the Mac's SSH/no-login-session failure
that burned runs). `claude` installs to `~/.local/bin` and is put on PATH only by `~/.bashrc`, which
Ubuntu's own rc early-returns out of for non-interactive shells — so it MUST be linked too:

```bash
wsl -d Ubuntu-22.04 -u root -- ln -sfn /home/umair/.local/bin/claude /usr/local/bin/claude
```

Re-run the node/npm/npx/aof links after a Node version bump; they pin a version dir. (The `claude`
link points at `~/.local/bin/claude`, itself a symlink into the installer's share dir, so Claude
Code self-updates are followed automatically.)

**Verify auth, not just resolution.** A resolvable-but-unauthenticated `claude` is exactly what
burned the Mac's runs: the binary is found, the run starts, then dies on auth. Probe the DAEMON's
environment, not your terminal's:

```bash
wsl -d Ubuntu-22.04 -- bash -c 'env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=$HOME \
  bash -c "claude -p \"Reply with exactly: MESH_AUTH_OK\""'
```

Apply changes with `wsl --terminate Ubuntu-22.04` — **not** `wsl --shutdown`, which also kills the
`docker-desktop` distro.

Gotchas that bite:

- `wsl.exe` **re-serialises its argument vector**, so a multi-line script passed as one argv element
  arrives mangled (it gets echoed rather than executed). Invoke a script FILE by its `/mnt/…` path —
  that is why `deploy-wsl.sh` exists.
- `wsl -u root` runs as root with no password — the way to edit `/etc/wsl.conf` when the default
  user has no passwordless sudo (this one does not). `sudo` from a non-interactive shell just hangs
  on the password prompt.
- nvm defines `node`/`npm` as shell functions in `~/.bashrc`, which Ubuntu's own rc early-returns
  out of for non-interactive shells — hence the `/usr/local/bin` links above. nvm is also not
  `set -u` clean.
- The guest hostname collision is ALSO handled at the aof layer, and both belt and braces are
  wanted: register with `aof mesh identity --name aof-wsl --address <guest-ip>`, pinned in the
  identity sidecar so the load-time self-heal never churns it back.
- The guest's NAT IP changes when the distro restarts. That does **not** break the stream —
  admission is by enrollment credential, not remote address. It only affects roster display.

## Tests (hook-enforced, but know why)

Never run aof tests without `AOF_GLOBAL_HOME=$(mktemp -d)` — unisolated runs write fixtures into the
real `~/.aof` (config AND mesh stores) and pollute the live soak. Never run the full suite on this
machine — `global-work-propagation.test.mjs` binds `:4182`, which the live control daemon holds; run
focused suites via test-array imports instead.
