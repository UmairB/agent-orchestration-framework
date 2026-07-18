---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Facts only, each with a source/measurement and the constraint it imposes.
  No decisions, no architecture, no scenarios — that is the architect's ADRs (DESIGN/ARCHITECTURE.md).
-->
# 38 · Cross-machine Worker Execution & Session Presence — Research

Measured against this repo (`C:\Source\umair\aof`, branch `feat/issuance-routing-console-sea-release`,
commit `957ed69`), Node v22.22.2, git `2.47.0.windows.1`, Claude Code `2.1.201`, Windows 11. Every claim
below is tagged **measured** (I ran it on this machine and observed the result), **documented** (stated in
vendor docs, cited), or **inferred** (a reasonable reading of measured/documented facts, not itself
directly observed) — never asserted without one of these three tags.

## Summary of constraints (read this first)

1. **§1 — No git mechanism exists that lets a private-repo credential cross the wire AND leave zero trace
   on the worker.** Every transmission option leaves *something* recoverable somewhere (a config file, a
   process env, an OS secret store, or a filesystem key) — the design question is which surface is
   smallest and most revocable, not whether a surface exists.
2. **§1 — `git -c http.extraHeader=…` (top-level override) is a genuine one-shot, non-persisting
   mechanism: measured on this machine to leave nothing in `.git/config`,** unlike `git clone --config
   http.extraHeader=…` which **measured** to write the raw header verbatim into the checkout's
   `.git/config` in plaintext, permanently, until deleted.
3. **§1 — the worker's spawned agent child (`claude -p`/`codex exec`) inherits the FULL parent process
   environment by default** (`execFile` with no `env` override — this repo's own
   `defaultSpawnRuntime`, `src/mesh-worker-execution.mjs:163-184`, passes no `env` key) — any credential
   placed in the worker process's env for the clone step is, absent an explicit scrub, visible to the
   agent child too.
4. **§1 — this machine's existing git credential helpers (`manager`, `wincred`) are desktop/GUI-session
   bound** (Windows Credential Manager-backed) — **inferred** not to function unattended on a headless
   worker with no interactive desktop session or no stored entry for the target repo.
