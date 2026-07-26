# aof work stream — roadmap (deferred / future work)

Consciously-deferred work for the aof work stream: things punted with a reason, recorded so the
rationale and the intended approach aren't lost. Not ACD record docs — this is a backlog, not a
contract. Promote an item into a milestone/story (via `aof:add-milestone` / `aof:add-story`) when it's
time to build it.

---

## 1. Open in terminal — attach to a running agent session (shared PTY)

**Status:** deferred (2026-06-20). **Origin:** milestone 03 (Work Board UI), operator request.

**Want.** Continue a *running* web-terminal session in the host terminal (e.g. Windows Terminal) —
**without re-running it**: two windows (browser + native terminal) on the *same* live agent.

**Why it's not trivial (the constraint).** When Run agent starts a session, the board server
(`node-pty`) opens a pseudo-terminal (PTY) and spawns the agent (`claude`) as its child. The pid we
persist in `.aof/terminal-sessions.json` is that **agent process** — real, but its PTY *master* is held
by the Node server and piped over the WebSocket to the browser xterm. There is no native terminal
attached, and Windows has no supported way to re-attach a *different* terminal to a *running* process's
PTY (no `reptyr` / `screen -x`). So you cannot "grab" the session by pid; a fresh `wt.exe`/`cd … && claude`
is a *re-run*, which is explicitly not wanted.

**Approach (the real fix — multiplex the one PTY to N clients, like `tmux`/`ttyd`).**
- **Server:** keep an in-memory **live-session map** keyed by a session id (alongside the `.aof`
  registry). A `/ws/terminal` connection can either **spawn** (today's behaviour) or **attach** to an
  existing session — the server **broadcasts** PTY output to every attached client and accepts input
  from any. Last-client-leaves policy: keep the PTY alive (it's still the running agent); only an
  explicit kill ends it.
- **CLI:** `aof terminal attach <ref|id>` — resolve the session via the `.aof` registry, open the
  attach socket, put the host terminal into raw mode, and bridge `process.stdin`/`stdout` ⇄ the session.
  Run it in Windows Terminal → the same running agent, no re-run.
- **Contract:** an ADR for the attach protocol (spawn-vs-attach on the WS; the broadcast/fan-in; the
  session id). The existing wire envelope (ADR-003) likely extends additively (an `attach` query +
  the session id); confirm it stays within the frozen frame shapes.
- **Tests:** two clients attached to one stubbed PTY both receive output + can send input; attach to an
  unknown id degrades honestly; the PTY survives a client disconnect.

**Foundation already in place:** `.aof/terminal-sessions.json` (pid · ref · provider · cwd · startedAt,
self-pruning) is the lookup `aof terminal attach` needs. See ARCHITECTURE ADR-003 (terminal transport)
and STATE (2026-06-20 terminal-lifecycle notes).

---

## 2. Multiple concurrent terminal sessions (tabbed dock)

**Status:** deferred (2026-06-20). **Origin:** milestone 03, operator question ("run Verify on another
task while one is already running?").

**Current (interim) behaviour:** the dock is **one session at a time**. Re-selecting the running item
shows **View terminal** (no-op re-reveal); launching on a *different* item **silently replaces** the
session — the old WebSocket closes, the server kills the old PTY (and unregisters it from `.aof`), and a
fresh session spawns. A mid-run `/aof:verify` on the old item is interrupted. Acceptable only if the
dock is treated as a single scratch terminal.

**Want.** Run several agents at once — e.g. verify 03/01 while 03/02 continues — without one killing the
other.

**Approach.** A **session per item**, surfaced as **tabs** (or a session list) in the dock: keep N live
PTYs in the server's live-session map (the same map item 1 introduces), each keyed by id; the dock
renders a tab strip (ref + connection-state dot) and mounts the selected session's xterm. Launching on a
busy item opens/*focuses* its tab instead of replacing. Ties directly to item 1 (shared live-session
registry + the `.aof` records); decide them together. Until then, consider the cheap interim guard
(confirm-before-replace or disable-while-busy) if the silent replace bites.

---

## Other deferred items (backlog)

- **`aof mesh logs --follow`** — a live tail mode on the log reader (m42 descoped it by decision:
  polling `--tail` covers the operator need; follow is a CLI nicety, not debt). (Milestone 42.)

- **Daemons self-restart on a new build stamp** — the m42 item-1 optional leg: daemons poll the
  installed `BUILD_ID.json` and exit cleanly on change so the desktop supervisor respawns them —
  `install-local` becomes the whole deploy, no manual restart. Deferred: the supervisor's respawn
  semantics need verifying first. (Milestone 42.)

- **Re-enable codex / gemini providers.** The dock picker is claude-only for now (operator request);
  the provider seam (`terminal-providers.mjs` / `provider-picker.mjs` / server) still supports all three
  — re-enabling is widening `VISIBLE_PROVIDERS` in `TerminalDock.tsx`. (Milestone 03.)

- **Extend the `work list --json` contract for board fidelity (finding F-2).** A *superseding* ADR-002
  to carry the data the card/lanes design wants but the frozen 7-field contract doesn't: per-milestone
  **task roll-up counts**, the gate **`depends`/`waitingOn`**, and the **findings count**. Architect's
  lane; then the board renders them instead of omitting/softening. Subsumes **DG-1** (the Findings-tab
  count is static `0/none` until the milestone `VERIFICATION.md` `## Findings` is parsed).

- **DG-3 — `Next` vs `Validate` emphasis.** Minor design-conformance: the action strip's `Next` shares
  `Validate`'s variant; pick the canonical treatment so doc and build agree. (`aof-designer`.)

- **Pixel-exact design conformance.** The future automated track noted at `aof:verify`: render each
  surface with Playwright and assert `toHaveScreenshot` against an approved render (vs today's
  designer-judgment-against-the-mock lane).
