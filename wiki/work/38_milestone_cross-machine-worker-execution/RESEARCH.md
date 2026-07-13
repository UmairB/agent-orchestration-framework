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
- Prior-milestone precedent for house style: `wiki/work/35_milestone_mesh-work-assignment/RESEARCH.md`
  (§ numbering, measured/documented framing, "constraint this imposes" per section).