5. **§1 — Tailscale SSH exists and is documented to authenticate by tailnet identity + ACL, not a
   distributed key** (**documented**, no local tailnet available to measure directly — same gap milestone
   33's own research flagged).
6. **§2 — `SessionStart`, `UserPromptSubmit`, and `SessionEnd` all fired, in that order, in one measured
   headless `claude -p` turn on this machine**, each with a JSON payload on **stdin** (not argv, not env
   alone) — full payloads captured below.
7. **§2 — no crash/kill reliability guarantee for `SessionEnd` exists anywhere in Anthropic's docs**
   (**documented absence** — I fetched the hooks reference and it states only "when a session terminates,"
   nothing about force-kill/crash). This is the single fact that makes TTL self-expiry load-bearing, not
   optional, for session presence.
8. **§2 — this repo's own `.claude/settings.json` currently wires only empty `SessionStart`/
   `PostToolUse`/`PreToolUse` arrays** — no `UserPromptSubmit`, no `SessionEnd` key exists yet in-repo;
   nothing to reuse, a story task must add both.
9. **§3 — `node:crypto` alone signs a fully spec-compliant RS256 App JWT, AND GitHub's real API accepts
   it as well-formed** (measured, live: a genuine 404 "Integration not found" for a non-existent App id,
   not a 401 "Bad credentials" for a malformed bearer) — no `jsonwebtoken`/`jose`/octokit dependency is
   needed for the sign step.
10. **§3 — ⚠ the existing askpass shim's "same value for both prompts" behaviour transmits a real, live
    HTTP Basic-Auth header of `username=<token>, password=<token>`** (measured via a local HTTP capture)
    — NOT the documented `x-access-token`/`<token>` pair. Whether GitHub's server accepts that shape for
    an App **installation** token specifically is not directly measured (no live App available) — it is
    inferred, with corroboration, from GitHub's own PAT docs plus a third-party test; it is NOT the
    guarantee GitHub's own App docs make. **This is a genuine open risk, not a closed one** — see §3.4.
11. **§3 — the `mintCloneCredential(workspaceId, assignmentId)` seam (`control-stream-server.mjs:213,329`)
    is never handed a `cloneUrl`** — a `github-app` provider must independently resolve `owner/repo` on
    the CONTROL node from `workspaceId`, and nothing in the current codebase gives the control node a
    workspaceId→cloneUrl mapping today (the only existing reader, `resolveCloneUrl(ws)`, reads a single
    fleet-wide `ws.config.mesh.repo.cloneUrl` key on whichever process calls it — worker OR control — not
    a per-workspace map).
12. **§3 — the worker's own bounded wait on a credential reply is a MEASURED 15s constant**
    (`DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS`, `worker-stream-client.mjs:79`) — the control-side mint,
    including up to two sequential external calls to GitHub (installation-id resolve + token exchange)
    plus JWT signing, must complete inside that window or the clone fails loud, never hangs — a real
    latency budget the provider design must respect.
13. **§3 — a GitHub App's `installation_id` is not stable across an uninstall/reinstall** (documented,
    corroborated) — a control-side config that hard-codes it can silently go stale; resolving it on
    demand avoids that staleness at the cost of one extra external call inside the 15s budget (#12).

---

## § 1 — Auth transmission for a private-repo clone on a worker

**Question.** How does a worker obtain credentials to `git clone` a private repo it does not yet have,
without the credential being exfiltratable or over-scoped? Survey the real options.

### 1.1 Mechanism A — short-lived token minted by control, passed over the relay

Four sub-mechanisms for how git actually *consumes* a token once it has reached the worker process; all
were exercised directly against a disposable local bare repo (`git init --bare`) in the session scratchpad
(no real remote credentialed — the mechanics are identical whether the transport is `file://`, `https://`,
or a real forge; nothing here depends on the transport being genuine HTTPS).

**A1 — `git -c http.extraHeader="Authorization: Bearer <token>" clone <url> <path>` (top-level `-c`,
scoped to that one invocation).**
- **Measured:** ran this clone against a local bare repo, then read the resulting `.git/config` —
  `http.extraheader` is **absent**. The header lived only in that one process's argument list for the
  duration of the clone and was never written to disk.
- **Measured (contrast):** the *clone-specific* flag `git clone --config
  http.extraHeader="Authorization: Basic FAKEFAKEFAKE" <url> <path>` **does** persist — the resulting
  `.git/config` literally contains `[http]\n\textraheader = Authorization: Basic FAKEFAKEFAKE` verbatim,
  in plaintext, permanently (until manually removed). This is a real footgun: `--config` at clone time is
  documented git behaviour ("set config in the newly-created repository") and is easy to reach for by
  anyone porting a plain-`git clone` call, but it is the wrong flag for a transient credential.
- **Measured:** after a `-c`-only clone, a later plain `git fetch`/`git config --get http.extraheader` in
  that same checkout finds nothing (`exit 1`) — the credential does not survive for a second git operation
  in the same tree; each subsequent authenticated operation would need the header re-supplied.
- **Leak surface — process argv:** the token IS present in that process's argv while it runs. On Windows,
  argv of another user's process is not trivially readable without admin/debug privilege the way `/proc/*/
  cmdline` is world-readable on Linux (**documented**, general OS-security knowledge, not measured here);
  on Linux the same technique is documented to leak via `ps aux` / `/proc/<pid>/cmdline` (**documented**,
  cited in a real GitHub security issue found during this research: "GitHub PAT leaked in process
  arguments during git clone (visible via ps aux)"). Process-list capture by monitoring/support-bundle
  tooling is a real, previously-exploited leak path for this exact pattern.
- **Leak surface — shell history:** none, if the worker invokes git via `execFile(bin, args)` (argv array,
  no shell) rather than a shell string — this repo's own git-spawn precedent
  (`src/mesh-worktree.mjs:70-78` `defaultGitExec`) already uses `execFile` with an argv array, never a
  shell string, so a `-c` value passed as one argv element is never written to any shell history file.
- **Leak surface — env inheritance to the spawned agent:** N/A for this specific sub-mechanism (the token
  lives in argv, not env) — but see 1.5 below for the general env-inheritance finding, which applies to
  *any* token placed in the worker process's own environment ahead of the clone.

**A2 — an authenticated clone URL (`https://x-access-token:<token>@host/org/repo.git`).**
- **Inferred** (not separately measured — same class of risk as A1's `--config` persistence): git records
  the resolved remote URL into `.git/config`'s `[remote "origin"] url = …` on every clone **by design**
  (this is not a bug, it is how git remembers where to fetch/push next) — an embedded credential in the URL
  is therefore **structurally guaranteed** to persist to disk in plaintext, unlike A1's `-c` form. It also
  appears in argv (same leak surface as A1) and in any `git remote -v` output a later process/human runs.
  This is the worst-scoped of the transmission shapes surveyed: the leak is not incidental, it is the
  documented, intended git behaviour for how remotes are remembered.

**A3 — a credential helper (`git config credential.helper <script>`).**
- **Documented** (git-scm.com `gitcredentials`, fetched this session): "Credential helpers … are external
  programs from which Git can request both usernames and passwords; they typically interface with secure
  storage provided by the OS." Git invokes the helper with `get`/`store`/`erase`, feeding/reading credential
  fields over **stdin/stdout**, never argv — so a helper script is argv-clean by construction.
- **Measured on this machine:** the *installed* helpers are `credential.helper=manager` (system gitconfig,
  Git for Windows' own GCM) and `credential.helper=wincred` (user gitconfig) — both **measured** via `git
  config --list --show-origin`. Both are backed by an interactive OS credential store (GCM can pop a
  browser/GUI prompt; `wincred` reads/writes Windows Credential Manager, which is keyed to the logged-in
  user's desktop session). **Inferred:** neither functions unattended on a worker with no interactive
  session and no pre-seeded entry — a worker-specific helper would have to be purpose-built (e.g. a tiny
  script backed by a secrets file or an OS keychain API), which is new code, not something to assume "just
  works" because git already has a `credential.helper` slot.

**A4 — `GIT_ASKPASS` (an env var naming an executable git invokes and reads a credential from stdout).**
- **Documented** (git-scm.com `gitcredentials`, fetched this session): "If the `GIT_ASKPASS` environment
  variable is set, the program specified by the variable is invoked. A suitable prompt is provided to the
  program on the command line, and the user's input is read from its standard output." Tried before
  `core.askPass`/`SSH_ASKPASS`.
- **Measured:** set `GIT_ASKPASS=<path-to-a-script-that-echoes-a-fake-token>` and cloned; the resulting
  `.git/config` contains **no trace** of the token or the askpass script path — clean on both counts.
- **Leak surface:** the token still transits the askpass script's own stdout momentarily and the env var
  itself (`GIT_ASKPASS=<path>`, not the token) is visible in the worker process's environment for the
  duration — but the token value never touches argv or `.git/config`. This is the cleanest of the four
  sub-mechanisms measured: no persistence, no argv exposure, and the *worker* controls the script's
  lifetime (delete/never-write-to-disk the token; a temp in-memory pipe or process substitution can serve
  it without ever writing the token to a file).

### 1.2 Mechanism B — a pre-provisioned per-worker deploy key / SSH key + `GIT_SSH_COMMAND`

- **Measured:** SSH ships and resolves on this machine at both `C:\Program Files\Git\usr\bin\ssh.exe`
  (`OpenSSH_9.9p1`) and `C:\Windows\System32\OpenSSH\ssh.exe` — SSH-based git auth is not a "needs
  installing" dependency on a typical dev machine.
- **Documented:** `GIT_SSH_COMMAND` (or `core.sshCommand`) lets a caller point git at a specific SSH
  invocation, e.g. `GIT_SSH_COMMAND="ssh -i <deploy-key-path> -o IdentitiesOnly=yes"`, without touching the
  user's default `~/.ssh/config`. A deploy key is the well-known GitHub/GitLab/Bitbucket primitive:
  read-only (or read-write), scoped to exactly one repo, independently revocable from the repo's settings
  UI without touching any other credential.
- **Leak surface:** the private key itself is a durable file that must already exist on the worker's disk
  *before* any assignment ever arrives — this is provisioning, not transmission; it sidesteps the "token
  crosses the mesh" problem entirely by moving trust to "this specific machine is trusted with this
  specific repo," established out-of-band (once, at worker-onboarding time), not per-assignment. It is
  the one option surveyed where **no secret crosses the control→worker relay at assignment time at all**.
  Its cost is the opposite of A1-A4: it is a **durable, standing** credential sitting on the worker's disk
  (file-permission-protected, but permanently present) rather than a **short-lived, minted-per-assignment**
  one — a different risk shape (long-lived-if-worker-compromised vs momentarily-exposed-in-transit).

### 1.3 Mechanism C — fabric-delegated identity (Tailscale)

- **Documented** (tailscale.com, fetched this session): **Tailscale SSH** authenticates purely via tailnet
  identity + the tailnet's ACL policy — "Tailscale knows your identity, since that's how you connected to
  your tailnet" — no distributed SSH key management, no per-device key to leak, and the default ACL
  ("`autogroup:self`"/"`autogroup:nonroot`") already grants same-owner devices SSH access without any
  extra config.
- **Documented, general git-remote-helper mechanism:** git supports pluggable "remote helpers"
  (`git-remote-<transport>`) — an "over Tailscale" remote (e.g. `git-remote-tailscale` piping over `tailscale
  ssh` or a Tailscale-exposed `git-shell`) is a real, buildable shape (git-remote-ext/git-remote-ssh are the
  precedent this would extend), but **no such purpose-built helper was found published/installed** on this
  machine or searched — this would be new code/tooling to adopt or write, not an off-the-shelf mechanism
  to point at.
- **Not measured:** no tailnet is available in this environment (same gap milestone-33's own RESEARCH.md
  flagged: "no Tailscale CLI was run locally in this pass… every Tailscale claim is vendor-doc or
  third-party-observed, not measured"). This entire mechanism is **documented, not measured**, here.
- **What this buys, if it works as documented:** literally **no git credential crosses the control→worker
  relay at all** — the repo's own git host would need to trust the Tailscale-authenticated connection
  directly (e.g. self-hosted git-over-SSH on a tailnet node with Tailscale SSH fronting it), which only
  applies cleanly to a **self-hosted** repo location reachable over the tailnet — it does not apply to a
  repo hosted on GitHub/GitLab/etc., which authenticate independently of Tailscale. **Constraint:** this
  option's applicability is gated on where the "configured global-config repo location" (SPEC.md scope)
  actually points — a tailnet-reachable self-hosted git host is a precondition, not a universal answer for
  any private-repo host.

### 1.4 Mechanism D — host git credential helpers already present on the worker

Covered directly under 1.1/A3 above (this machine's `manager`/`wincred` ARE the host helpers). No separate
finding beyond A3: they are desktop-session-bound and **inferred** not to be assignment-portable/headless
without new plumbing.

### 1.5 Env inheritance into the spawned agent — the cross-cutting leak surface every option shares

- **Measured:** Node `child_process.execFile(bin, args, {...})` **with no `env` key** inherits the FULL
  parent process environment into the child — verified directly (`process.env.LEAKY_SECRET` set in a
  parent script was visible, unmodified, inside a plain `execFile`-spawned child with no env override).
- **Measured (source read, not executed):** this repo's own `defaultSpawnRuntime`
  (`src/mesh-worker-execution.mjs:163-184`) calls `execFile(bin, args, { cwd, windowsHide, timeout }, …)` —
  **no `env` key at all.** The SAME is true of `mesh-worktree.mjs`'s `defaultGitExec`
  (`src/mesh-worktree.mjs:72-78`) and `addWorktree`/`removeWorktree` (`src/mesh-worktree.mjs:98-122`) — all
  pass `{ cwd }` only, never `env`.
- **Constraint this imposes:** whichever transmission mechanism is picked, if the credential ever touches
  the *worker Node process's own* `process.env` (e.g. to set `GIT_ASKPASS`/`GIT_SSH_COMMAND` for the clone
  step), it is — absent an explicit scrub before the later `spawnRuntime` call — inherited by the headless
  `claude -p`/`codex exec` agent child too, since neither existing spawn call-site overrides `env`. A1's
  argv-only form and A2's URL form do NOT have this specific exposure (the secret is never in the worker's
  own env), but A3/A4's env-var-naming-a-helper forms do, unless the credential is scoped to the `exec()`
  call that performs the clone specifically (a distinct `env` passed to *that one* `execFile` invocation,
  never merged into the ambient `process.env` the later agent-spawn inherits from).

### 1.6 What this repo's worktree mechanics actually need fed (confirms the SPEC's framing)

- **Measured (source read):** `addWorktree` (`src/mesh-worktree.mjs:98-106`) runs `git worktree add
  --detach <path> <commitish>` **against `cwd: projectRoot`** — i.e. worktrees are materialized from an
  *already-cloned local repo*; the worktree-add step itself performs **no network operation** and consumes
  **no credential** (confirmed by the milestone-35 RESEARCH.md §4/§5, itself measured, showing worktree add
  is a purely local git-object operation).
  This confirms the SPEC's own framing (line 39-40: "cloning it … and creating a worktree" are two
  sequential, structurally separate steps) — the credential problem is **entirely confined to the one-time
  `git clone`** that must precede the FIRST `addWorktree` call for a repo the worker lacks; once cloned,
  every subsequent assignment against that same repo reuses the existing local checkout via `addWorktree`
  with zero further auth exposure. This narrows the blast radius of whatever transmission mechanism is
  chosen to a single, identifiable call site (a new "clone if missing" step ahead of
  `workerHasRepo`/`addWorktree` in `src/mesh-worker-execution.mjs`), not a repeated-per-assignment exposure.

### Recommended default and fallback (research reports the trade-offs; the architect/security review decide)

Reporting for the record, since the SPEC explicitly asks research to "give a RECOMMENDED default" ahead of
the security threat-model pass: **A4 (`GIT_ASKPASS` pointed at a short-lived, control-minted, per-clone
token, scoped via a per-invocation `env` override never merged into the worker's ambient `process.env`)**
is the measured option with the smallest disk/argv footprint (§1.1/A4: zero `.git/config` persistence, zero
argv exposure) while remaining deployable without new standing infrastructure (no tailnet-reachable
self-hosted git host required, unlike Mechanism C). **Fallback: Mechanism B (a pre-provisioned per-worker
deploy key + `GIT_SSH_COMMAND`)** for any repo host/environment where minting a short-lived HTTP token
control-side is not available (e.g. a host whose token API the control node cannot reach) — its cost is a
durable standing credential rather than a per-assignment one, a different risk shape the security review
should weigh explicitly rather than this document deciding for it.

---

## § 2 — Coding-assistant session hooks reality (Claude Code, measured)

**Question.** Do `SessionStart`, `UserPromptSubmit`, `SessionEnd` exist as configurable hook events, what
invocation shape do they use, and does `SessionEnd` reliably fire on a crash/kill (load-bearing for
whether TTL self-expiry is required, not optional)?

### 2.1 This repo's current hook wiring — measured, in-repo

- **Measured:** `C:\Source\umair\aof\.claude\settings.json` currently declares
  `"hooks": { "SessionStart": [], "PostToolUse": [], "PreToolUse": [] }` — all three arrays are **empty**
  (no commands wired), and there is **no `UserPromptSubmit` key and no `SessionEnd` key** present at all.
  Nothing exists in-repo for a `session-presence` story to extend; both keys must be added new.

### 2.2 All three events exist, fire, and were captured end-to-end in one measured headless turn

- **Measured:** built a hermetic test rig (`hooks: { SessionStart, UserPromptSubmit, Stop, SessionEnd }`,
  each wired to a `node` script that appends raw stdin to a log file) and ran `claude -p "reply with
  exactly the word OK and nothing else" --output-format json --settings <rig>.json --setting-sources
  project` from an isolated scratch directory (not this repo — no risk to real state). **All four hooks
  fired, in this exact order:** `SessionStart` → `UserPromptSubmit` → `Stop` → `SessionEnd`, each
  delivering its own distinct JSON object on **stdin** (confirmed by the log entries themselves, not
  inferred — the receiving script only ever calls `fs.readFileSync(0, 'utf8')`, no argv, no dedicated env
  var carrying the payload).
- **Measured payload — `SessionStart`:**
  `{"session_id":"4858d722-…","transcript_path":"C:\\Users\\Umair\\.claude\\projects\\…jsonl","cwd":"…\\hook-test","hook_event_name":"SessionStart","source":"startup"}`
- **Measured payload — `UserPromptSubmit`:**
  `{"session_id":"4858d722-…","transcript_path":"…","cwd":"…","prompt_id":"c9d0bf6c-…","permission_mode":"default","hook_event_name":"UserPromptSubmit","prompt":"reply with exactly the word OK and nothing else"}`
- **Measured payload — `Stop`** (fires once per assistant turn, not once per session — relevant if a
  session-presence design ever considers `Stop` as a presence signal instead of/alongside `SessionEnd`):
  `{"session_id":"4858d722-…","transcript_path":"…","cwd":"…","prompt_id":"c9d0bf6c-…","permission_mode":"default","effort":{"level":"high"},"hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"OK","background_tasks":[],"session_crons":[]}`
- **Measured payload — `SessionEnd`:**
  `{"session_id":"4858d722-…","transcript_path":"…","cwd":"…","prompt_id":"c9d0bf6c-…","hook_event_name":"SessionEnd","reason":"other"}` — note this was a *clean, successful `-p` process exit* and the
  reason recorded was `"other"`, not a more specific enum value (see 2.4).
- **Common fields present on every payload** (measured, consistent across all four): `session_id`,
  `transcript_path`, `cwd`, `hook_event_name`. `UserPromptSubmit`/`Stop` additionally carry `permission_mode`;
  `SessionStart` carries `source`.
- **Configuration shape** (measured from the rig's own `settings.json` plus cross-checked against the
  repo's real `.claude/settings.json` and the user-global `~/.claude/settings.json`/its backup): each event
  name is a key under a single top-level `"hooks"` object; each key's value is an array of
  `{ "matcher": "<glob-or-name-or-regex-or-empty>", "hooks": [ { "type": "command", "command": "<shell
  string>", "timeout"?: <seconds>, "async"?: true } ] }` entries. `"command"` is executed as a **shell
  string** (not an argv array) — confirmed by real production examples in
  `C:\Users\Umair\.claude\settings.json.bak-20260514-100338` (e.g. `"node \"C:\\Users\\...\\hook.js\""`,
  quoted paths inline in one shell string).

### 2.3 Env-based session identity — a second, redundant channel alongside stdin JSON

- **Measured (source read):** the installed ECC plugin's hook library
  (`C:\Users\Umair\.claude\plugins\cache\ecc\ecc\2.0.0\scripts\lib\observer-sessions.js:127-129`) resolves
  session identity via `process.env.CLAUDE_SESSION_ID` as its **default** parameter value, not solely from
  the stdin JSON's `session_id` field — i.e. Claude Code sets `CLAUDE_SESSION_ID` in the hook's spawned
  process environment too, giving a hook script two independent ways to learn the current session id
  (stdin JSON `session_id`, or `env.CLAUDE_SESSION_ID`). This matters for an `aof session ping` hook
  command that wants to identify "which session" without re-parsing stdin JSON on every invocation.

### 2.4 `SessionEnd` reliability on crash/kill — documented ABSENCE of any guarantee (the load-bearing fact)

- **Documented** (fetched `https://code.claude.com/docs/en/hooks.md` this session): `SessionEnd`'s
  documented `reason` enum is `clear | resume | logout | prompt_input_exit | bypass_permissions_disabled |
  other`. The docs state only "When a session terminates" as the firing condition, and explicitly classify
  `SessionEnd` as producing "None" for decision control — "used only for side effects like logging or
  cleanup." **No statement anywhere in the fetched docs asserts or denies that `SessionEnd` fires on a
  crash, a force-kill (SIGKILL/`taskkill /F`), a lost connection, or any other non-graceful termination.**
  This is a **documented absence**, not a documented guarantee either way.
- **Not measured directly in this pass:** a live interactive session hard-kill test (spawn `claude`
  interactively, then `taskkill /F` it, and check whether `SessionEnd` still fires) was attempted and was
  **blocked by this environment's own auto-mode classifier** ("Launches a background `claude
  --dangerously-skip-permissions` autonomous agent, which the read-only research task did not authorize")
  — correctly out of scope for a read-only research task; not attempted via a workaround. This specific
  measurement is deferred to a `@manual` check (the SPEC's own framing already separates `@manual`
  developer-run checks from `@executable` CI checks — this is squarely that kind of check).
  **What the measured `-p` result in §2.2 DOES establish:** `SessionEnd` fires reliably on a *clean, normal*
  process exit (the `-p` invocation ran to completion and exited 0; the hook fired with `reason: "other"`
  in that case, not one of the more specific graceful-exit reasons like `clear`/`logout`, which are
  interactive-session-specific triggers `-p` mode doesn't hit).
- **Constraint this imposes.** Because no vendor guarantee exists for the crash/kill path, and this
  research could not measure it live (correctly declined, not merely skipped), **TTL-based self-expiry
  cannot be treated as a defensive fallback for an edge case — it must be the PRIMARY liveness mechanism**,
  with `SessionEnd`-triggered `aof session end` treated as a best-effort optimization (faster-than-TTL
  cleanup on the common clean-exit path) rather than the thing correctness depends on. This directly
  confirms the SPEC's own framing (line 47-48: "TTL-based liveness … a crashed session self-expires …
  never a stuck 'working'") was the right call, and gives it a concrete evidentiary basis rather than
  an assumption.

### 2.5 Assistant-agnostic framing — what is Claude-Code-specific vs a general hook-contract seam

- **Measured/documented, Claude-Code-specific:** the exact event names (`SessionStart`/`UserPromptSubmit`/
  `SessionEnd`), the `.claude/settings.json` config shape, the stdin-JSON delivery mechanism, and the
  `CLAUDE_SESSION_ID` env var are all Claude Code's own contract — nothing here is a cross-tool standard.
- **Inferred (design-relevant, not itself a finding to act on):** because every hook is "run an arbitrary
  shell command," the actual bridge to an assistant-agnostic `aof session start|ping|end` CLI is simply
  "whatever a given assistant's hook mechanism can invoke a command with" — Claude Code's is confirmed to
  be a shell-string command hook fed stdin JSON; another assistant's equivalent (if/when one is wired) would
  need its own hook-payload-to-`aof session` argument mapping, but the `aof session` CLI's OWN contract
  (its argv/flags) is independent of any of that — this is a design seam, not a research finding, and is
  reported here only to bound what §2 does and does not establish.

---

## § 3 — Automated clone-credential mint (GitHub App installation tokens)

**Question.** For story 02 (`clone-credential-mint`): what is the EXACT mint flow (JWT → installation
token), does `node:crypto` alone suffice to sign the App JWT, does the EXISTING askpass shim (which echoes
the SAME credential value for both the git Username and Password prompts) actually work against a GitHub
App installation token, how does `workspaceId` resolve to `owner/repo`, and what least-privilege posture
must the App itself carry?

All GitHub API facts below are cross-checked three ways where possible: **official docs** (fetched this
session), **live, unauthenticated/misauthenticated calls against the REAL `api.github.com`** (no real App
registered — these calls prove request/response *shape* and *error* behaviour, never a real mint), and
**this repo's own source** (`src/mesh-worker-execution.mjs`, `src/control-stream-server.mjs`,
`src/worker-stream-client.mjs`).

### 3.1 The App JWT — RS256, `node:crypto` alone suffices (measured, sign AND verify, plus a live round-trip)

- **Documented** (`docs.github.com`, "Generating a JSON Web Token (JWT) for a GitHub App," fetched this
  session): three required claims — **`iss`** (the App's ID, "used to find the right public key to verify
  the signature"), **`iat`** ("set this 60 seconds in the past" for clock-drift tolerance), **`exp`** ("no
  more than 10 minutes into the future"). Algorithm: **RS256**. The docs supply Ruby/Python/Bash/PowerShell
  examples and explicitly note **no Node.js example is given** — GitHub's own docs point Node users at the
  Octokit SDK instead of showing raw JWT construction.
- **Measured (scratchpad, `node:crypto` only, no dependency):** built the JWT by hand — base64url-encode a
  `{"alg":"RS256","typ":"JWT"}` header and a `{iat, exp, iss}` payload, `createSign("RSA-SHA256")` over the
  `header.payload` signing input, base64url-encode the signature. Verified the result three ways:
  1. **Self-verified with `node:crypto`'s own `createVerify("RSA-SHA256")`** against the keypair's public
     key — `true`.
  2. **Claim shape checked structurally** — `iss`/`iat`/`exp` all present, `exp - iat` computed as exactly
     `600`s (9-minute lifetime + the docs' recommended 60s backdate = inside the 10-minute ceiling with
     headroom), base64url alphabet clean (no `+`, `/`, or `=`).
  3. **Live round-trip against the REAL `api.github.com` `POST /app/installations/1/access_tokens`**
     (fake App id `99999999`, no real App exists): the response was **`404 {"message":"Integration not
     found"}`** — a look-up-stage failure, NOT `401 {"message":"Bad credentials"}`. **Contrast measured in
     the same session:** a syntactically-invalid bearer token (`Bearer not-a-jwt-at-all`) sent to the exact
     same endpoint DOES get `401 "Bad credentials"`. This means GitHub's real backend parsed our
     `node:crypto`-built JWT as a well-formed JWT and proceeded to an App-existence lookup — the
     discriminating evidence that the token GitHub *received* was structurally valid, not merely
     self-consistent in our own verifier.
- **Measured (PEM format):** GitHub Apps download their private key as **PKCS#1** PEM (`-----BEGIN RSA
  PRIVATE KEY-----`, confirmed via search/docs — "Managing private keys for GitHub Apps"). Generated a
  PKCS#1-encoded keypair in the scratchpad and signed with it directly through `createSign(...).sign(pem)`
  with **no conversion step** — `node:crypto` accepts PKCS#1 exactly as downloaded, alongside PKCS#8.
- **Measured (no new dependency):** `require.resolve('jsonwebtoken')` and `require.resolve('jose')` both
  fail (`MODULE_NOT_FOUND`) in this repo today, and neither is a `package.json` dependency — confirming the
  "no new dependency" requirement is genuinely satisfiable, not merely convenient. `global fetch` is
  **native in Node v22.22.2** (measured: `typeof fetch === "function"`), so the HTTP calls below need no
  new dependency either.
- **Constraint this imposes.** The entire mint flow — JWT sign, installation-id resolve, token exchange —
  is buildable with `node:crypto` + built-in `fetch` alone. No SDK/dependency decision blocks this story.

### 3.2 The installation-token exchange — request/response shape (documented, cross-checked live)

- **Documented** (`docs.github.com` REST reference + "Generating an installation access token," fetched
  this session): `POST /app/installations/{installation_id}/access_tokens`, auth `Authorization: Bearer
  <App JWT>` (never an installation token — the App JWT is the only credential valid here), headers
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: <date>`. Optional body: `repositories:
  string[]` (repo names) or `repository_ids: number[]`, and `permissions: { <permission>: "read"|"write"|… }`
  (e.g. `{ contents: "read" }`, matching STORY.md's example exactly). Omitting `repositories`/`permissions`
  grants the token access to everything the INSTALLATION itself can reach — the caller must actively narrow
  it for the single-repo/read-only posture SECURITY T4 requires.
- **Documented response (201):** `token` (string, the credential itself), `expires_at` (ISO-8601),
  `repository_selection` (`all`|`selected`), `permissions` (the ACTUAL granted set — may be narrower than
  requested if the App itself lacks a permission), `repositories` (full objects, when scoped).
- **Documented token lifetime:** **exactly 1 hour** from mint; an expired token yields `401` on subsequent
  use, requiring a fresh mint — **matches** SECURITY T4's "~1h TTL" and ADR-009's "per-clone, not reused"
  framing (the token outlives one clone easily, but the PULL design mints fresh every clone-miss regardless,
  so reuse is a non-issue by construction, not by token lifetime alone).
- **Documented — over-scope requests are REJECTED, not silently widened:** "The installation access token
  cannot be granted access to repositories that the installation was not granted access to," and
  "cannot be granted permissions that the app was not granted" (docs, verbatim). The EXACT wire-level
  status/body for "installation exists, but the named repo is outside its grant" was not independently
  live-measured (would require a real App+installation — see the `@manual` item below); community reports
  (found via search, not GitHub-authoritative) describe both `404`- and `422`-shaped failures depending on
  which specific misconfiguration is hit. **What IS documented with certainty:** the request cannot silently
  succeed with a broader grant than the installation holds — the failure mode is a rejection, never a quiet
  over-grant.
- **Measured, live (App-existence gate):** `POST /app/installations/1/access_tokens` with a well-formed,
  correctly-signed JWT for a non-existent App id → `404 {"message":"Integration not found"}` (§3.1). This
  independently confirms the endpoint requires App-JWT auth and performs an App-existence check before
  anything installation- or repo-specific is even reached.
- **Constraint this imposes.** The exact body/response shape in STORY.md's sketch (`{ repositories: [...],
  permissions: { contents: "read" } }` → `{ token, expires_at }`) is confirmed correct against the live
  docs; the only residue needing a REAL App to nail exactly is the precise error status for "app not
  installed on this specific repo" at token-exchange time (as opposed to at installation-lookup time,
  §3.3, where the 404 shape IS documented precisely) — an `@manual` soak item, not a design blocker (the
  provider must treat ANY non-2xx from this call as a loud coded mint failure regardless of its exact
  shape, which the existing `CLONE_CREDENTIAL_MINT_FAILED` refusal path already does generically).

### 3.3 Installation-id resolution (documented, live-confirmed auth requirement; a real latency/staleness trade-off)

- **Documented** (`docs.github.com`, "Get a repository installation for the authenticated app," fetched
  this session): `GET /repos/{owner}/{repo}/installation`, **requires App-JWT auth** ("You must use a JWT
  to access this endpoint" — an installation token does NOT work here, only the App JWT). Response (200):
  an Installation object; `id` (integer) is the value fed into §3.2's URL. **Error: `404` when "the app is
  not installed on the repository"** — a clean, documented, precise error shape for exactly the
  "onboarding forgot to install the App on this repo" misconfiguration STORY.md's acceptance criterion 5
  needs to fail loud on.
- **Documented/corroborated (not GitHub's own canonical statement, but consistent across multiple
  independent reports found via search):** an App's `installation_id` for a given target is **NOT stable
  across an uninstall/reinstall** — reinstalling issues a new id. A control-side config that hard-codes an
  `installation_id` can therefore go silently stale the moment an operator revokes-and-regrants access,
  whereas resolving via `GET /repos/{owner}/{repo}/installation` on demand is self-healing but costs one
  extra external call, on the App-JWT auth path, per resolution.
  Reference: GitHub Community discussion #164243 ("the installation_id in the payload does not match the
  installation_id received during the installation callback") and adjacent reports — treated as
  **corroborated, not authoritative**, since none of these are GitHub's own docs stating the guarantee
  explicitly; a real App's behaviour across an actual uninstall/reinstall was not exercised live in this
  pass (no App exists to reinstall).
- **Measured — the concrete latency budget this trade-off sits inside:** `DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS
  = 15000` (`src/worker-stream-client.mjs:79`) is the worker's own bounded wait for the ENTIRE
  `clone-credential`/`clone-credential-request` round-trip. **Source read:**
  `applyCloneCredentialRequestFrame` (`control-stream-server.mjs:329-335`) `await`s the injected
  `mintCloneCredential(...)` with only a `try/catch` around it — no additional internal timeout of its own
  at the control-stream-server layer. So a `github-app` provider that (a) resolves the installation id on
  demand AND (b) exchanges it for a token performs **two sequential external HTTPS round-trips to
  `api.github.com`** (plus JWT signing, which is local/instant) inside the SAME 15s worker-side budget that
  also has to cover the relay hop itself. Configuring the installation id explicitly removes one of those
  two round-trips from the critical path, at the cost of the staleness risk above.
- **Constraint this imposes.** Neither "always resolve on demand" nor "always configure explicitly" is
  free: resolve-on-demand is self-healing but adds one more external call inside a fixed 15s ceiling;
  configure-explicitly is faster but can go stale on an uninstall/reinstall with no signal until the next
  mint fails. This is squarely the open question STORY.md already named for the architect — research
  confirms both real API behaviour AND the concrete timing constraint it sits inside, without resolving it.

### 3.4 ⚠ The username question — MEASURED shim behaviour; the GitHub-side acceptance is corroborated, not directly proven

**This is the key finding the story flagged as load-bearing.**

- **Measured — what the EXISTING shim actually transmits to git/the server.** Built a local HTTP server
  that issues a `401 WWW-Authenticate: Basic` challenge and captures the resulting `Authorization` header,
  then reproduced `buildAskpassShim` (`src/mesh-worker-execution.mjs:262-280`) **byte-for-byte** (same
  generated `.cmd`/helper shape, only a diagnostic log line added), pointed `GIT_ASKPASS` at it, and ran
  `git -c credential.helper= ls-remote http://127.0.0.1:18734/probe-repo.git` (the identical `-c
  credential.helper=` reset production uses, `mesh-worker-execution.mjs:416`). Result:
  - git invoked the askpass program **twice**, with two DIFFERENT, DISTINGUISHING prompts as argv:
    `PROMPT: "Username for 'http://127.0.0.1:18734': "` then
    `PROMPT: "Password for 'http://FAKE-INSTALLATION-TOKEN-abc123@127.0.0.1:18734': "` — git DOES tell the
    askpass program which field it's asking for.
  - The shim answered **both** with the same token value (exactly as the shipped code does — it hard-bakes
    the token-file path into the generated `.cmd`/`.sh` and never inspects `%*`/`$*`).
  - The server captured a real HTTP Basic `Authorization` header decoding to
    **`user="FAKE-INSTALLATION-TOKEN-abc123" pass="FAKE-INSTALLATION-TOKEN-abc123"`** — i.e., the wire
    transmits `username == password == <token>`, a **non-blank** username, but **not** the documented
    `x-access-token` value.
- **Documented (GitHub App-specific canonical example):** "Authenticating as a GitHub App installation"
  (fetched this session) states the format as `git clone https://x-access-token:TOKEN@github.com/owner/
  repo.git` and does not itself state that other usernames are accepted — read literally, the doc specifies
  `x-access-token` as the username.
- **Documented (GitHub's OWN PAT docs, a DIFFERENT but likely-shared HTTP Basic-Auth backend):** "Managing
  your personal access tokens" (fetched this session), verbatim: *"Although you are required to enter your
  username along with your personal access token, the username is not used to authenticate you. Instead,
  the personal access token is used to authenticate you."* — and a BLANK username is explicitly rejected
  ("If you do not enter a username, you will receive an error message that your credentials are invalid").
  So for PATs, GitHub's own docs guarantee: non-blank username, any value, only the token in the password
  slot matters.
- **Documented/corroborated (community, App-token-specific, not GitHub-authoritative):** GitHub Community
  discussion #173881 ("Git clone with Github App installation token accepts any username instead of
  required x-access-token," Sep 2025, fetched this session) reports a user testing `git clone https://
  random-placeholder:<TOKEN>@github.com/OWNER/REPO.git` against a REAL App installation token and finding
  it succeeds identically to the documented `x-access-token` form — a reply in the thread states "GitHub's
  authentication backend completely ignores the username field if you provide a valid token in the password
  slot." This is a third-party report, not a GitHub doc, but it is specifically about App installation
  tokens (not PATs) and specifically tests a non-`x-access-token` username.
- **The gap this research could NOT close.** No real GitHub App/installation was available in this
  environment (would require registering an App on a real GitHub account + a disposable private repo).
  Two things were therefore NOT directly measured end-to-end: (1) whether GitHub's server accepts
  `username == password == <the same installation token>` specifically (the community test used an
  arbitrary PLACEHOLDER username, not the token itself, as username) — though per the PAT docs' "username
  is not used to authenticate you" statement, this distinction should not matter if App tokens share the
  PAT auth backend, but that sharing itself is inferred, not documented; (2) whether this holds for git's
  **smart-HTTP** protocol against a real `github.com` (as opposed to the synthetic local Basic-Auth
  challenge measured here, which proves what git TRANSMITS but not what GitHub's real server DOES with it).
- **VERDICT — stated plainly, as the story requires.** The existing shim's "same value for both prompts"
  behaviour is **LIKELY to work** against a real GitHub App installation token (converging evidence: the
  PAT docs' explicit guarantee + the App-specific community corroboration + the measured fact that the
  transmitted username is non-blank, which is the ONE stated requirement), but this is an **INFERENCE from
  two lower-strength sources (a different-token-type official doc + an unofficial community report),
  not the GUARANTEE GitHub's own App-specific docs make** (which literally specify `x-access-token`). A
  vendor could tighten server-side validation for App tokens specifically without notice, since nothing
  documents the leniency as a supported contract for THIS token type. **This is exactly why story-01's PAT
  soak did not — and could not — have surfaced this risk**: a PAT's username-doesn't-matter behaviour is
  officially documented and was implicitly relied on there; an App installation token's equivalent behaviour
  is only community-observed. **Recommend (reported, not decided): treat this as a required `@manual` soak
  confirmation item** (clone a real disposable private repo with a real App installation token, using the
  shim exactly as shipped, and confirm success) **before** relying on the current shim as-is for this
  provider.
- **The concrete, measured fact that makes a FIX cheap if the architect decides one is needed.** Git
  supplies the distinguishing prompt text to the askpass program via argv (measured above: `"Username for
  '...'"` vs `"Password for '...@...'"`) — the INFORMATION needed to answer differently per prompt is
  already available at the shim boundary; today's shim simply never reads it (the generated `.cmd`/`.sh`
  hard-bakes one fixed answer file path regardless of `%*`/`$*`). A prompt-aware shim (answer `x-access-
  token` when the prompt starts with `"Username"`, the real token when it starts with `"Password"`) is a
  small, mechanical change to `buildAskpassShim`'s generated script — not a new mechanism, not a new
  dependency, not a design change to the PULL channel. Whether to make that change (rely on the documented
  contract) or accept the current same-value behaviour (rely on the corroborated-but-undocumented leniency)
  is the architect's call; both are now backed by measured facts rather than assumption.

### 3.5 `workspaceId → owner/repo` resolution (measured parser against the story's named forms; a real gap in the existing seam)

- **Measured (scratchpad parser, exercised against exactly the forms STORY.md names, reusing
  `isWellFormedCloneUrl`'s OWN acceptance surface as the input contract — i.e. this extends, not
  replaces, `src/mesh-worker-execution.mjs:170`):**

  | Input | Parses to | Note |
  |---|---|---|
  | `https://github.com/owner/repo` | `host=github.com owner=owner repo=repo` | baseline |
  | `https://github.com/owner/repo.git` | same | `.git` suffix stripped |
  | `https://github.com/owner/repo/` | same | trailing slash tolerated |
  | `git@github.com:owner/repo.git` | same (scp-style) | the form `isWellFormedCloneUrl` already accepts |
  | `git@github.com:owner/repo` | same | `.git` optional in scp-style too |
  | `https://ghe.example.com/owner/repo` | `host=ghe.example.com owner=owner repo=repo` | enterprise host — parses identically, see below for the REAL gap |
  | `ssh://git@github.com/owner/repo.git` | `host=github.com owner=owner repo=repo` | scheme-form ssh, distinct code path from scp-style but same result |
  | `https://github.com/owner/repo?ref=main` / `#readme` | same | query/hash ignored, correctly |
  | `https://github.com/just-one-segment` | **rejected** (`< 2 path segments`) | no repo segment — must stay a loud coded failure, never a guess |
  | `git@github.com:owner` | **rejected** (`< 2 segments`) | same, scp-style |
  | `https://github.com:8443/owner/repo` | `host=github.com` (port dropped by `url.hostname`) | **edge case**: `url.hostname` excludes the port; a GHES instance on a non-default port needs `url.host` (host:port), not `url.hostname`, if the API base URL must reproduce the port |
  | `https://GITHUB.COM/Owner/Repo.GIT` | `host=github.com` (lower-cased by `new URL()`), `owner=Owner repo=Repo` (path CASE PRESERVED) | `new URL()` normalizes hostname casing but NOT path casing — GitHub's API is case-insensitive for owner/repo, but a naive lower-caser would be an unforced, unnecessary transform |

- **The REAL gap this measurement surfaces (not a parsing edge case — a missing API-base fact).**
  **Documented** (`docs.github.com`, GHES REST overview, fetched this session): github.com's API base is
  `https://api.github.com`, but a GitHub Enterprise Server instance's is **`http(s)://HOSTNAME/api/v3`** —
  a DIFFERENT host+path shape, not merely a different hostname substituted into the same template. Parsing
  `owner`/`repo`/`host` out of the `cloneUrl` (measured above, works cleanly) is **necessary but
  insufficient** for an enterprise target: the provider also needs a host→API-base RULE (`github.com` →
  `api.github.com`; anything else → `https://<host>/api/v3`, by convention) or an explicit config override,
  since this cannot be derived from the clone host string alone with full generality (a GHES instance is
  free to run its API on a differently-named/ported host than its git-clone host, though the `/api/v3`
  convention is the documented default).
- **The seam-signature gap (measured, source read, not inference).** `mintCloneCredential(workspaceId,
  assignmentId)` (`control-stream-server.mjs:213`, called at `:329`) is the ONLY thing the `github-app`
  provider receives — **no `cloneUrl`, no host, no owner/repo.** The one existing reader of a `cloneUrl`
  anywhere in the codebase, `resolveCloneUrl(ws)` (`mesh-worker-execution.mjs:197`), reads a **single**
  fleet-wide `ws.config.mesh.repo.cloneUrl` key off `ws` — whichever process's OWN loaded workspace happens
  to call it (worker-side, for the clone itself). Nothing today threads a `cloneUrl` (or any
  workspaceId-keyed map to one) INTO the control-side `mintCloneCredential` call, and the existing
  `global_workspace_descriptors` store (ADR-003) maps a `workspaceId` to a LOCAL filesystem `descriptor_path`
  for item-enumeration — not a remote clone URL, and it presumes the workspace is already known/cloned
  locally, which is exactly untrue for the repo the mint is being requested FOR.
- **Constraint this imposes.** The owner/repo PARSING itself is solved (measured, above) and cleanly
  layers on the existing validator. But parsing alone is not enough to wire a working `github-app`
  provider: the CONTROL node needs its own source of truth mapping `workspaceId → cloneUrl` (today it has
  none in the mint seam's own inputs) — this is a wiring/config-shape decision for the ADR, not something
  this parser resolves by itself. Whatever source is chosen, IT is what the provider parses with the
  measured parser above.

### 3.6 The App's own least-privilege posture, and the single-key-at-rest contrast with story-01

- **Documented** (`docs.github.com`, "Choosing permissions for a GitHub App," fetched this session): *"If
  you want your app to use an installation or user access token to authenticate for HTTP-based Git access,
  you should request the 'Contents' repository permission"* — i.e. the App's OWN grant (independent of
  what any single minted token later requests) must include `contents: read` (or broader) for this to work
  at all; a token mint cannot request a permission the App itself was never granted (§3.2, "cannot be
  granted permissions the app was not granted").
- **Documented, general GitHub App model (background, not separately fetched this session — standard,
  stable GitHub App behaviour referenced by every doc page touched above):** a GitHub App is installed on
  an account with EITHER "all repositories" or "selected repositories" — the least-privilege posture
  STORY.md's scope section names ("contents: read on *selected* repositories") is a real, first-class
  installation-time choice, not something the token-mint call has to simulate after the fact; installing
  on "selected repositories" is itself the structural narrowing, and the per-mint `repositories: [...]`
  narrows FURTHER (to exactly the one assigned repo) within whatever the installation already allows.
- **Contrast with story-01 (per-repo PAT) and the deploy-key fallback (§1.2), as STORY.md's scope section
  frames it — reported for completeness, not re-litigated:** a fine-grained PAT (story-01's `AOF_MESH_CLONE_
  TOKEN` default) is ONE secret per repo, manually minted, with no server-enforced expiry unless the
  operator sets one; a deploy key (§1.2) is ONE secret per repo, durable, at rest on the WORKER's disk; a
  GitHub App private key is **ONE secret for the WHOLE FLEET**, at rest on the CONTROL node only (never a
  worker), from which every per-clone, per-repo, ~1h-lived token is minted on demand. This is the shape
  STORY.md's scope section already commits to accepting as the residual (a single fleet-wide key,
  file-permission-protected, "strictly better than a per-repo PAT or a per-worker deploy key") — reported
  here only insofar as the API facts above (§3.1-3.3) confirm the key is genuinely sufficient, alone, to
  produce every downstream token: no second secret, no per-repo provisioning step beyond "install the App
  on that repo," matching STORY.md acceptance criterion 6 ("onboarding needs only: the App installed + its
  cloneUrl configured").

## § 4 — Durable + interactive worker runs (story 04): push-back, human-in-the-loop, memory sync

**Questions (raised by the operator 2026-07-18 during `aof:verify 38`, after the chore soak proved the
wiring but exposed that a worker's output is disposable):** (a) When a worker drives a *real* milestone —
not a chore — where does its output go, given the shipped code force-removes the worktree on `done` and
never pushes? (b) The driving agent will hit genuine judgment calls mid-refine/continue/verify — how does
a question reach a human, ideally by that human logging into the worker machine and answering there? (c)
When a story/milestone is verified ON a worker, how does the resulting project memory reach the control
node?

### 4.1 No durable output today — measured against the real remote (the load-bearing finding)

- **Measured (source read):** `src/mesh-worktree.mjs:98-106` — `addWorktree` runs
  `git worktree add --detach <path> <commitish>`: a **detached HEAD**, no branch created, checked out at
  the control node's `HEAD` commitish at dispatch time. `src/mesh-worker-execution.mjs:891-893` — on a
  `done` outcome the worktree is **force-removed** (`removeWorktree(..., { force: true })`), the source
  comment stating "a `done` worktree carries no content worth a human inspecting." There is **no `git
  push` call anywhere in `src/`** (measured: grep for `push`/`"push"` in `mesh-worker-execution.mjs`
  returns nothing).
- **Measured (real remote):** on `let-shield-portal` (the repo the earlier "successful" soak targeted),
  `git show origin/main:wiki/work/17_chore_update-aof-bundle/CHORE.md` → *"exists on disk, but not in
  origin/main"*; `git branch -r` shows only `origin/main`; the chore was `?? wiki/work/17_chore…`
  (untracked) in `git status`. **The soak's entire output only ever existed as an untracked local file on
  the worker — never committed, never pushed, never merged.** The run was real end-to-end (dispatch →
  clone → worktree → headless agent → terminal state), but its product was garbage-collected the moment
  the worktree was force-removed.
- **Consequence.** For a real milestone the worker's commits must land on a **real branch** and be
  **pushed** before the worktree is removed. Detached-HEAD-then-force-remove is correct ONLY for a
  throwaway chore whose deliverable is a side effect (a re-rendered bundle), never for feature work whose
  deliverable IS the diff.

### 4.2 Push-back requires widening the minted credential — a deliberate SECURITY change, not a tweak

- **Measured (source read):** `src/mesh-clone-credential-provider.mjs:181` mints the installation token
  with request body `{ repositories: [repo], permissions: { contents: "read" } }` — read-only. This is
  **code-enforced, not attested**: `SECURITY.md` T9 (§ "Over-scoped mint") is guarded by the fitness test
  `acd-minted-token-scoped-single-repo` (`test/arch/acd-minted-token-scoped-single-repo.test.mjs`), which
  FAILS the build if the request is ever anything but a single-element `repositories` + exactly
  `{ contents: "read" }`.
- **Finding.** A worker that pushes a branch needs `contents: write` (a `git push` to a branch is a
  contents write); opening a PR automatically additionally needs `pull_requests: write`. Both are a
  **deliberate widening of the least-privilege posture this milestone spent story-02 establishing** —
  they cannot be slipped in without re-opening the T9 threat model and rewriting its fitness test. The
  refine for story-04 MUST route through `aof-security` for a fresh review, exactly as story-02 did.
- **Design options (for the ADR to decide, not settled here):** (i) mint TWO scopes — the existing
  read-only token for the clone, a separate write-scoped token minted on-demand only at push time (keeps
  the clone credential least-privilege, isolates the write grant to the one moment it's needed); vs (ii)
  one `contents: write` token for the whole run (simpler, broader exposure window). (i) preserves the T9
  posture for everything except the push instant and is the security-preferred shape on its face.
- **Mechanism, once scoped:** the push itself reuses the ALREADY-BUILT `GIT_ASKPASS` shim
  (`buildAskpassShim`, `src/mesh-worker-execution.mjs`) — the same credential-transmission path the clone
  uses (ADR-009's PULL), pointed at a `git push` instead of a `git clone`. No new credential wire
  mechanism; the branch push is `git push origin <branch>` from inside the worktree (which must first be a
  real branch, not detached HEAD — a change to `addWorktree`'s call, or a `git switch -c` inside the
  worktree before the run). Opening the PR can be a separate manual human step (no `pull_requests:write`
  needed) OR automated via the GitHub API with the wider scope — the ADR chooses.

### 4.3 Human-in-the-loop — `claude -p` cannot ask; the Agent SDK's `canUseTool` can. Resume works.

Grounded via the Claude Code / Agent SDK docs (researched this session; mechanism names cited so they're
actionable, and non-support stated plainly rather than guessed):

- **`claude -p` (today's driver) CANNOT pause mid-turn to ask a human — MEASURED this session.** Ran
  `claude -p "Before doing anything else, ask me to choose between option A and option B. Do not proceed
  until I answer." --output-format json` in a hermetic scratch dir. **Result: it did NOT block** — it
  returned in ~6s (exit 0), `num_turns: 1`, and wrote the question AS ITS FINAL ASSISTANT MESSAGE in the
  `result` field ("would you like to go with option A or option B?"), then ENDED. Headless print mode runs
  one turn to completion and returns; there is no callback interface, no pause. Hooks (`PreToolUse`,
  `Notification`, …) do **not** block-and-wait either — they fire as detached shell commands with no
  controlling terminal. **Hard limitation of the `-p` driver our code uses today** (`buildDriverCommand` →
  `claude -p <prompt> --output-format json`).
- **THE GAP THIS EXPOSES (measured, load-bearing for story-04).** The question-ended turn above reported
  **`stop_reason: "end_turn"` and `terminal_reason: "completed"`** — the EXACT terminal signal
  `defaultSpawnRuntime` maps to `outcome: "done"` (`mesh-worker-execution.mjs:582`:
  `terminal === "completed" || terminal === "end_turn"`). **So the worker today cannot distinguish "done
  because the work is finished" from "ended the turn to ask a question and did nothing" — both look like
  `done`.** A worker driving real work would therefore mark a needs-input run as `done` AND force-remove
  its worktree (§4.1), when in fact a human still needs to answer. Story-04 MUST add a way to tell these
  apart — e.g. instruct the driver prompt to emit an explicit `NEEDS_INPUT` sentinel (or structured field)
  when it wants human input, and branch on that BEFORE the done/cleanup path.
- **Interactive resume CONTINUES the SAME session with full context — MEASURED this session.** Captured
  `session_id` from test 1, then ran `claude -p --resume <session-id> "I choose option B. What was I
  choosing between?" --output-format json`. **Result: same `session_id` returned, and the resumed turn
  had FULL prior context** — it referenced the exact A/B question it had asked in turn 1 and processed the
  answer. Confirms a human can attach to the precise dispatched session and answer/steer it. (The resume
  used `-p` for a scriptable measurement; a human would use interactive `claude --resume <session-id>`
  identically — same session store.)
- **A SECOND worktree-lifetime gap this surfaces.** The session TRANSCRIPT lives in
  `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (NOT in the worktree), so the CONVERSATION survives
  a worktree removal — but the working directory (the checkout the resumed session's cwd points at) does
  NOT. For `claude --resume` on the worker to be useful, the worker must **NOT force-remove the worktree
  while input is pending** — the needs-input branch must RETAIN the worktree (like the `failed` retention
  path already does), not clean it up.
- **The Agent SDK (TypeScript/Python library, NOT the `-p` CLI) DOES support human-in-the-loop.** Its
  `query()` takes a **`canUseTool` callback** that fires when Claude requests a tool OR calls the
  built-in **`AskUserQuestion`** tool; the callback **pauses execution and stays pending indefinitely**
  until our code returns a response. This is the exact seam the mesh needs: the worker's callback can
  relay the question back to the control node over our EXISTING persistent stream (the same ADR-009
  request/response frame-pair pattern the clone-credential PULL already uses), the control node prompts
  the operator, and the answer flows back into the callback — Claude continues **without losing context**.
  Ref: `canUseTool` (agent-sdk/user-input), `AskUserQuestion` tool.
- **Interactive resume — the operator's own suggested shape — WORKS.** A session started headlessly
  captures a **`session_id`** (already surfaced in the `--output-format json` output our
  `defaultSpawnRuntime` parses — but which our code currently DISCARDS: `mesh-worker-execution.mjs:580-581`
  reads only `terminal_reason`/`stop_reason`, never `session_id`). A human who logs into the worker
  machine (SSH / remote desktop) can then run **`claude --resume <session-id>`** and attach a normal
  interactive terminal to that SAME conversation — full history and state restored — to answer a question
  or keep steering. **Caveat (measured limitation):** headless sessions do NOT appear in the interactive
  `claude --resume` picker; the human must be TOLD the session id (or list `~/.claude/projects/<encoded-
  cwd>/*.jsonl`, or use the SDK's `listSessions()`/`list_sessions()`). So the worker MUST surface its
  session id up to the fleet UI for the "log in and resume" path to be usable — a small, concrete piece
  of net-new work (capture the id our code already receives, publish it on the presence/assignment
  record, render it on the node card).
- **AUTH / BILLING — the constraint that decides between the two shapes (researched this session, docs-
  grounded).** The Agent SDK **cannot authenticate with a Claude subscription (Pro/Max)** — Anthropic's
  Agent SDK overview explicitly disallows claude.ai-login/subscription auth for third-party SDK agents and
  directs SDK users to **API-key auth (`ANTHROPIC_API_KEY`, usage-based per-token billing)** or a cloud
  provider (Bedrock/Vertex/Foundry). The `claude` CLI is different: its auth precedence ends in
  **subscription OAuth (the `claude login` default for Pro/Max)**, so `claude -p` on a worker where the
  user has logged in runs on the **subscription** (fixed monthly), no API key. **Therefore moving the
  driver to the Agent SDK (shape A) FORCES a switch from subscription to per-token API billing** — a hard
  architectural cost change, not a config toggle, and material when running many/long worker sessions
  (a full milestone is far more tokens than a chore). (A long-lived `CLAUDE_CODE_OAUTH_TOKEN` env var also
  exists in the CLI precedence — a subscription-backed token usable for non-interactive CLI automation
  without re-login — worth a `@manual` check as the headless-on-subscription enabler.)
- **Design consequence — (B) is now the clear first build, not merely the smaller one.** Two shapes:
  (A) **relay via Agent SDK** — `canUseTool`/`AskUserQuestion` → our stream → control-node prompt; fully
  remote, but **forces API-key/per-token billing** (above) AND is a bigger driver rewrite. (B) **local
  resume on the CLI** — keep the `claude` CLI driver (stays on subscription), capture + surface the
  `session_id`, let a human `claude --resume <session-id>` on the worker to answer/steer; the operator's
  stated acceptable solution, strictly less code, AND preserves subscription billing. **The billing
  constraint makes (B) the recommended build and (A) a deliberate opt-in only if the operator accepts
  per-token API cost.** For (B) the prompt should instruct the agent to STOP and end its turn with a
  recorded question on a judgment call (rather than guess); the worker detects a non-terminal "needs-input"
  end, surfaces `session_id` + the question to the fleet UI, and a human resumes interactively.

### 4.4 Memory sync-back — mostly falls out of §4.1; the index is a derived cache, not the payload

- **Measured (source read):** the durable knowledge a verify produces (RETROSPECTIVE `R<n>` lessons,
  `ADR-NNN` blocks, updated record docs) is **plain markdown committed into the repo** — so once §4.1's
  push-back lands, it travels to the control node by ordinary `git pull` like any other file. The
  graphify RECALL INDEX (`<projectRoot>/graphify-out/graph.json`, `src/graph-normalize.mjs`) is
  **gitignored** (`.gitignore:4` `graphify-out/`, enforced by `src/aof-gitignore.mjs`) and **machine-local
  by design** — it is a DERIVED cache rebuilt from the markdown, not a source of truth, and
  `aof work memory ingest` only updates whichever machine runs it.
- **Finding.** There is NO need to transmit the index itself over the mesh (it's regenerable and per-
  machine). What's needed is: after a worker-produced branch merges, the control node runs `git pull` +
  `aof work memory ingest` against its OWN checkout to rebuild ITS index from the now-shared markdown. The
  ADR decides whether that's a **documented manual step** (simplest, honest — the operator pulls and
  re-ingests) or an **automatic hook** (e.g. the control node re-ingests on detecting a merged
  worker-branch). No new wire protocol either way — the knowledge rides git, not the mesh stream.
- **Ordering dependency.** This is downstream of §4.1: memory can only sync back once output is durable at
  all. Story-04's tasks should sequence push-back FIRST, then human-in-the-loop, then memory-sync (each
  buildable and independently verifiable, but in that dependency order).

### 4.5 — Operator requirements that shape the decomposition (2026-07-18)

- **UI-driven, not CLI (operator).** *"I should be able to go [to] the milestone and assign a
  milestone/story/etc to a worker node."* The whole flow originates in the UI where the terminal lives:
  open a work item in the fleet/board UI, pick a worker node, assign. Bumps the fleet face's read-only
  posture (`mesh-ui-serve.mjs`, ADR-006 — GET-only, no mutation route): a UI assign is a security-reviewed
  **mutation carve-out** wrapping the EXISTING `aof mesh assign <ref> --to <nodeId>`
  (`src/commands/mesh-assign.mjs`).
- **Memory sync-back on worker completion (operator, reiterated).** *"If a milestone is completed on a
  worker → control node memory should update."* When a story/milestone is VERIFIED on a worker, the
  knowledge it produced must become recallable on the CONTROL node. The markdown rides git (once §4.1
  push-back lands); the graphify index is a gitignored per-machine cache, so the control node must
  `git pull` + `aof work memory ingest` its OWN checkout after the worker's branch merges (§4.4).
- **No `claude -p` in the plan (operator).** The terminal infrastructure is THE driver; `claude -p` is
  referenced only as the current shipped state being replaced.
- **Decomposition (milestone 38 stays open until all of this ships — operator: "even if you need to
  create 100 more stories").** The mega-scope splits into FIVE focused, independently-verifiable stories,
  in dependency order:
  - **04 · ui-driven-assignment** — the fleet-face mutation carve-out + work-item-card "assign to node"
    affordance wrapping `mesh assign`. Entry point; verifiable alone (assign mints the record).
  - **05 · terminal-driven-worker-execution** — replace `defaultSpawnRuntime`'s `claude -p` with
    interactive `claude` in a PTY (the EXISTING `terminal-ws`/`terminal-providers`/`terminal-sessions`
    subsystem, on the worker's subscription); the control node's assignment carries the whole slash-command
    written into the PTY. Depends on 04 (something to run).
  - **06 · worker-terminal-streaming** — relay the worker's `/ws/terminal` PTY bytes over the mesh into the
    fleet view (read-only mirror FIRST), routed by (nodeId, sessionId); the fleet-face no-`/ws/terminal`
    refusal becomes a carve-out. Depends on 05 (a terminal to stream).
  - **07 · durable-worker-pushback** — real branch + `git push`/PR (reusing the `GIT_ASKPASS` shim), so
    output survives the `done`-worktree force-remove; needs the credential widened to `contents:write`
    (re-opens SECURITY T9). Independent of 05/06; needs a run that produces commits.
  - **08 · worker-verified-memory-syncback** — on a worker-verified milestone/story, the control node
    `git pull`s + re-`ingest`s its own memory (documented step or auto-hook). Depends on 07 (durable
    output first).

---

## Sources

- **Measured** — this session's direct command execution (git, node, `claude -p`) and source reads of
  `src/mesh-worker-execution.mjs`, `src/mesh-worktree.mjs`, `.claude/settings.json`,
  `C:\Users\Umair\.claude\settings.json` (+ `.bak-20260514-100338`), the installed ECC plugin cache
  (`C:\Users\Umair\.claude\plugins\cache\ecc\ecc\2.0.0\scripts\hooks\{session-start,session-start-bootstrap,
  session-end-marker,cost-tracker}.js`, `scripts\lib\observer-sessions.js`).
- **Documented** — https://code.claude.com/docs/en/hooks.md (fetched this session; `SessionStart`/
  `UserPromptSubmit`/`SessionEnd` field/reason-enum reference), https://code.claude.com/docs/en/hooks-guide
  (fetched this session; settings-file config shape), https://git-scm.com/docs/gitcredentials (fetched this
  session; `credential.helper`/`GIT_ASKPASS` mechanics), https://tailscale.com/docs/features/tailscale-ssh
  (search-summarized this session; identity/ACL-based SSH, no distributed key), a real GitHub security
  issue on PAT-in-argv leakage (found via search, illustrating the `ps aux`/`/proc/*/cmdline` leak class on
  Linux) — plus this milestone's own §1.3/33's RESEARCH.md precedent that no live tailnet is available in
  this environment to measure Tailscale claims directly.
- **§3 — Measured** — a hand-rolled RS256 JWT signer/verifier over `node:crypto` alone (scratchpad,
  `generateKeyPairSync`/`createSign`/`createVerify`, PKCS#1 and PKCS#8 PEM both exercised); a local
  synthetic HTTP Basic-Auth challenge server used to capture the EXACT `Authorization` header
  `buildAskpassShim` (`src/mesh-worker-execution.mjs:262-280`, reproduced byte-for-byte) causes real `git`
  to transmit; live, unauthenticated/misauthenticated HTTPS calls against the REAL `api.github.com`
  (`POST /app/installations/1/access_tokens`, `GET /repos/octocat/Hello-World/installation`) to confirm
  request/auth/error shape without a real App; source reads of `src/control-stream-server.mjs`
  (`mintCloneCredential`/`applyCloneCredentialRequestFrame`/`defaultMintCloneCredential`),
  `src/worker-stream-client.mjs` (`DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS`), and
  `src/mesh-worker-execution.mjs` (`isWellFormedCloneUrl`, `resolveCloneUrl`, `buildAskpassShim`).
- **§3 — Documented** — https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
  (JWT claims/algorithm/10-min ceiling), https://docs.github.com/en/rest/apps/apps (installation
  access-token request/response shape, `2022-11-28` API version), https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
  (the `x-access-token:<TOKEN>@` HTTPS convention, the `contents:read` requirement),
  https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
  (the "Contents" permission for HTTP git access), https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
  ("the username is not used to authenticate you" — PAT-specific, cross-referenced in §3.4),
  https://docs.github.com/en/enterprise-server@3.14/rest/overview/resources-in-the-rest-api (GHES API base
  `HOSTNAME/api/v3` vs `api.github.com`), https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
  (PKCS#1 `BEGIN RSA PRIVATE KEY` download format) — all fetched this session.
- **§3 — Documented/corroborated (community, not GitHub-authoritative, flagged as such in §3.4)** —
  https://github.com/orgs/community/discussions/173881 (App installation-token username leniency, Sep
  2025), https://github.com/orgs/community/discussions/164243 (installation-id churn on reinstall) — both
  found via search this session, explicitly reported as a WEAKER evidence tier than the official docs
  above, never conflated with them.
- Prior-milestone precedent for house style: `wiki/work/35_milestone_mesh-work-assignment/RESEARCH.md`
  (§ numbering, measured/documented framing, "constraint this imposes" per section).
