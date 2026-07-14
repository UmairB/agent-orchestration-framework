# AOF — Agent Orchestration Framework

AOF is a local CLI for **agent-driven delivery**. Its heart is **`aof work`**: an opinionated workflow (ACD — Agent-Centric Delivery) where a milestone is broken into independent stories and tasks under `wiki/work/`, and a bundled team of subagents plus `/aof:*` slash-commands refine, build, review, and verify each one. Around that core it grows a code knowledge graph, a recall memory, a board UI, and an asset renderer.

Everything is local Markdown + JSON — no service, no database.

## Local setup

There is **no published package or installer yet** — the CLI is wired up locally with `npm link`. Requires **Node ≥ 20**.

```sh
# from the repo root
npm install        # install dependencies
npm link           # register `aof` globally → this repo's ./bin/aof.mjs

# verify
aof --help
aof project doctor
```

`npm link` makes the `aof` command available from any directory, always pointing at **this working copy** (`which aof` resolves to the global node bin, which symlinks to `./bin/aof.mjs` here). Because it is a symlink, edits under `src/` take effect immediately — there is no build/rebuild step for the CLI. To use it inside another repo, just run `aof …` there; the same global `aof` resolves. To remove the link later: `npm rm -g aof`.

The setup UI (`aof assets ui`) and the work board (`aof work ui`) serve a built front-end — build it once with `npm run ui:build` (see [Tests](#tests)).

---

## `aof work` — the ACD work stream

### The model

A **milestone** groups **stories**; each story groups **tasks** (one `.feature` each). They live as self-contained folders under `wiki/work/` with Markdown record docs and frontmatter status:

```txt
wiki/work/11_milestone_graphify-codebase-intelligence/
  SPEC.md            # why + scope (product owner)
  STATE.md           # where are we, what happened (running narrative)
  ARCHITECTURE.md    # numbered, immutable ADRs + fitness functions (architect)
  DESIGN.md          # UI/UX intent (designer, conditional)
  RESEARCH.md        # resolved unknowns (researcher, conditional)
  VERIFICATION.md    # evidence + findings (verify)
  RETROSPECTIVE.md   # carried lessons
  stories/NN_story_<slug>/STORY.md + tasks/NN_<slug>.feature
```

The unit of independence is the **story** — boundaries follow real coupling so stories build in parallel. A `depends:` graph orders the work; `aof work next` walks it.

### Claude commands (`/aof:*`)

`aof work init` renders the lifecycle as Claude slash-commands into `.claude/commands/aof/`. Drive a milestone from a planning PRD all the way to accepted:

| Command | What it does |
|---|---|
| `/aof:shatter` | a planning PRD → a series of framed milestone SPECs, with cross-milestone `depends` edges (the roadmap) |
| `/aof:refine` | break a milestone into independent stories, or author a story's task contracts via Three Amigos (PO scenarios + QA examples + developer feasibility); produces ARCHITECTURE / DESIGN / RESEARCH as needed |
| `/aof:continue` | execute/resume a work item — build its tasks to green, then structural + behavioural review; fans out a milestone's independent stories |
| `/aof:code-review` | ship + review a branch — commit & push in per-story batches, open a PR, run architect review (with conditional security/compliance lenses), fix findings, optionally squash-merge |
| `/aof:verify` | verify + accept — run the automated + agent-run checks, bring a human in only for `@uat`, log/triage findings, capture lessons in RETROSPECTIVE, sign off |
| `/aof:validate` | validate the stream — `aof work validate` + the agent-only checks (test-traceability, litmus) |
| `/aof:autonomous` | run a range of milestones end-to-end, unattended — refine → build → verify each in dependency order, gating on `aof work validate`; resumable |
| `/aof:retrospective` | triage a milestone's mistakes/blockers into RETROSPECTIVE.md as carryable lessons |
| `/aof:add-milestone` · `/aof:add-story` · `/aof:add-task` · `/aof:add-uat` | scaffold a milestone / story / task / cross-milestone UAT gate |
| `/aof:feedback` | capture a mistake, blocker, or UAT observation the instant it's noticed (any actor) |
| `/aof:recent` | scan the work stream chronologically (catch up / filter by type, status, milestone) |
| `/aof:delegate` | set the two model decisions — toggle gpt-5.6 delegation on/off (default off), then always choose the orchestrator model (Fable 5 or Opus 4.8) |

The commands spawn a team of read-/write-scoped **subagents** (also rendered into `.claude/agents/`):

`aof-product-owner` (SPEC, stories, finding triage) · `aof-architect` (ADRs, fitness-function arch-tests, structural review) · `aof-developer` (implements a story's tasks) · `aof-qa` (test-case design, behavioural review, Playwright browser harness, `@uat` brokering) · `aof-designer` (DESIGN.md, read-only fidelity judge) · `aof-researcher` (RESEARCH.md) · `aof-security` / `aof-compliance` (conditional tiers).

### Model selection (orchestrator, roles, and gpt-5.6-sol)

The **orchestrator** is the main session in orchestrated mode — it spawns the role sub-agents and does the top-level planning. Fable 5 leads on intelligence and taste; because it counts against token usage, the model is an explicit choice rather than a hard default. Both stay fully available at all times — this is a switch you can flip whenever, not a one-way fallback:

```sh
aof work orchestrator          # prompt: Fable 5 or Opus 4.8
aof work orchestrator fable    # or set it non-interactively
aof work orchestrator --show   # report the current choice
```

It writes `settings.claude.model` in `.aof/aof.config.json`, which `aof apply` projects into `.claude/settings.json` — so the next session launches on the chosen model. Switch back and forth anytime: pick Fable 5 when the extra quality is worth the token spend, Opus 4.8 when it isn't.

Each **role** ships a default model (a moving family alias), overridable per role via `work.agents.models`: the author/gate/review roles (`aof-architect`, `aof-designer`, `aof-product-owner`, `aof-qa`, `aof-security`, `aof-compliance`) default to **opus**; the execute/gather roles (`aof-developer`, `aof-researcher`) to **sonnet**. **Fable 5 is never a shipped default** — it's expensive, so it stays opt-in: choose it as the orchestrator model, or set it for a specific role via `work.agents.models` (e.g. `{ "aof-designer": "fable" }`).

When delegation is enabled (the toggle below — it's **off by default**), the developer and researcher hand **bulk / mechanical work to the configured delegation model** (default `gpt-5.6-sol`, the top-tier gpt-5.6 variant), documented by three bundled skills rendered into `.claude/skills/`: **codex-implementation** (scoped patches), **codex-review** (independent review), and **codex-computer-use** (app/UI verification). Each targets the configured model via the Codex CLI and states which model it is using; Claude stays responsible for scoping, reviewing the diff, and verifying.

**gpt-5.6 is opt-in, off by default.** One switch controls it:

```sh
aof work delegation on     # agents may hand bulk/mechanical work to the delegation model
aof work delegation off    # Claude-only (default) — agents do everything themselves
aof work delegation --show # report the toggle state and the active delegation model
```

After you flip the toggle it prompts for the **orchestrator (main-session) model — Fable 5 or Opus 4.8** — so both model decisions are made together (pass `--model fable|opus` to set it non-interactively, or `--no-model` to skip). It writes `work.agents.delegation` ("off" | "on", default off) and re-renders the three `codex-*` skills to match: **off** renders them with `disable-model-invocation: true` (Claude Code won't auto-trigger them — Claude does everything itself), **on** drops that flag so they become auto-invocable. So the toggle literally turns gpt-5.6 delegation on and off; reload the Claude Code session after flipping it. Either way you can always invoke `/codex-implementation` (etc.) by hand, and a Claude-only setup (no gpt/Codex subscription) behaves identically to `off` out of the box. The orchestrator choice (Fable 5 / Opus 4.8) is Claude-only and needs no gpt subscription — nothing here is a hard dependency on having both.

**The delegation model is a variable.** It defaults to `gpt-5.6-sol` but is set via `work.agents.delegationModel` — point it at a future Codex model without editing any bundle asset. The value is baked into the rendered `codex-*` skills and the developer/researcher agents (their `-m <model>` recipes) at render time:

```sh
aof work delegation-model gpt-5.7-codex-max   # set the Codex delegation model
aof work delegation-model --show              # report the active model
aof work delegation on --gpt-model gpt-5.6-sol   # flip the toggle AND set the model in one call
```

`--gpt-model` (the Codex/gpt side) is distinct from `--model fable|opus` (the orchestrator/Claude side) — the two never conflate. Any non-empty id is accepted, so new models work without a code change; re-render (which the command does automatically) and reload the Claude Code session to pick up the new model.

### `aof work` CLI commands

The slash-commands, the board, and automation read/drive the stream through these:

```sh
aof work init [dir]                  # render the ACD bundle (agents + commands) into a repo
aof work update [dir]                # re-render the bundle, drift-checked against the install manifest
aof work find <ref|query> [--json]   # resolve a milestone (11), story (11/02), or slug (auth)
aof work list [scope] [--json]       # the whole stream (or a subtree); --json is the board's flat-array contract
aof work next [range] [--json]       # next actionable item in dependency order (drives autonomous)
aof work validate [ref] [--json]     # folder↔frontmatter, tag vocabulary, depends graph
aof work doc <ref> <DOC> [--json]    # read a record doc (SPEC / STATE / ARCHITECTURE / …)
aof work tasks <ref> [--json]        # an item's task list
aof work feedback <ref> --note "…" [--actor …]   # append an attributed feedback bullet (the only CLI write)
aof work memory <verb> [args] [--json]           # recall / brief / ingest / reindex / status
aof work ui [--port 4180]            # serve the local board UI (built ui/dist) — one origin
aof work orchestrator [fable|opus] [--show]      # pick the main-session (orchestrator) model — Fable 5 or Opus 4.8
aof work delegation [on|off] [--gpt-model <id>] [--show]   # toggle bulk-work delegation (default off), optionally set the model
aof work delegation-model [<id>] [--show]        # get/set the Codex delegation model (default gpt-5.6-sol)
aof work use-headroom | unuse-headroom           # toggle the headroom context-compression plugin
```

### Memory & recall (milestones 05 · 10 · 14)

Agents recall prior decisions, ADRs, and lessons across milestones through a configurable backend (`memory.backend` in `.aof/aof.config.json`):

- **`local`** — a keyless, fully-local lexical index (milestone 05).
- **`graphify`** — graph-grounded recall layered on the same records (milestone 10).
- **AOF.md digest** — a recallable per-milestone summary as a memory source (milestone 14).

```sh
aof work memory status
aof work memory reindex            # rebuild the derived index from the work stream
aof work memory recall "pin line endings"
```

The derived index is git-ignored and re-derivable — never an authoritative second copy.

### Graphify codebase intelligence (milestones 09 · 11)

The ACD agents ground structural review and story-boundary drawing in a real **code knowledge graph** (call/import/dependency edges, communities) instead of grep-and-infer. The graph commands shell out to the managed `graphify` binary — provision it once per machine:

```sh
aof project provision graphify
```

Keep the corpus code-only (so builds are keyless and local — no LLM, no egress) with a `.graphifyignore` that excludes docs/media, then:

```sh
aof graph build src                # AST-extract a code graph → graphify-out/graph.json
aof graph impact src/cli.mjs       # EXACT dependents (blast-radius) + dependencies, from the edges
aof graph query "what calls main"  # a fuzzy, similarity-seeded natural-language answer
aof graph triage                   # graphify's PR-impact ranking
```

`graphify-out/` is a derived, git-ignored build artifact (rebuild on demand, never committed). `aof graph impact` is the **deterministic, edge-based** coupling lookup the review/refine agents consume; `aof graph query` is the fuzzier NL hint.

### Notion work-board sync (milestones 17 · 18)

The on-disk stream is the source of truth, but a team that runs its day on a **Notion board** has no view of it without manual double-entry. `aof work integrations notion sync-work` is an **opt-in, one-way bridge** that projects a milestone and its stories onto an **already-existing** Notion board — milestone → its board row/page, stories → that page's sub-tasks — pushing status so Notion reflects aof without anyone retyping it. It is **aof → Notion only**: aof never reads Notion state as authoritative; on any divergence it overwrites Notion from disk.

```sh
aof project provision notion                                  # install the managed `ntn` CLI into the tool store
aof work integrations notion sync-work 17 [--dry-run] [--json]   # push milestone 17 + its stories' status
aof work integrations notion associate 17 --board ops --parent <page-id|key|none> [--json]  # route an item
```

- **CLI, not MCP.** The sync reaches Notion through the official **`ntn`** CLI **provisioned into aof's managed tool store** (milestone 12, the npx lane) — never the Notion MCP server — so it runs head-less wherever `aof work` runs. `aof project doctor` reports its presence + version and auth reachability. Auth is an **env-var reference** (`NOTION_API_TOKEN`, the headless/CI lane) **or** a browser `ntn login` keychain session; the token never lives in config or argv.
- **Opt-in.** With no `work.integrations.notion` config the command is an **honest no-op + setup hint** — nothing about the existing work stream changes. The config is a **`boards` registry** (each board keyed, with a `default`): `dataSourceId`, `statusProperty`, the mandatory `statusMap` (aof `not-started`/`in-progress`/`in-review`/`done` → the board's options), and the `relationProperty` that nests stories as sub-tasks. aof binds to the board's **existing** schema — it never creates databases, properties, or views.
- **Per-folder routing (milestone 18).** Each item's folder can carry a committed, co-located **`.integrations.json`** declaring *which* board and *which* parent page it belongs to — so a repo whose milestones land on different boards/parents is self-describing. `… notion associate` writes/clears that descriptor (the only mutation); absent ⇒ default board, top-level, exactly as milestone 17.
- **Idempotent.** A git-ignored **`.aof/notion.work-map.json`** sidecar records the aof-item ↔ Notion-page binding (scoped per board), so re-syncs **update in place** rather than duplicating. `--dry-run` computes and prints the projected diff **without calling Notion**.

---

## Built by these milestones

The `aof work` system was itself built with `aof work` — dogfooded milestone by milestone under `wiki/work/`:

| # | Milestone | Adds |
|---|---|---|
| 00 | Work CLI | the `aof work` command surface over `wiki/work/` |
| 01 | ACD Asset Bundle | the bundled subagents + slash-commands; `aof work init` / `update` |
| 02 | Planning Init | `aof planning init` — installs the bought planner (pm-skills) with pinned-sha provenance |
| 03 | Work Board UI | `aof work ui` — a local board over the stream |
| 04 | Round-trip Proof | end-to-end proof of the loop: `aof work init` → refine → continue → verify in a fresh repo |
| 05 | Work Memory | `aof work memory` — recall over prior decisions (local backend) |
| 06 | Headroom Plugin | optional, config-gated **headroom** context-compression over the board terminal's `claude`/`codex` |
| 07 | Design-Conformance | designer fidelity judge + QA Playwright browser harness wired into `/aof:verify` |
| 08 | CLI Command Core | the command registry — the UI and MCP faces are thin adapters over one CLI contract |
| 09 | Graphify Command Core | `aof graph build` / `query` / `triage` — graphify arrives as aof commands |
| 10 | Graphify Memory Backend | `memory.backend: graphify` — graph-grounded recall |
| 11 | Graphify Codebase Intelligence | `aof graph impact` + the agents grounding review in real coupling *(in progress)* |
| 12 | Managed Tool Provisioning | `aof project provision` — aof owns its external tools in the `~/.aof` home |
| 13 | External Milestone Import | `aof import milestone <repo> <selector>` — recover a milestone from another repo as recallable knowledge |
| 14 | AOF.md Digest | a recallable per-milestone summary as a memory source |
| 15 | Work Doctor | `aof work doctor` — health checks over the work stream |
| 16 | Context-Budget Lint | a `work doctor` group that flags record docs exceeding their context budget |
| 17 | Notion Work-Board Sync | `aof work integrations notion sync-work` — opt-in, one-way push of milestone + story status to a Notion board (via the managed `ntn` CLI) |
| 18 | Integration Descriptor | per-folder `.integrations.json` routes each item to its board + parent; `… notion associate` writes it |

---

## Assets (secondary)

Before the work stream, AOF was an **asset renderer**, and that surface remains: define assistant-facing assets once in a portable `.aof/aof.config.json`, then render them into runtime folders (`.claude/`, `.codex/`).

Four portable resource kinds — `skill`, `command` (Claude-only), `agent`, `rule` — plus expanded primitives (`mcpServers`, `hooks`, `projectDocs`, `settings`, workflow-backed assets). Source bodies live under `.aof/assets/`; reusable **global** assets live under `~/.aof` and are referenced (not copied) via `globalRefs`.

```sh
aof init                              # scaffold an empty .aof workspace
aof assets add skill code-review      # scaffold a file-backed source asset
aof assets apply --dry-run            # preview the render plan (creates/updates/deletes/drift)
aof assets apply                      # render runtime outputs + write .aof/aof.lock.json
aof assets ui                         # the local source-asset editor (Project / Global scopes)

aof project show | validate | doctor  # inspect / validate / diagnose the workspace
aof packages add gsd                  # declare a managed framework pack (e.g. GSD); install via `aof packages install`
```

`aof assets apply` is lock-driven and idempotent: it records every generated path + content hash in `.aof/aof.lock.json`, reports a `drift-warning` (and skips) when it sees a hand-edited generated file, and prunes only files it still owns. `--strict` promotes adapter warnings to failures for CI. The full DSL — overrides, workflow-backed assets, `{{skills.*}}` / `{{workflows.*}}` references, MCP/hooks/docs primitives, and the per-runtime adapter rules — is configured in `.aof/aof.config.json`; run `aof project validate` / `aof project doctor` to check it.

---

## Tests

Run the full suite — the canonical entry point:

```sh
npm test            # = node ./scripts/test.mjs
```

This runs the unit + arch (fitness-function) + BDD-traceability tests, including the `work`, `graph`, and memory suites. `scripts/test-unit.mjs` is an older **partial** subset that omits the graph/work tests, so prefer `npm test`.

Other entry points:

```sh
node ./test/integration/cli.mjs      # BDD feature tests — launch the CLI as an external process
npm run test:integration:ps          # PowerShell integration parity (Windows; skips elsewhere)
npm run test:smoke:cli               # focused process-boundary smoke test
npm run ui:build                     # build the setup UI / board front-end (cross-platform wrapper)
npm run check                        # full closeout check
```

Integration feature files live in `test/integration/features/` and are intentionally black-box (reusable if the CLI ever moves off Node). New user-facing functionality should include BDD coverage in the relevant domain feature file.
