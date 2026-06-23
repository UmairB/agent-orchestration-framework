# PRD — Work-Artifact Health

> Planning PRD for an artifact-**health** lane over the ACD work stream. Upstream of ACD: this
> document is the seam `aof:shatter` consumes to lay out the milestone roadmap. Derived from a study of
> [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice)
> (a 58.7k★ catalog of Claude Code methodologies — Superpowers, Spec Kit, BMAD, **GSD**, gstack — that
> all converge on `Research → Plan → Execute → Review → Ship` with agent isolation and gated
> verification). The finding: aof *already is* one of those methodologies, so the catalog mostly
> **confirms** aof's architecture rather than extending it. The one clean gap it surfaces — visible in
> GSD's [`/gsd:health`](../../.claude/commands/gsd/health.md) ("diagnose planning-directory health and
> optionally repair") — is that aof lints each artifact for *validity* but nothing lints the *stream*
> for *coherence*. This arc closes that gap, reusing aof's own established `validate` / `doctor` split.

## Objective

**Objective.** Give the work stream a **health** lane to complement its existing **validity** lane —
an `aof work doctor` that answers "is the stream coherent, complete, and fresh?" the way
[`aof project doctor`](../../README.md) already answers it for config/workspace. Today aof has a clean
two-lane shape for config — `aof project validate` (is it well-formed?) and `aof project doctor` (is it
healthy?) — but the work stream only has the first lane: [`validateWork`](../../src/work.mjs#L302),
surfaced through [`work:validate`](../../src/commands/validate.mjs) and the
[`/aof:validate`](../../.claude/commands/aof/validate.md) skill, checks **folder↔frontmatter**, the
**closed tag vocabulary**, and the **`depends` graph** (resolves + acyclic). Every one of those is a
*per-file well-formedness* check; none of them can see across items. So the stream can be 100% "valid"
while a milestone is marked `done` with a child story still `in-progress` (a lying parent), a `done`
milestone has no `RETROSPECTIVE.md` (its own close convention, silently skipped), an `in-progress`
item's `updated` date is months stale, [ROADMAP.md](../work/ROADMAP.md) lists milestones that no folder
backs, or a folder is typo'd out of the `NN_type_slug` shape and vanishes from `listItems` entirely —
all **deterministic, computable facts** that nothing reports. This arc authors `work:doctor` as a
command-core command (so the CLI, board, and MCP faces inherit it for free), reusing the same
`listItems` / `readMeta` traversal `validate` and `list` already share, and adds the cross-item health
checks: **status coherence** (parent↔child), **lifecycle completeness** (required docs for the item's
status), **freshness** (stale/`updated`-vs-mtime/date sanity), **ROADMAP↔folder sync**, and **orphan
folders**. It stays read-only and advisory by default, with `--strict` promoting warnings to failures
exactly as the config doctor does — the deterministic floor beneath the `/aof:validate` skill's
agent-only layer (traceability, UAT-gate prose, litmus), never a replacement for it. The payoff: a
single `aof work doctor` (and the board/MCP that inherit it) turns "the stream *looks* fine because
every file parses" into "the stream is *actually* coherent" — catching the cross-item drift that today
only a human re-reading the whole tree would notice.

## Context & Constraints

- **aof already owns the precedent: the `validate` / `doctor` split.** [README](../../README.md)
  documents `aof project validate` (JSON shape, resource kinds, runtimes, file refs) **and**
  `aof project doctor` (project *health* on top), both with `--json` and `--strict`. This arc does not
  invent a pattern — it applies aof's existing one to the work stream, which has only the `validate`
  half. Naming, flags, and severity semantics mirror `project doctor` so the surface stays predictable.
- **Validity ≠ health — keep the keystone intact.** `aof work validate` is the deterministic structural
  keystone (ADR-002): it exits non-zero on any finding and is what `aof:autonomous` gates on. `doctor`
  must **not** weaken or duplicate it. Validate stays the hard gate (is it well-formed?); doctor is the
  advisory health report (is it coherent?) — warnings by default, `--strict` to fail. The two run
  in sequence (validate first, then doctor) and report separately.
- **Authored as command-core commands (milestone 08 contract).** Milestone 08 (cli-command-core)
  establishes that every operation is a registered command and that the CLI / board / MCP are thin
  faces that may *only* invoke registered commands (ADR-001/004, bijection arch-test). `work:doctor` is
  authored as a registered command with a stable `--json` envelope; the board and MCP inherit a health
  view for free, no side-channel. The CLI face mirrors `work:validate`'s render/json adapter discipline.
- **Reuse the existing traversal — no new globbing.** `validate` and `list` are deliberately thin
  passes over [`listItems`](../../src/work.mjs#L57) (folder-name-as-index; identity parseable without
  reading files) and `readMeta` / [`parseFrontmatter`](../../src/work.mjs#L102). `doctor` reads the
  same model and adds *cross-item* reasoning over it — it must not reintroduce the ad-hoc `**/*.md`
  globbing the work module exists to replace.
- **Read-only, single source of truth.** Frontmatter status stays authoritative; the doctor *reports*
  incoherence, it never mutates artifacts to "fix" them. This holds the same single-source-of-truth
  invariant milestones 05/09 enforce, and keeps `doctor` safe to run anywhere (consistent with the
  capture-commands-never-prompt and read-only-validate conventions). Auto-repair is a deliberate
  non-goal here (see Out of scope).
- **Health checks must be genuinely deterministic.** Anything needing prose comprehension
  (traceability `@executable→green test`, `@finding-<id>` lineage, UAT-gate `## Findings` resolution,
  litmus) **stays in the [`/aof:validate`](../../.claude/commands/aof/validate.md) skill's agent
  layer** — `doctor` only takes checks computable from folder structure, frontmatter, file presence,
  and mtimes. The line between "CLI deterministic" and "skill agent-layer" is the same line milestone
  08 / `/aof:validate` already draw.
- **Best-practice rule worth lifting: keep agent context lean.** The catalog's single loudest rule is
  "keep CLAUDE.md small; lazy-load `.claude/rules/`; degrade gracefully." aof generates and feeds
  long-form markdown (SPEC / ARCHITECTURE / STORY) to agents; a doc-length/bloat *metric* is a natural
  health signal (a 600-line SPEC poisons every downstream agent's context). Captured as its own
  dependent milestone so the doctor foundation ships without waiting on it.

## Scope

### In scope

- **`work:doctor` as a registered command-core command** (the milestone-08 contract) with a stable
  `--json` envelope and a `--strict` flag (advisory warnings by default; `--strict` promotes to
  non-zero), reusing `listItems` / `readMeta`, scope-as-filter semantics matching `work:validate`, and
  a CLI face (`aof work doctor [scope] [--json] [--strict]`) that mirrors the existing validate
  render/json adapter discipline. Each finding carries a **severity** (`warn` / `error`) and a stable
  machine code so faces and `--strict` can reason over it.
- **The deterministic health-check engine**, grouped:
  - **Status coherence (cross-item):** milestone `done` with a non-`done` child story (lying parent);
    milestone `not-started` with an `in-progress`/`done` child (stale parent); story `done` under a
    `not-started` milestone; a driver `depends`-blocked but already `in-progress`.
  - **Lifecycle completeness (docs-for-status):** `in-review`/`done` milestone missing a non-empty
    `VERIFICATION.md`; `done` milestone missing `RETROSPECTIVE.md` (the close convention); a
    past-`not-started` milestone with zero stories; a started story with an empty `tasks/`;
    `ARCHITECTURE.md` absent once a milestone has stories.
  - **Freshness / date sanity:** `updated` older than the newest file mtime in the item's folder
    (frontmatter not bumped after edits); `updated < created`; non-ISO / unparseable dates; an
    `in-progress` item stale beyond a configurable window.
  - **ROADMAP ↔ folder sync:** milestones on disk absent from [ROADMAP.md](../work/ROADMAP.md) (or
    vice-versa); numbering gaps and duplicate top-level driver numbers.
  - **Orphans:** directories under the work dir that do not match `^(\d+)_(milestone|story|task|uat)_…`
    (typo'd folders silently dropped by `listItems` today).
- **Wiring into the lint keystone:** `/aof:validate` runs `aof work validate` then `aof work doctor`
  and reports both, grouped by lane; the board and MCP faces surface the doctor envelope through the
  registered command (no new door).

### Out of scope

- **Auto-repair / mutation (`--fix`).** `doctor` is read-only like its config sibling; repairing
  incoherence (bumping a stale parent, generating a missing RETROSPECTIVE stub) is a separate,
  higher-risk arc — captured below, not built here.
- **Agent-layer semantic checks.** Traceability (`@executable`→green test, `@manual`/`@uat`→
  VERIFICATION rows), `@finding-<id>` lineage, `verifies →` resolution, UAT-gate `## Findings`
  integrity, and litmus stay in the `/aof:validate` skill — they need prose comprehension, not
  determinism. `doctor` does not absorb them.
- **Generated-output drift** (`.claude/` / `.codex/` stale vs `.aof/` source). That is config/workspace
  health — `aof project doctor` territory — not work-artifact health. Captured as adjacent.
- **Gating the autonomous loop on doctor.** Whether `aof work next` / `aof:autonomous` should treat a
  `--strict` doctor failure as a blocker is a deliberate follow-up question, not part of this arc
  (validate stays the gate; doctor stays advisory until proven).
- New aof runtimes beyond `claude` / `codex`; any server/daemon/DB infrastructure.

## Milestones

> Foundation-first: the doctor command + engine ships first; the context-budget lint is an independent
> check-group that plugs into the same registered command and fans out after.

- **work-doctor-core** — the foundation. Author `work:doctor` into the command core with a stable
  `--json` / `--strict` contract and a CLI face mirroring `work:validate`; build the deterministic
  health-check engine (status coherence, lifecycle completeness, freshness, ROADMAP↔folder sync,
  orphans) over the shared `listItems` / `readMeta` traversal, with per-finding severity + machine
  codes; wire `aof work doctor` into the `/aof:validate` keystone after `aof work validate`.
  **Depends on milestone 08 (cli-command-core)** — it is authored as a registered command on that
  contract, and reuses the `work.mjs` model `work:validate` already reads.
- **context-budget-lint** — the lean-context health metric. Add a doc-bloat check-group to the doctor:
  per-artifact line/size budgets for the long-form context docs (SPEC / ARCHITECTURE / STORY) agents
  consume, warning when an artifact exceeds a configurable budget (the catalog's "keep CLAUDE.md lean"
  rule, generalized to ACD artifacts). **Depends on work-doctor-core** — it registers a new check-group
  in the same `work:doctor` command and inherits its faces; otherwise independent (parallel-eligible).

## Adjacent techniques (separate arcs — captured, not scoped here)

> Genuinely-incorporable ideas surfaced by the best-practice study and the doctor design. Recorded so
> they are not lost; each is its own arc, not part of work-artifact health.

- **Doctor `--fix` (guided repair).** GSD's `/gsd:health` "optionally repairs." A future arc could let
  `aof work doctor --fix` generate missing-doc stubs, bump a stale `updated`, or reconcile a lying
  parent — *after* the read-only signal is trusted. High-risk (mutates artifacts), so deliberately
  deferred behind the read-only foundation.
- **Generated-output drift in `project doctor`.** [AGENTS.md](../../AGENTS.md) declares `.claude/` /
  `.codex/` as generated from `.aof/`, but nothing flags when they have drifted from source. A natural
  `aof project doctor` addition (config-health lane), not work-artifact health. → a render-plan /
  `project doctor` arc.
- **`.claude/rules/` rendering (lean, lazy-loaded context).** The catalog favors path-scoped,
  lazy-loaded `.claude/rules/*.md` over one large root context file; aof's context lives in a single
  `AGENTS.md`. aof could render per-path rules the same way it renders commands. → an `assets` /
  render arc, complementary to the context-budget lint above.
