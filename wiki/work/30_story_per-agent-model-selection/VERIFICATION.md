---
doc: verification
updated: 2026-07-01
---
<!--
  Story VERIFICATION.md — answers ONE question: is story 30 truly done, and what is the evidence?
  Written at aof:verify 30. Only sections with content appear (absence is information).
  Standalone story (parent: null) → the record doc is this VERIFICATION.md, no milestone SPEC box to tick.
  NO @uat scenarios → no ## User sign-off section (no human was pestered).
  NO UI surface (a bundle/config concern, no DESIGN.md) → no design-conformance section.
-->
# 30 · Per-Agent Model Selection — Verification

## Verification evidence

### Automated + fitness (always; no human)

- **`@executable` suite green** — `node scripts/test.mjs` → **1707 ok / 0 not-ok, exit 0** (verify
  2026-07-01). Within it the **17 story-30 cases all pass** — 12 behavioural rows across the three task
  features + 5 fitness-function cases. _verifies →_ every `@executable` scenario/outline across the three
  task features:
  - `bundle-model-map` (task 01) — the 8-role default map renders into each generated
    `.claude/agents/<role>.md` (6 opus / 2 sonnet), and the shipped default is a **moving family alias
    rendered verbatim** (no re-case, no version-dated id). _verifies →_ 01's `Scenario Outline` (both
    Examples tables) + the "moving family alias, rendered verbatim" scenario.
  - `agent-model-override` (task 02) — a configured per-role override **wins** over the bundle default
    (decide-role→sonnet, execute-role→opus, a pinned id, `inherit` verbatim, and the degenerate
    override==default clean no-op — exactly one `model:` line each); an un-overridden role keeps its
    default; the override **key** must be one of the 8 ACD roles (typo/casing/prefix/padding rejected);
    the override **value** must be a well-formed model string (`opus`/`sonnet`/`claude-opus-4-8`/`haiku`
    accepted, empty/whitespace/number/null rejected); a well-formed map keeps the config valid.
    _verifies →_ 02's override-wins outline, un-overridden scenario, and the key + value matrices.
  - `agent-model-solo-inert` (task 03) — a per-role map under `mode: solo` is flagged as **inert**
    (`model-map-inert-under-solo`), the notice is **informational not an error** (config stays valid), and
    it fires **only** on `solo` + a present map (silent under `orchestrated`, unset mode, or no map).
    _verifies →_ all 5 of 03's scenarios.
- **Fitness functions green (the load-bearing story arch-tests)** — both enforce in the suite (5 cases):
  - `acd-agent-model-source-map` (2 cases) — every frozen ACD role declares a `model` in the bundle
    **SOURCE** frontmatter (no role un-mapped), and the source value is a lowercase **family alias**, never
    a dated/pinned id. Checks the SOURCE surface, distinct from the rendered file the behavioural test asserts.
  - `acd-agent-model-role-derivation` (3 cases) — the validator's accepted override-key set is **exactly**
    the descriptor's 8 agent ids and **derived from `readDescriptor()`**, not a hardcoded copy: every
    descriptor id is accepted, a non-member is rejected, and the accept/reject verdict is congruent with
    descriptor membership (a drifted hardcoded copy would fail here).
- **CLI faces exercised end-to-end** (agent-run, no human):
  - `aof project validate` (real repo config) → **`valid: config passed validation`** — the surface the
    task-02/03 validation scenarios name (`config-inspect.validateConfig`, the same diagnostics engine).
  - `aof work validate 30` → **`PASS — 30 is well-formed`**; whole stream → **`PASS — work stream is
    well-formed`**.
- **Bundle SOURCE default map confirmed** — `src/bundle/agents/*.md` frontmatter: `opus` for
  `aof-architect`, `aof-security`, `aof-compliance`, `aof-product-owner`, `aof-qa`, `aof-designer`;
  `sonnet` for `aof-developer`, `aof-researcher` — the locked intent (6 decide-roles on opus, 2
  execute/gather-roles on sonnet).

The full suite is **clean this run** (1707/0) — unlike the story-29 verification (2 out-of-scope mesh reds
on 2026-06-30); the milestone-22/23 mesh work that was in-flight then is now green.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F30-1 | The per-project override wins only through the config-aware render seam `renderBundleOutputsWithConfig` (`src/work-bundle.mjs`), which **no production code calls yet** — `aof work init`/`update` synthesise via the **bundle-only** `renderBundleOutputs` ([src/work-bundle-manifest.mjs:46](../../src/work-bundle-manifest.mjs#L46)). So a project's `work.agents.models` override does **not yet win at a real `work init`/`update`** — only in the task-02 tests that bind the seam directly. The shipped **defaults** (task 01) DO wire end-to-end. | wiring gap / follow-on | non-blocker | defer to backlog. Task 02's acceptance was **deliberately scoped** to the config-aware render path (the feature's feasibility note binds `renderBundleOutputsWithConfig`, explicitly NOT synthesis), and the load-bearing default map delivers the differentiated-spend benefit end-to-end. Already captured in STORY.md "Carry-forward (review, 2026-07-01)". | backlog / synthesis-adopts-config | open (deferred) |

Triage (PO, inline): F30-1 is **non-blocker** — no accepted-scope behaviour is broken. The default map (the
story's load-bearing intent) wires end-to-end at a real render; the override is proven at its seam and its
validation is live under `aof project validate`. Adopting the config-aware pass into the synthesis path is a
clean follow-on, not a defect in the accepted contract. **No blocker and no design-gap finding is open.**

## Accept decision

**ACCEPTED — 2026-07-01.** All three task features are green: the `@executable` suite (**17/17 story-30
cases**, 0 not-ok within a **1707 ok / 0 not-ok** `node scripts/test.mjs` run) and both story fitness
functions (`acd-agent-model-source-map`, `acd-agent-model-role-derivation`) pass. The bundle ships the
locked default map (6 opus / 2 sonnet) rendering verbatim into each generated agent file; a per-project
`work.agents.models` override wins at the config-aware render seam and is validated (key ∈ the 8
descriptor-derived ACD roles, non-empty string value) with a non-blocking solo-mode inert notice — all
observable through `aof project validate`. The `aof work validate 30` gate **PASSES** (`PASS — 30 is
well-formed`; whole stream also PASS) and test-traceability is 1:1 (`bundle-model-map` /
`agent-model-override` / `agent-model-solo-inert` ↔ the three task features' `@executable` rows). No `@uat`
scenarios exist (no human gate); no UI surface (no design lane). One non-blocker wiring finding (F30-1 — the
config override not yet adopted into `work init`/`update` synthesis) is deferred to backlog, already
documented in STORY.md. A standalone story → **status: done**.
