---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Facts only, each with a source/measurement and the constraint it imposes.
  No decisions, no architecture, no scenarios — that is the architect's ADRs (DESIGN/ARCHITECTURE.md).
-->
# 43 · Mesh artifact authority — Research

Measured against this repo (`/Users/umairb/Source/personal/agent-orchestration-framework`, branch `main`,
commit `277ada5`), Node `v25.6.1`, git `2.50.1 (Apple Git-155)`, macOS (Darwin 25.5.0, this machine is
`umairs-mac-mini`, the mesh's Mac **worker** node per `.claude/rules/build-deploy-restart.md` — not the
Windows control node). Claude Code `2.1.220`. Every claim below is tagged **measured** (run/observed on
this machine), **documented** (vendor docs or an installed schema file, cited), or **inferred** (a
reasoned reading of measured/documented facts) — never asserted without one of the three. Where a §2
finding is Windows-specific and could not be run on this machine, it is explicitly flagged
**documented-only, not measured this pass**.

## Summary of constraints (read this first)

1. **§1 — `tool_input.file_path` is real for `Write`/`Edit`, but `NotebookEdit` carries
   `tool_input.notebook_path`, not `file_path`.** Measured live (a hermetic hook rig, real
   `PostToolUse` payloads captured). A hook keyed only on `tool_input.file_path` silently misses every
   notebook edit — the field name must be resolved per tool (`file_path` for `Write`/`Edit`,
   `notebook_path` for `NotebookEdit`), not read as one contract.
2. **§1 — `MultiEdit` does not exist in this installed version** (`2.1.220`) — corroborated by
   Anthropic's own removal (publicly reported ~Sept/Nov 2025). The milestone's "which tools carry a
   file path" question has exactly three answers: `Write`, `Edit`, `NotebookEdit`.
3. **§1 — `PostToolUse` cannot block; it can only report.** Documented + schema-confirmed: exit code 2
   shows stderr to the model but the tool already ran; there is no coded "reject the write" path from
   this hook event. A design that needs to REFUSE a write (vs. merely enqueue it) cannot use
   `PostToolUse` for that.
4. **§1 — a fourth hook TYPE exists beside `command`: `http`.** The installed settings schema
   (`claude-code-settings.schema.json`) declares five hook variants — `command`, `prompt`, `agent`,
   `http`, `mcp_tool`. An `http` hook POSTs the exact same JSON payload Claude Code would hand a command
   hook on stdin, straight to a URL, **with no process spawned at all** — gated by an
   `allowedHttpHookUrls` allowlist setting. This is a materially different, and measured-faster,
   mechanism than "thin node script" for the sync trigger (§2).
5. **§1 — the `command` hook has an exec form (`args`) that bypasses the shell entirely**, and the
   shell form differs by OS (`bash`/Git-Bash on POSIX, PowerShell on Windows without Git Bash) —
   directly relevant to a hook command that must run identically on the Windows control node, this Mac
   worker, and the WSL worker.
6. **§2 — process-spawn is the dominant cost, and it varies ~8× by binary choice.** Measured on this
   machine: bare `node -e ""` ≈ 23ms; a `node`-based enqueue (file append, Unix-domain-socket write) ≈
   24-26ms; a `node`-based HTTP POST (via `fetch`) ≈ 41ms; a `curl` POST to a local HTTP server ≈ 5.5ms.
   The full `aof` CLI (`aof session ping`) ≈ 70-80ms — roughly 3× a bare node boot. An `http`-type hook
   (§1.4) spawns nothing, so its cost is not in this table at all — it is bounded by the daemon's own
   response latency, not process-start latency.
7. **§3 — the merge hazard is real, present in `src/` today, and NOT the same code path as the m42
   leg d4 `writeLock` defect, but the SAME failure shape.** `claudeSettingsJson()` regenerates
   `.claude/settings.json` **wholesale** from `config.hooks`/`config.settings` alone; `planApplyActions`
   (`src/render-plan.mjs:48`) writes an **ungated "existing file will be overwritten"** action for any
   file that exists on disk but has no PRIOR lock entry — exactly this repo's hand-authored
   `.claude/settings.json` today. The four hand-wired sections (`SessionStart`/`UserPromptSubmit`/
   `SessionEnd`/`PreToolUse` hooks, `permissions.deny`, `sandbox.filesystem`, `enabledPlugins`,
   `extraKnownMarketplaces`) have **zero representation** in the config DSL and would be silently
   dropped the moment a `claude`-runtime hook or `settings.claude` entry is added to
   `.aof/aof.config.json` and `aof work init`/`update` (or `assets:apply`) runs. The sanctioned cure
   pattern already exists twice in the codebase (`mergeLock`, `src/lock.mjs:37-50`; `writeSidecarPatch`,
   `src/node-identity.mjs:74-95`) — read, overlay only the caller's own keys, write the union.
8. **§3 — the 34-file bundle installer (agents+commands+skills, content-hashed via
   `src/bundle/manifest.json`) never touches `.claude/settings.json` at all** — confirmed, zero entries.
   The hook-writing pipeline is a wholly separate mechanism (`src/adapters.mjs` → `src/runtime-config.mjs`
   `claudeSettingsJson()` → `src/render-plan.mjs`/`src/fs.mjs` `writeText`, an atomic whole-file
   temp-then-rename), gated by `config.hooks`/`config.settings`, which today carries no `claude`-runtime
   entries for this repo (`.aof/aof.config.json` has no `hooks` key) — the hazard is dormant, not absent.
9. **§4 — `work_item_docs`/`work_item_runs` already carry BOTH a reporting-node id (`node_id`) and a
   timestamp (`updated_at`) per row**, upserted per `(workspace_id, ref, doc|run_id)` since schema v5
   (`src/global-work-store.mjs:267-285`, writer `upsertWorkItemContent`, `:636-679`). Directive 3's
   "cache with a TTL" is therefore, for artifact CONTENT, mostly a read-side interpretation of columns
   that already exist, not a new column. `work_items` (the item-STATE projection) has **neither** column
   today and is wholesale DELETE+INSERT per workspace on every publish (`wholesaleDelete`,
   `:51-61`, called at `:459-460` inside `publishWorkspaceSnapshot`) — this table is where a real schema
   migration (a v8) is needed if it stops being disk-rebuilt and gains multiple writers.
