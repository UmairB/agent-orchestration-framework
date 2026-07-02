---
type: story
number: 30
slug: per-agent-model-selection
title: "Per-Agent Model Selection — run a different model per ACD agent role"
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-07-01
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A standalone story (no parent) is self-contained.
-->
# 30 · Per-Agent Model Selection — run a different model per ACD agent role

## User story

As an operator running the ACD agent fleet,
I want each agent role to be backed by a chosen model — with defaults that put the roles which decide
*what's correct* (author / gate / review) on the most capable model and the roles which *execute or
gather* against an already-locked target on a faster, cheaper one,
so that top-tier model budget is spent where reasoning quality actually changes the outcome (design,
security, compliance, scope, test design, fidelity) and a faster model carries the bounded work —
instead of running every role on one model and either overpaying for execution or under-powering the
roles that gate quality.

<!--
  The "so that" is the real benefit: differentiated spend tied to where judgment lives, not a uniform
  fleet. The load-bearing intent that must survive into refinement is the DEFAULT MAP and the
  PRINCIPLE behind it (Notes), not the wiring mechanism — refinement/architect pin the mechanism.
-->

## Tasks

<!-- Authored by `aof:refine 30` (Three Amigos): each task is a tasks/NN_<slug>.feature whose scenarios
     are its acceptance criteria. Tick a box when its @executable feature is green. -->

- [x] [01 · Bundle ships the default model map](tasks/01_bundle-ships-default-model-map.feature) — each of the 8 roles renders its shipped default alias (6 opus / 2 sonnet); alias is verbatim (tracks "latest").
- [x] [02 · Per-project config override](tasks/02_per-project-config-override.feature) — `work.agents` per-role model override wins over the bundle default; validated (key ∈ 8 frozen roles, well-formed value) via `aof project validate`.
- [x] [03 · Solo-mode inert model map](tasks/03_solo-mode-inert-model-map.feature) — under `mode: solo` the per-role map can't bind; surfaced as a non-blocking notice, not enforced.

**Refinement decisions (this refine):** scope = bundle default **+** per-project config override; model form = **moving family alias** (`opus`/`sonnet`), not a pinned id; solo-mode = **surfaced (non-blocking), not enforced**; `inherit` value = **rendered verbatim**, not reinterpreted as fall-back.

**Net-new seams flagged at feasibility (for build):** the config→render override merge (2), the `work.agents` runtime validation in `config-inspect` (2, 3), and the schema key under `work.agents` (2) are all net-new. Derive the valid-key set from the exported `readDescriptor()`, not a 4th hardcoded copy of the frozen role list. Bundle→render `model:` passthrough (1) already exists.

## Notes

Standalone for now; this is a work-engine / bundle concern, not part of any current milestone. Could be
regrouped under a config/agents milestone if it grows companion capabilities.

### Carry-forward (review, 2026-07-01) — override not yet wired into `work init`/`update`

Task 02 delivered the config-aware render path (`renderBundleOutputsWithConfig`) + `work.agents.models`
validation, and the `@executable` scenarios bind that path directly — the acceptance the feature scoped.
BUT `aof work init`/`update` still synthesise from the bundle only (`renderBundleOutputs`, via
`work-bundle-synthesis.mjs`), so a project's `work.agents.models` override does **not yet win at a real
render** — only in tests. The shipped **defaults** (task 01) do wire end-to-end; the **override** is
half-wired. Follow-on: adopt `renderBundleOutputsWithConfig` (loading the project config) into the
synthesis path so the override wins at an actual `aof work init`/`update`. Flagged by the architect at
build review; out of task 02's scope, captured here so it isn't lost.

### Locked intent — the default model map

The principle: **opus (latest) for roles that decide "what's correct" (author / gate / review);
sonnet (latest) for roles that execute or gather against an already-defined target.** The 8 ACD roles
(frozen set — `test/arch/acd-bundle-membership.test.mjs`) split:

| Role | Default | Why |
|------|---------|-----|
| `aof-architect` | **opus** | design + structural judgment |
| `aof-security` | **opus** | adversarial threat modelling |
| `aof-compliance` | **opus** | regulated obligation mapping |
| `aof-product-owner` | **opus** | authors SPEC + draws story boundaries — the contract everyone builds against |
| `aof-qa` | **opus** | designs the test-case matrix + is the behavioural gate (decided: opus over sonnet — bug-catching quality wins over the cost of also running the mechanical browser harness) |
| `aof-designer` | **opus** | fidelity *judge* (CONFORMS/GAPS) + owns "what's correct" for UI; conditional/rare so opus costs little |
| `aof-developer` | **sonnet** | implements against a locked contract |
| `aof-researcher` | **sonnet** | gathers facts (SDK realities, prior-art, vendor behaviour) — thoroughness + tool use, not deep reasoning |

"latest" means the latest of that family at resolve time (today: Opus 4.8, Sonnet 4.6) — refinement
decides whether to track a moving "latest" alias or pin exact ids and bump deliberately.

### Current state (grounds refinement — what already exists)

Model selection is **half-wired** already:

- Agent markdown frontmatter already accepts an optional `model:` field — read by the bundle loader
  ([src/work-bundle.mjs:86](../../src/work-bundle.mjs#L86)) and rendered into the generated
  `.claude/agents/aof-*.md` ([src/adapters.mjs:415](../../src/adapters.mjs#L415)). The Claude Code
  runtime honours that frontmatter. **No agent declares a `model:` today**, so all roles inherit the
  session default.
- Config `work.agents` ([schemas/aof.schema.json](../../schemas/aof.schema.json), ~L358–372) only knows
  `mode` (`orchestrated`/`solo`) and `productOwner` (`inline`/`agent`) — **no per-role model field**, and
  `work.agents` has no runtime validation in [src/config-inspect.mjs](../../src/config-inspect.mjs) yet.
- The bundle source agents live at `src/bundle/agents/*.md`, enumerated in `src/bundle/bundle.json`.

So the seam is small: set defaults + (optionally) expose a per-project override; the render pipeline
already carries `model` through.

### Open design questions (for refinement — do NOT pre-pin here)

- **Where the default lives.** Bake `model:` into each `src/bundle/agents/*.md` (a static bundle default
  that re-renders into `.claude/agents/`), OR a config-driven map under `work.agents` (per-project
  override), OR both (bundle ships the default, config overrides). The user asked for *defaults* — a
  bundle default satisfies that; a config override is the flexibility follow-on.
- **`solo` mode interaction.** When `work.agents.mode: "solo"` the main session plays every role, so
  per-role model selection only bites under `orchestrated`. Decide whether that's documented or enforced.
- **Validation.** If a config map is added, extend the schema + `config-inspect.mjs` to validate the
  role keys (must be one of the 8 frozen roles) and the model values.
- **"latest" resolution.** Frontmatter renders a literal id (e.g. `claude-opus-4-1` in the existing
  plumbing) — decide alias-vs-pinned and how a model bump propagates to already-generated agent files.
</content>
</invoke>