10. **§4 — the fact/projection split (`src/effects/stores.mjs`) is schema-enforced, not a comment**:
    `wholesaleDelete` throws before running if the target table is not classified `"projection"`
    (`global-work-store.mjs:51-61`). `work_items` is classified `projection, rebuiltBy:
    "publishWorkspaceSnapshot"` — i.e. today's classification is an accurate description of the disease
    the milestone is curing (SPEC's "the projection that must stop being rebuilt from disk" is this
    exact table/classification pair), and any change to that classification is itself a change this
    registry gates structurally.
11. **§5 — the measured call-site count is 33, across 21 modules, not "25 across 18."** A verified grep
    (with two genuine false-positive files excluded — `catalog.mjs`/`setup-ui.mjs`'s unrelated
    `listItems()` and `planning-prd.mjs`'s unrelated markdown-list `listItems()`) finds 33 real calls to
    `work.mjs`'s `listItems`/`findWork`/`nextWork`/`listStream` across 21 modules. STATE.md's own
    "control-side readers that must move" PROSE list (11 modules) is internally consistent with this
    measurement; the "25/18" summary figure appears to undercount by roughly the worker-side +
    structural call sites this pass separately confirms stay in place (§5).
12. **§5 — one real ambiguity, not resolvable by grep: `work-doctor.mjs`'s single `listItems` call
    feeds SIX check-groups of two different natures** — some are folder↔frontmatter structural checks
    (SPEC's stated reason `doctor` stays disk-based) and some (`statusCoherenceGroup`,
    `lifecycleCompletenessGroup`, `freshnessGroup`) consume ITEM STATE/status, which is exactly what
    directive 3 wants answered from the cache. SPEC.md's out-of-scope bullet says `doctor` "stays
    local"; STATE.md's migration-surface paragraph names `work-doctor` among the modules "that must
    move." Both citations are accurate about different parts of the SAME snapshot call — this is
    reported as an open question, not resolved here.

---

## § 1 — The `PostToolUse` hook contract (Claude Code `2.1.220`, measured + documented)

**Question.** Exact stdin payload shape; which tools carry a file path; matcher syntax; exit-code/stdout
semantics; timeout.

### 1.1 This repo's existing, working hooks (the in-repo precedent)

- **Measured** (`.claude/settings.json:1-21`): `SessionStart`→`aof session start`,
  `UserPromptSubmit`→`aof session ping`, `SessionEnd`→`aof session end`, all with empty `matcher: ""`
  (fires on every event of that kind); a `PreToolUse` guard scoped `matcher: "Bash|PowerShell"` →
  `node ".claude/hooks/aof/guard-test-isolation.mjs"`; `PostToolUse: []` (present, empty — matching
  STATE.md's framing that the slot exists but is unused).
- **Measured** (`.claude/hooks/aof/guard-test-isolation.mjs:11-28`): the real, working precedent for
  reading a hook's stdin payload — `readFileSync(0, "utf8")`, `JSON.parse`, then
  `payload?.tool_input?.command`. Confirms `tool_input` is the field name in production use in this
  repo today (`PreToolUse`, but the `PreToolUse`/`PostToolUse` common-field shape is identical per §1.2).
  Exit 2 + a `stderr` write is this hook's own blocking mechanism (works for `PreToolUse`; does **not**
  work for `PostToolUse`, §1.4).

### 1.2 The real `PostToolUse` payload — measured live, not just documented

Built a hermetic test rig in the session scratchpad (mirrors the precedent set by milestone 38's own
RESEARCH.md §2.2): a `PostToolUse` hook on `matcher: "Write|Edit|NotebookEdit"` that appends its raw
stdin to a log file, wired via `--settings <rig>.json --setting-sources project`, then ran
`claude -p "…create note.txt via Write, Edit it, create nb.ipynb via Write, edit its cell via
NotebookEdit…"` (`--allowedTools "Write,Edit,NotebookEdit"`) in an isolated scratch directory (no repo
file touched). Four hooks fired, one per tool call, each with the full JSON on stdin:

- **Common fields on every `PostToolUse` payload** (measured): `session_id`, `prompt_id`,
  `transcript_path`, `cwd`, `permission_mode`, `effort`, `hook_event_name: "PostToolUse"`, `tool_name`,
  `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`.
- **`Write`** — `tool_input: { file_path, content }`. Measured:
  `{"file_path": ".../work/note.txt", "content": "hello"}`.
- **`Edit`** — `tool_input: { file_path, old_string, new_string, replace_all }`. Measured:
  `{"file_path": ".../work/note.txt", "old_string": "hello", "new_string": "hello world",
  "replace_all": false}`.
- **`NotebookEdit`** — `tool_input: { notebook_path, cell_id, new_source, edit_mode }` — **NOT**
  `file_path`. Measured: `{"notebook_path": ".../work/nb.ipynb", "cell_id": "cell-0", "new_source":
  "print(2)", "edit_mode": "replace"}`. **This is the one field-name exception the milestone's
  "hangs on `tool_input.file_path`" framing must account for.**
- **`MultiEdit`** — measured absent. The tool was never offered/available to allow in this session
  (only `Write`/`Edit`/`NotebookEdit` exist as of `2.1.220`); corroborated by a public report that
  Anthropic removed the `MultiEdit` tool from Claude Code (WebSearch, multiple independent sources:
  a GitHub issue thread and a Hacker News discussion dated ~Sept/Nov 2025).

### 1.3 Matcher syntax — documented + schema-confirmed

- **Documented** (fetched `code.claude.com/docs/en/hooks.md`): exact string match on letters, digits,
  `_`, `-`, spaces, `,`, and `\|` (so `"Edit|Write"` or the newer `"Edit, Write"` — v2.1.191+ — are OR
  matches); any other character routes the matcher through **JavaScript `RegExp.prototype.test`,
  unanchored** (so `"^Notebook"`, `"mcp__memory__.*"` are real regexes, not globs).
- **Measured, live:** `matcher: "Write|Edit|NotebookEdit"` correctly matched all three tools' hook
  firings in the rig above — the pipe-OR form works as documented.

### 1.4 Exit code / stdout semantics — documented, and load-bearing for `PostToolUse` specifically

- **Documented:** exit `0` → stdout parsed for JSON control fields but (for `PostToolUse`) **written
  only to the debug log, never shown in the transcript**; exit `2` → stderr shown to the model, but
  **the tool has already run — `PostToolUse` cannot block it**; any other exit → non-blocking error,
  stderr shown, execution continues. This is the single fact that rules out "refuse the write" as a
  `PostToolUse` responsibility — it can only ever observe-and-report, never veto.
- **Timeout, documented + schema-confirmed** (`claude-code-settings.schema.json`,
  `hooks.additionalProperties.items.properties.hooks.items.anyOf[0].properties.timeout`: `"number",
  exclusiveMinimum: 0`, no fixed default encoded in the schema itself): the fetched docs state the
  default is **600s** for `command`/`http`/`mcp_tool` hooks (lowered to 30s for `UserPromptSubmit`,
  10s for `MessageDisplay`), independently configurable per hook entry.

### 1.5 A fourth hook type — `http` — measured working, zero process spawn

- **Documented** (installed schema, `claude-code-settings.schema.json`,
  `hooks.additionalProperties.items.properties.hooks.items.anyOf`): five hook variants exist —
  `command`, `prompt`, `agent`, `http`, `mcp_tool`. The `http` variant's schema:
  `{ type: "http", url (required, uri), headers?, allowedEnvVars?, timeout?, once? }`. Docs
  (`code.claude.com/docs/en/hooks.md`, fetched): *"Claude Code sends the hook's JSON input as the POST
  request body with `Content-Type: application/json`. The response body uses the same JSON output
  format as command hooks."* — i.e. an `http` hook receives **the identical payload** described in §1.2,
  over the wire instead of over stdin, with **no child process created by the harness at all**.
- **Gated by an allowlist:** `allowedHttpHookUrls` (top-level settings key, confirmed present in the
  installed schema's property list) — *"When set, HTTP hooks with non-matching URLs are blocked. If
  undefined, all URLs are allowed. If empty array, no HTTP hooks are allowed."* No special-casing of
  `localhost`/`127.0.0.1` is documented — a loopback daemon URL still needs an explicit allow entry (or
  the setting left undefined) to be reachable.
- **Measured, live:** wired a `PostToolUse` hook `{ type: "http", url: "http://127.0.0.1:18735/hook",
  timeout: 10 }` with `allowedHttpHookUrls: ["http://127.0.0.1:18735/*"]`, ran a single `Write` through
  `claude -p`, and a plain `http.createServer` on that port received the POST with a body 1145 bytes
  long (the same shape as §1.2's stdin capture) — confirmed the mechanism fires and reaches an ordinary
  local HTTP listener with no extra plumbing.

### 1.6 The `command` hook's exec form and the Windows/POSIX shell split — documented, cross-platform-relevant

- **Documented** (fetched hooks reference): when a hook entry supplies `args` alongside `command`,
  `command` is resolved as an executable on `PATH` and spawned directly with `args` as its argv —
  **no shell at all**, so quoting/backtick/`$`-injection concerns vanish and a path with spaces needs
  no escaping. Caveat, verbatim: *"On Windows, exec form requires `command` to resolve to a real
  executable such as a `.exe`. The `.cmd`/`.bat` shims npm/npx/eslint install … are not executables and
  can't be spawned without a shell"* — so `"command": "node", "args": [...]` is the safe exec-form
  shape for a `node`-based hook cross-platform (`node.exe`/`node` both resolve as real executables).
- **Documented:** the shell FORM (`args` absent) defaults to `bash` on POSIX/macOS, **Git Bash on
  Windows if installed, else PowerShell** — a genuinely different interpreter depending on what's
  installed on the Windows control node, unless the hook entry pins `"shell": "powershell"` or
  `"bash"` explicitly. This is a real cross-platform authoring hazard for any hook command string that
  uses POSIX-only shell syntax.

---

## § 2 — Hook latency budget: what the "thin enqueue" has to beat (measured, this machine)

**Question.** What are real per-invocation costs for candidate enqueue mechanisms, so the architect
picks with numbers?

### 2.1 Baselines — process boot cost dominates every `command`-type hook

Measured with a `node:child_process.spawnSync` micro-bench (20 iterations each, `process.hrtime.bigint()`
around each spawn, avg/median reported) on this Mac (Apple Silicon, Node v25.6.1):

| Mechanism | avg | median | What it measures |
|---|---|---|---|
| `node -e ""` (bare boot) | 23.35ms | 23.17ms | Node interpreter startup alone |
| `node append.mjs` (fs.appendFileSync, one line) | 24.65ms | 24.64ms | bare boot + one sync file write |
| `node uds-client.mjs` (connect+write+close a Unix domain socket) | 26.24ms | 26.25ms | bare boot + local IPC round-trip |
| `node http-client.mjs` (`fetch` POST to a local `http.createServer`) | 40.99ms | 40.88ms | bare boot + `fetch`/undici init + HTTP round-trip |
| `curl -s -X POST … http://127.0.0.1:.../hook` | 5.53ms | 5.30ms | curl's own (much smaller) process boot + HTTP round-trip |
| `curl --version` (curl boot alone, no network) | 4.54ms | 4.56ms | curl's own process boot |

Also measured with coarse shell `time -p` (10 runs each, corroborating the above): `aof session ping
--workspace … --repo … --assistant claude` (a full, successful CLI invocation, module graph loaded +
SQLite store opened) ≈ **70-80ms**; bare `node -e ""` ≈ **20-30ms** on the same tool. `aof session ping`
is ~3× a bare node boot — this is the concrete number "booting the full CLI per edit" (STATE.md's
concern) has to beat, confirmed directly rather than assumed.

**Constraint.** For any `command`-type hook, the choice of BINARY dominates cost far more than the
enqueue mechanism itself: a `node`-based enqueue (any of file/socket/HTTP) costs 24-41ms almost
entirely from Node's own interpreter boot; a `curl`-based HTTP POST costs ~5.5ms because curl's process
boot is ~4.5ms. Rewriting the same HTTP-POST enqueue from `node` to `curl` is roughly an 8× latency
cut, with zero change to the daemon-side protocol.

### 2.2 The `http` hook type sidesteps process-spawn cost entirely (§1.5)

Because Claude Code's own already-running process performs the POST (§1.5), an `http`-type
`PostToolUse` hook has **no process-spawn cost on the critical path at all** — its latency is bounded
by the daemon's own response time for a loopback connection, which the curl measurement above (~1ms of
that 5.5ms is curl's own boot; the rest is TCP connect + a trivial handler) suggests is low
single-digit milliseconds for a daemon that responds immediately. **Not measured directly as an
isolated number** (isolating just the harness's internal HTTP-client latency from the total turn
duration was not attempted — total turn duration is dominated by LLM inference time, which swamps any
few-millisecond hook difference) — this is flagged as an open item for a `@manual` timing check once a
real daemon endpoint exists, not a blocking unknown for the architecture choice itself (the mechanism
being cheaper than any spawn-based alternative is well-grounded by construction: zero processes started
either way it is compared).

### 2.3 What's actually available for a hook → already-running daemon handoff

Given a worker daemon that is ALREADY running (the mesh worker process), the hook firing on every
`Write`/`Edit`/`NotebookEdit` needs to hand it one message. Measured/documented options, in the same
order as §2.1's table:

- **File append** (`fs.appendFileSync` to a queue file the daemon tails/polls): fully portable
  (Windows/macOS/WSL — plain filesystem write), ~1-2ms of actual work over bare node boot (measured).
  Needs the daemon to notice new lines — a poll interval, not push — trading a small latency floor for
  zero new listening surface.
- **Local socket** (Node's `net` module): **documented** (`nodejs.org/api/net.html`, fetched) — Node's
  `net.createServer()`/`net.connect()` present ONE API for both a POSIX Unix-domain socket (a
  filesystem pathname, unlinked on close) and a Windows named pipe (**must** reference an entry under
  `\\?\pipe\` or `\\.\pipe\` — a different path syntax, not a different API call). *"Despite these
  implementation differences, the API is identical across platforms."* — portable across all three
  target machines (Windows control, this Mac worker, WSL) provided the path is chosen per-OS at
  runtime; **not measured on Windows or WSL this pass** (measured only the POSIX UDS form, §2.1, on
  this Mac).
- **HTTP POST to a local port** (loopback `http://127.0.0.1:<port>/…`): fully portable (TCP loopback
  exists identically on all three targets) — measured via `curl` (~5.5ms) and via `node fetch`
  (~41ms, dominated by node's own boot).
- **The Claude Code `http` hook type** (§1.5, §2.2): most portable of all, since it removes the
  process-spawn variable (and therefore the OS-shell-form question, §1.6) entirely — the harness's own
  network stack does the POST, not a hook-authored script. Its one real cost is the
  `allowedHttpHookUrls` allowlist entry that must ship alongside it (a settings-merge concern, §3, not
  a latency concern).

**Constraint this imposes.** All three enqueue-payload SHAPES (file, socket, HTTP) are cheap once a
process is already running for them; the dominant, measured cost is whether that hook fires as a
brand-new `node` process (~23-41ms), a brand-new small native binary like `curl` (~5.5ms), or no new
process at all (`http` hook type, §1.5). None of the three payload shapes is itself the bottleneck.

---

## § 3 — The `.claude/settings.json` merge surface (measured, source-read)

**Question.** What does the asset bundle manage today; does it write `settings.json`; what is the
Codex-side precedent; what exact pattern must a merge mirror.

### 3.1 The bundle installer (34 files) never touches `settings.json` — confirmed exactly

- **Measured** (`src/bundle/manifest.json`, parsed): 34 entries under `.claude/` — 8 agents, 25
  commands + `prime.md`-class files (per the manifest's own `.claude/agents`/`.claude/commands`/
  `.claude/skills` paths), zero entries for `.claude/settings.json`. Confirms STATE.md's "34 files…
  does not manage `.claude/settings.json`" verbatim (this repo's on-disk `.claude/agents`+
  `.claude/commands` currently total 33 — one file short of the shipped manifest's 34, because this
  checkout is missing the 3 `.claude/skills/codex-*/SKILL.md` entries the manifest lists but has 2
  hand-added files (`code-reviewer.md`, `prime.md`) the manifest doesn't — a minor, non-blocking drift
  noted for completeness, not investigated further).

### 3.2 The Codex-side precedent — `.codex/hooks.json` — is a WHOLE-FILE render, not a merge

- **Measured** (`src/bundle/manifest.json:522-529`): `.codex/hooks.json` is one bundle entry,
  `resource.kind: "hooks"`, content-addressed by sha256 like every other bundle file — i.e. it is
  installed the SAME way as an agent/command file: wholesale write, hash-checked. Its content
  (`src/bundle/hooks/codex-session-*.json`) wires `UserPromptSubmit`/`SessionStart`/`Stop` to
  `aof session ping|start --assistant codex`. **This precedent is not itself a merge pattern to copy —
  it works today only because `.codex/hooks.json` is an AOF-EXCLUSIVE file** (nothing hand-authors
  content into it), unlike `.claude/settings.json` which this repo genuinely hand-maintains today
  (permissions, sandbox, plugin config) alongside any hooks aof might add.

### 3.3 The REAL merge/render pipeline for `.claude/settings.json` — a separate, wholesale-write mechanism, dormant but present

- **Measured** (`src/adapters.mjs:97-111`): `renderRuntimeConfigOutputs` renders `.claude/settings.json`
  IF EITHER `claudeHooks.length > 0` OR `hasRuntimeSettings(config.settings, "claude")` — calling
  `claudeSettingsJson({ hooks: claudeHooks, settings: config.settings })`
  (`src/runtime-config.mjs:21-28`), which builds the file's ENTIRE body from exactly those two inputs
  and nothing else (`body = { ...runtimeSettings(settings, "claude") }; if (renderedHooks) body.hooks =
  renderedHooks;`).
- **Measured** (`.aof/aof.config.json`, this repo's real config): top-level keys are `$schema, name,
  work, memory, resources, packages, runtimes, mesh` — **no `hooks` key, no `settings` key at all.**
  This is exactly why the hazard is dormant today: `claudeHooks.length === 0` and
  `hasRuntimeSettings(undefined, "claude") === false`, so `renderRuntimeConfigOutputs` never emits a
  `.claude/settings.json` output, and nothing in the render pipeline currently touches the hand-authored
  file. The moment a `claude`-runtime hook (or a `settings.claude` entry) is added to
  `.aof/aof.config.json`, this changes.
- **Measured** (`src/render-plan.mjs:12-49`, `planApplyActions`): the drift-protection logic that would
  normally guard a generated file is keyed on a PRIOR LOCK ENTRY (`priorEntries`, sourced from the
  install lock's `files[]`). For a file that EXISTS on disk but has **no** prior lock entry — exactly
  this repo's hand-authored `.claude/settings.json`, which the aof lock has never recorded because the
  bundle never wrote it — the code path is:
  ```
  if (!currentHash) { … "create" … }                              // false: file exists
  if (gitignore && !prior && hash differs) { … "drift-warning" … } // only for kind:"gitignore"
  if (currentHash === output.hash) { … "skip" … }                  // false: content differs
  if (prior && hash differs && !force) { … "drift-warning" … }     // false: prior is undefined
  if (prior && hash differs && force) { … "update", forced … }     // false: prior is undefined
  actions.push(action("update", output, prior ? "…changed" : "existing file will be overwritten"));
  ```
  i.e. it falls straight through every guard to an **UNGATED `"update"` / "existing file will be
  overwritten"** — no `--force` required, no drift warning surfaced, straight overwrite via
  `executeApplyActions` → `writeText` (`src/fs.mjs:16-36`, an atomic temp-write-then-rename, so the
  overwrite itself is clean — but total, not merged).
- **Measured** (`src/work-init.mjs:30,91`, `src/work-update.mjs:27,100`): both `aof work init`
  (`previousLock = null`, ALWAYS "fresh install" semantics — i.e. `work init` treats every existing
  file with no lock entry as safe to overwrite) and `aof work update` (uses the real previous lock, so
  only files IT previously wrote get drift protection) route through exactly this `planApplyActions` →
  `executeApplyActions` pipeline. **`.claude/settings.json` is never in aof's own lock today** (the
  bundle doesn't write it, per §3.1), so BOTH commands hit the ungated "existing file will be
  overwritten" branch the first time a `claude` hook/settings entry is configured, with no `--force`
  gate at all — this is worse than the drift-warning case, not equivalent to it.

### 3.4 The sanctioned cure pattern already exists twice — the one to mirror

- **`mergeLock(lockPath, patch)`** (`src/lock.mjs:37-50`, m42 wave (d) leg d4 — the exact defect
  STATE.md cites): *"`aof init` and `project migrate` wrote the WHOLE lock document, so either one run
  against a workspace that already had work or planning installed silently deleted the other's
  section."* The cure, verbatim from the source comment: *"read what is there, overlay THIS caller's
  keys, write the union. Absent/torn lock reads as `{}` — a fresh install, never a crash. Keys the
  patch does not name survive byte-equivalent."* Implementation: `{ ...base, ...patch }` at the
  top level, then `writeLock` (still a wholesale WRITE of the merged object, but the MERGE happened in
  memory first, before the write).
- **`writeSidecarPatch(sidecarPath, patch)`** (`src/node-identity.mjs:74-95`, 22/R2 — "one writer per
  config subtree"): a second, independent precedent — shallow-merges `patch` over the CURRENT sidecar
  (an `undefined` patch value DELETES that key, letting a caller retire a field), skips the write
  entirely if the merged result is byte-identical to what's already there (`writeText` only called on
  an actual change).
- **The pattern common to both, that a `.claude/settings.json` merge must mirror:** READ the current
  file (tolerate absent/torn as `{}`), OVERLAY only the keys the caller (aof's hook config) actually
  owns (i.e. `hooks.PostToolUse`'s aof-authored entries, not the WHOLE `hooks` object — a real
  operator hook on another event, or another `PostToolUse` matcher, must survive), WRITE the union.
  Neither existing precedent operates below the TOP-LEVEL key (both replace a whole top-level
  subtree/key on a match) — `.claude/settings.json`'s hazard is one level deeper: the file has ~140
  independent top-level keys (measured, `claude-code-settings.schema.json` property list — `hooks`,
  `permissions`, `sandbox`, `enabledPlugins`, `extraKnownMarketplaces`, `env`, `model`, … all siblings),
  and even within `hooks`, four DIFFERENT event keys are each independently hand-wired
  (`SessionStart`/`UserPromptSubmit`/`SessionEnd`/`PreToolUse`) plus the target `PostToolUse` this
  milestone adds — so the merge target is not "one key" but "one hook array entry inside one event key
  inside one top-level key," a narrower and more surgical splice than either existing precedent
  performs today. Neither `mergeLock` nor `writeSidecarPatch` is directly reusable as-is; both are the
  RIGHT SHAPE of fix to extend.

---

## § 4 — SQLite staleness / `syncedAt` reality (`src/global-work-store.mjs`, measured, full read)

**Question.** Current schema version, tables, existing timestamp/reporting-node columns, the wholesale
delete+rebuild mechanics, and the fact/projection classification.

### 4.1 Schema version and tables

- **`GLOBAL_WORK_SCHEMA_VERSION = 7`** (`global-work-store.mjs:11`). Migration is in-place
  (`migrateSchema`, `:158-359`): `CREATE TABLE IF NOT EXISTS` for the base shape, plus three explicit,
  idempotent `ALTER TABLE … ADD COLUMN` calls for columns added post-v3 (`clone_url` on
  `global_workspace_descriptors`, `session_id` and `code` on `global_assignments`) — the comments are
  explicit that `CREATE TABLE IF NOT EXISTS` never adds a column to an existing table, so every
  column added after a table's birth needs its own guarded `ALTER`.
- **Tables** (`:161-301`): `aof_schema` (meta), `workspaces`, `work_items`, `projection_metadata`
  (meta), `projection_errors`, `global_nodes`, `global_workspace_descriptors`, `global_node_workspaces`,
  `global_assignments` (schema v3), `work_item_docs` + `work_item_runs` (schema v5), `node_logs`
  (schema v6). `global_item_branches` and `global_recovery_pushes` are classified in
  `effects/stores.mjs` (§4.4) but their `CREATE TABLE` lives in their OWN feature modules, lazily
  (confirmed by `remapRefKeyedTables`'s own comment, `:401-404`: "the side tables are created lazily by
  their own feature module … a store that has never seen a branch/assignment simply has nothing to
  remap there" — not a table this module itself creates).

### 4.2 Which columns already carry a timestamp / reporting-node id — measured, table by table

| Table | Timestamp column(s) | Reporting-node column | Notes |
|---|---|---|---|
| `work_items` | **none** | **none** | The item-state projection; wholesale rebuilt (§4.3) |
| `work_item_docs` | `updated_at` | `node_id` | Schema v5, `:267-275`; per-`(ref,doc)` upsert |
| `work_item_runs` | `updated_at` | `node_id` | Schema v5, `:276-285`; per-`(ref,run_id)` upsert |
| `workspaces` | `last_published_at` | — (single-writer local table) | |
| `global_assignments` | `assigned_at`, `updated_at`, `reclaimed_at` | `target_node_id` (assignee, not reporter) | No "which node reported this row" column |
| `node_logs` | `at` (payload-carried) | `node_id` | Schema v6, `:292-301` |
| `projection_errors` | `occurred_at` | — | |

**Constraint this imposes.** Directive 3 ("cache the artifacts in SQLite, with a TTL") is, for
`work_item_docs`/`work_item_runs` (the CONTENT tables), **already structurally satisfied at the column
level** — `node_id` + `updated_at` exist on every row today (§4.2), upserted by the ONE writer
`upsertWorkItemContent` (`:636-679`). What the staleness story must ADD there is READ-SIDE
interpretation (compare `updated_at` to a TTL window) plus the board's stale badge/Resync UI — not a
schema migration. `work_items` (the item-STATE table) is the one table genuinely missing both columns
— if it stops being wholesale-rebuilt-from-disk (SPEC's stated goal) and instead gains multiple
per-node writers, it needs its own schema v8 migration adding the same `node_id`/`updated_at` shape
`work_item_docs` already proves out, following the SAME idempotent guarded-`ALTER` pattern used for
`clone_url`/`session_id`/`code` (§4.1).

### 4.3 The wholesale delete + rebuild — measured, current line numbers (a correction to SPEC.md's citation)

- **The guard** (`wholesaleDelete`, `:45-61`): looks up `tableClass(table)` (§4.4) and **throws before
  running** if the class is not `"projection"` — `Refusing wholesale delete of ${table} — classified
  "${cls}" (only projection tables are rebuilt by sweep).` This is schema-level gating, not a comment
  — a caller cannot wholesale-delete a fact table even by mistake.
- **The call sites** (`publishWorkspaceSnapshot`, `:436-504`, calls at `:459-460`):
  `wholesaleDelete(db, "work_items", workspaceId); wholesaleDelete(db, "projection_errors",
  workspaceId);` — both scoped `WHERE workspace_id = ?` (one workspace's rows, not the whole table
  across every workspace), immediately followed by a full re-`INSERT` of every row from
  `items.rows` (sourced from `readWorkspaceProjectionItems`, `:536-567`, itself a fresh `listItems`
  disk read, §5), all inside one `BEGIN IMMEDIATE … COMMIT` transaction.
  **Correction:** SPEC.md cites `global-work-store.mjs:431` and `:417` for this mechanic; at the
  measured HEAD (`277ada5`) the actual `wholesaleDelete` calls are at **`:459-460`**, inside a function
  that starts at `:436` — the mechanic SPEC.md describes is exactly right, only the line numbers have
  drifted (unsurprising given the intervening m42 wave (d) commits this branch's own log shows).
- **The nuance the call sites reveal that a pure line-citation misses:** `readWorkspaceProjectionItems`
  (the disk read feeding the rebuild) is itself CORRECT and necessary — a node reading its OWN local
  checkout to know its own current item state is not the disease (§5 elaborates: this same function is
  also what the WORKER uses to build the snapshot frame it streams to control). **The disease is
  specifically that `publishWorkspaceSnapshot`, when it runs as part of the CONTROL's periodic tick
  (`mesh-launcher.mjs:732`, `capturePropagation` → `publishGlobalWorkSnapshot`), wholesale-deletes and
  rebuilds `work_items` for that workspace using ONLY the calling (control) node's own local slice** —
  clobbering whatever a worker's stream had contributed for items the worker, not the control, is
  actively authoring. The read primitive is fine; the wholesale-delete-and-rebuild WRAPPED AROUND that
  read, when run by a node that is not the sole author of every row in the table, is what SPEC targets.

### 4.4 The fact/projection classification (`src/effects/stores.mjs`) — measured, full registry

- **Declared taxonomy** (`:8-17`, verbatim): `fact` — "authored or observed state whose truth lives
  HERE… losing it loses truth: no local rebuild reconstructs it… written ONLY by its declared writer
  module(s), one row at a time — never wholesale." `projection` — "derived from facts that live
  elsewhere… safe to delete + rebuild; healing one is a re-publish/reconcile, never a patch." `meta` —
  "the store's own bookkeeping."
- **Measured registry** (`TABLE_CLASSIFICATION`, `:36-89`): `work_items`, `workspaces`,
  `projection_errors`, `global_nodes`, `global_workspace_descriptors`, `global_node_workspaces` are all
  `"projection"` (each names its `rebuiltBy` publisher). `global_assignments`,
  `global_assignment_directives`, `global_item_branches`, `global_recovery_pushes`, `work_item_docs`,
  `work_item_runs`, `node_logs`, plus the effects journal's own `events`/`effect_steps` are all
  `"fact"`, each naming its writer module(s) explicitly. `aof_schema`/`projection_metadata` are
  `"meta"`.
- **This registry is exactly the mechanism that SHOULD gate any future change here.** `work_items`
  being classified `projection, rebuiltBy: publishWorkspaceSnapshot` is TODAY'S accurate description —
  if the architect decides `work_items` should become a multi-writer, upserted table (mirroring
  `work_item_docs`'s shape) rather than a wholesale-rebuilt one, that is a **reclassification** (to
  `fact`, or a new class) that this registry structurally enforces once made — the totality/writer-
  isolation fitness function this file's own header describes
  (`test/arch/acd-fact-projection-split`, referenced in the header comment) would need to gate the new
  shape, not just the old one.

---

## § 5 — The disk-reader migration surface (measured, exhaustive grep + per-site read)

**Question.** Verify "25 call sites across 18 modules"; report the real per-module list split into
control-side (migrate), worker-side (do not migrate), and structural (stays on disk).

### 5.1 The measured count: 33 real call sites across 21 modules, not 25/18

Grepped `src/**/*.mjs` for literal `listItems(`, `findWork(`, `nextWork(`, `listStream(` calls
(excluding `src/work.mjs`/`src/next.mjs`, the definitions themselves, and comment-only lines), then
hand-verified every hit against its import statement to exclude false positives. **Three files are
false positives, confirmed by reading their imports/bodies — none of them import from `work.mjs`:**
`src/catalog.mjs:17` (`listItems()` is a method on an unrelated in-memory resource `Catalog` class —
provisionable MCP servers/skills, not work items), `src/setup-ui.mjs:103` (calls that same
`catalog.listItems()`), and `src/planning-prd.mjs:214,240,264,269,274` (a local, module-private
`listItems(lines)` function that parses markdown bullet lists in a PRD document — no import from
`work.mjs` at all). Excluding these, the real count is:

**33 call sites, 21 modules.** STATE.md's own "25 disk-read call sites across 18 modules" figure
appears to undercount — most plausibly because it counted only the CONTROL-SIDE readers its own
"must move" prose enumerates (11 named modules) plus the explicitly-carved-out worker module
(`mesh-worker-execution.mjs`, 5 call sites) without also counting the structural/reindex-adjacent call
sites this pass separately confirms belong in category (c) below (`work-reindex.mjs` ×3,
`insert-shared.mjs` ×4, `effects/table.mjs`, `effects/reconcile.mjs`, `mesh-launcher.mjs`'s injected
`listItemsFn`). This is reported as a correction, not a discrepancy to be explained away — the
per-module list below is the thing to build the story boundary from, not either summary number.

### 5.2 (a) Control-side readers that must migrate to the cache — 13 modules, 18 call sites

| Module | Call site(s) | What it does |
|---|---|---|
| `src/commands/next.mjs` | `:25` `nextWork(ws.workDir, scope)` | `work:next` — pure disk today, explicitly cited in SPEC.md line 47 |
| `src/commands/find.mjs` | `:27` `findWork(ctx.workspace.workDir, input.query)` | `work:find` |
| `src/commands/resolve.mjs` | `:18`, `:28` `findWork(workDir, ref)` | the shared resolver `doc`/`tasks`/`feedback` sit on (per SPEC.md line 48-49) |
| `src/commands/list.mjs` | `:27` `listStream(ctx.workspace.workDir)` | `work:list` |
| `src/commands/run-start.mjs` | `:119` `listItems(ws.workDir)` | resolving the item before minting a run |
| `src/commands/mesh-heartbeat.mjs` | `:70` `listItems(ws.workDir)` | named explicitly in STATE.md |
| `src/commands/promote-gap-to-chore.mjs` | `:95` `listItems(workDir)` | named explicitly in STATE.md |
| `src/commands/notion-associate.mjs` | `:120` `listItems(ctx.workspace.workDir)` | "the notion sync/associate pair" (STATE.md) |
| `src/notion/sync-work.mjs` | `:121` `listItems(workspace.workDir)` | "the notion sync/associate pair" (STATE.md) |
| `src/memory/local-indexing.mjs` | `:596` `listItems(workDir)` | named explicitly in STATE.md |
| `src/mesh-assignment.mjs` | `:111`, `:177` `findWork(workspace.workDir, ref)` | assign/withdraw — resolves the ref before minting/checking a `global_assignments` row; **not named in STATE.md's prose list but is control-side by its own file header** ("the ASSIGN/WITHDRAW cores… below the command layer") and is the exact seam `43_story_item-lock`'s "write side does not use the scope rule" finding (STATE.md, "Two lock holes") already points at |
| `src/mesh-assignment-reclaim.mjs` | `:134` `findWork(workspace.workDir, row.itemRef)` | its own file header, verbatim: "the **CONTROL-side** dual-staleness reclaim path" |
| `src/mesh-launcher.mjs` | `:390` (`listItemsFn(workspace.workDir)`, injected default `listItems` wired at `:493`) | `assembleActiveRunsAndSubsumedWorkspaces` — feeds the control's periodic republish tick; the literal disease mechanism SPEC.md cites at `mesh-launcher.mjs:732` |

### 5.3 (b) Worker-side reads that must NOT migrate — 2 modules, 7 call sites

| Module | Call site(s) | Why it stays |
|---|---|---|
| `src/mesh-worker-execution.mjs` | `:258`, `:2443`, `:2715`, `:2788`, `:2932` (findWork ×4, listItems ×1) | its own file header: "the worker's ACCEPTED-DIRECTIVE handler" — every call resolves a ref or lists items against `ws.workDir`/`rootedWorkDir`, i.e. the WORKER's own materialized worktree. A worker reading its own checkout to drive/report the work IS the correct, intended behaviour (SPEC.md's own framing) |
| `src/global-work-store.mjs` | `:601` (`listItems`, inside `readWorkspaceContentRecords`) | the function's own header names it explicitly: "the WORKER-side content read" (schema v5, TECH_DEBT item 6). Confirmed by its only real callers, `mesh-launcher.mjs:1466,1474`, both inside the worker's active-worktree streaming loop, reading `worktreeWs`/`checkoutWs` — the worker's own tree |

`src/global-work-store.mjs:539` (`listItems`, inside `readWorkspaceProjectionItems`) is **dual-use, not
cleanly (a) or (b)**: its only callers are `publishWorkspaceSnapshot` (control OR worker, whichever
node is publishing its OWN state, §4.3) and `mesh-launcher.mjs:613,1386,1456` (all worker-side,
building the snapshot/delta frame it streams to control). The READ is legitimate in every calling
context — a node always reads its own disk to know its own state before reporting it; §4.3 explains why
this specific call site is not itself "a reader that must migrate" the way (a)'s entries are.

### 5.4 (c) Structural operations that stay on disk — 6 modules, 8 call sites

| Module | Call site(s) | Why it's structural |
|---|---|---|
| `src/work-reindex.mjs` | `:159`, `:207`, `:284` (`listItems`) | the m41 renumber engine — folders/frontmatter ARE the subject of the operation (SPEC.md's own out-of-scope bullet: "`work-reindex` renames real folders… disk is the subject… not a stale copy of a fact") |
| `src/commands/insert-shared.mjs` | `:169`, `:325`, `:532`, `:574` (`listItems`) | the m41 `insert-*` command family's shared mechanics — a THIN wrapper directly over `work-reindex.mjs`'s engine (per its own header, "Does NOT touch `src/work-reindex.mjs`… this module only CALLS `countShiftedByInsert`/`reindexForInsert`"); same structural-rename nature as `work-reindex.mjs` itself, not named separately in STATE.md but falls under the same out-of-scope bullet by direct extension |
| `src/work-doctor.mjs` | `:157` (`listItems`) | **see the open question below — not cleanly classifiable** |
| `src/work-upgrade.mjs` | `:106` (`listItems`) | rewrites templates in place — SPEC.md's own out-of-scope bullet names it explicitly |
| `src/effects/table.mjs` | `:258` (`listItems`, inside `remapRunRecordRefs`) | a `stream.reindexed` CHECKOUT-locus reactor — rewrites the local run records' `ref` after a structural renumber, on whichever node performed the reindex; the same file's own comment (`:242-248`) explicitly explains why `work_items` publishing is DELIBERATELY ABSENT from this reactor ("publishing HERE would publish an intermediate stream") |
| `src/effects/reconcile.mjs` | `:75` (`listItems`, inside `reconcileRunRecords`) | a startup self-heal that scans the LOCAL checkout's run records against the local effects journal to re-derive a missed event — structural to this node's own journal, not a work-item state read |

### 5.5 The one open question this pass could not resolve by measurement: `work-doctor.mjs`

`work-doctor.mjs:157`'s single `listItems` call feeds ONE snapshot consumed by SIX check-groups
(`statusCoherenceGroup`, `lifecycleCompletenessGroup` — `work-doctor-coherence.mjs`; `freshnessGroup`,
`structuralIntegrityGroup` — `work-doctor-freshness.mjs`; `budgetGroup` — `work-doctor-budget.mjs`;
`meshIdentityCommittedGroup` — `work-doctor-identity.mjs`), per the module's own header
(`work-doctor.mjs:1-21`): *"Doctor's groups are strictly the cross-item / docs-for-status / freshness /
structural-integrity facts validate cannot see."* Two of SPEC.md's and STATE.md's own citations disagree
about this ONE call site because they are each accurate about a DIFFERENT part of what it feeds:

- SPEC.md's out-of-scope bullet: *"`validate`/`doctor` check folder↔frontmatter consistency… disk is
  the subject… they stay local."* — true of `structuralIntegrityGroup` and the folder/orphan checks.
- STATE.md's migration-surface paragraph names `work-doctor` among modules that "must move." — true of
  `statusCoherenceGroup`/`lifecycleCompletenessGroup`, which read ITEM STATUS (exactly what the cache
  is meant to authoritatively answer under directive 3), and arguably of `freshnessGroup` too, though
  freshness is defined over folder `mtime` (`work-doctor.mjs`'s own header: "a per-item folder-mtime
  probe for the freshness lane"), which is inherently disk-only and has no cache equivalent unless the
  cache itself grows a freshness-relevant timestamp.

**Not resolved here — reported as the one real ambiguity for the architect**, since `doctorWork` builds
its snapshot ONCE (per its own header, `:14-16`, "builds the snapshot ONCE, runs each pure (snapshot,
ctx) => Finding[] group") and hands it to all six groups; splitting the snapshot's SOURCE per
check-group (some from disk, some from the cache) is a design change to `work-doctor.mjs`'s own
architecture, not something this research can settle by reading call sites.

---

## Sources

- `code.claude.com/docs/en/hooks.md` (fetched twice this session — payload/matcher/exit-code/timeout
  shape, then the `http` hook type + exec-form/shell-split details).
- `/Users/umairb/.vscode/extensions/anthropic.claude-code-2.1.220-darwin-arm64/claude-code-settings.schema.json`
  — the installed settings JSON Schema (generated `2026-07-24T22:46:19.127Z`), the ground truth for the
  five hook variants, the `hooks`/`allowedHttpHookUrls`/`httpHookAllowedEnvVars` settings, and the full
  top-level settings key list (~140 keys).
- `nodejs.org/api/net.html#ipc-support` (fetched) — Windows named-pipe vs POSIX Unix-domain-socket path
  syntax under one `net` API.
- WebSearch, "Claude Code MultiEdit tool removed" — a GitHub issue thread and a Hacker News discussion
  (~Sept/Nov 2025) corroborating `MultiEdit`'s removal from the shipped tool set.
- This repo, measured directly: `.claude/settings.json`, `.claude/hooks/aof/guard-test-isolation.mjs`,
  `src/global-work-store.mjs`, `src/effects/stores.mjs`, `src/adapters.mjs`, `src/runtime-config.mjs`,
  `src/render-plan.mjs`, `src/fs.mjs`, `src/lock.mjs`, `src/node-identity.mjs`, `src/work-init.mjs`,
  `src/work-update.mjs`, `src/bundle/manifest.json`, `.aof/aof.config.json`, `src/mesh-launcher.mjs`,
  `src/mesh-worker-execution.mjs`, `src/mesh-assignment.mjs`, `src/mesh-assignment-reclaim.mjs`,
  `src/work-reindex.mjs`, `src/commands/insert-shared.mjs`, `src/work-doctor.mjs`,
  `src/effects/table.mjs`, `src/effects/reconcile.mjs`, plus a hermetic hook-payload rig and a
  process-spawn latency micro-benchmark, both run in this session's scratchpad (no repo file modified).
