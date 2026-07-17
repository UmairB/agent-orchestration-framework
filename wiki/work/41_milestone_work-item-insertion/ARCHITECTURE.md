---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 41 · Work-item insertion & re-index — Architecture Decisions

> Inputs: `SPEC.md` (add `insert-milestone` / `insert-story` / `insert-uat`: frame a new item at a target
> position `P`, then re-index every item `≥ P` up by one, keeping the stream valid throughout — verifiable by an
> outsider: the new item occupies `P`, every prior `≥ P` item shifted up by exactly one, all machine references
> still resolve, and `aof work validate` is green with no manual repair), `STATE.md` (the framing decisions:
> re-index depth = integrity-preserving — folders + frontmatter `number` + machine refs; human prose mentions
> explicitly NOT rewritten; scope is exactly milestone/story/uat).
>
> **Codebase-graph grounding.** The graph was rebuilt fresh at this refine (`aof graph build src` →
> **1860 nodes, 4677 edges, 87 communities**; `aof graph impact` read back per-file below). It reports the two
> facts that shape every decision here:
> - **`src/work.mjs` is a god-node — imported/called by 36 modules** (`cli`, `command-core`, `commands/validate`,
>   `commands/next`, `commands/list`, `commands/resolve`, `commands/run-start`, `commands/run-complete`,
>   `commands/mesh-assign`, `commands/mesh-heartbeat`, `commands/mesh-session`, `commands/notion-associate`,
>   `commands/notion-sync-work`, `board-ui`, `global-work-store`, `integrations/routing`,
>   `memory/graphify-backend`, `memory/local-indexing`, `mesh-assignment-reclaim`, `mesh-launcher`,
>   `mesh-worker-execution`, `terminal-ws`, `work-doctor`, `work-memory`, plus retired reference tests) and
>   **imports only 3** (`fs`, `node-identity`, `workspace`). Anything bolted INTO `work.mjs` inherits that
>   36-module blast radius. This is the single hardest constraint on the milestone — actual structure, not
>   inferred (ADR-001).
> - **`src/work-reindex.mjs` does not yet exist** (`aof graph impact` → 0 in / 0 out): the engine is greenfield,
>   free to be shaped as a leaf that DEPENDS on `work.mjs` rather than living inside it (ADR-001).
> - **Resolution is stateless / folder-derived** (`listItems` / `findWork` parse `NN_type_slug` with zero content
>   reads; there is no cache or index to rebuild). Renaming a folder makes the new number resolve automatically —
>   the whole precondition that makes "re-index by rename" sufficient (honours 00/ADR-001 "the folder name is the
>   index"). The only STORED references a rename does NOT auto-follow are the `depends` and `parent` frontmatter
>   values; those are the precise rewrite target (ADR-003).
> - **The only existing programmatic frontmatter WRITER is `rollbackItemStatus`** — it rewrites ONE line
>   (`status:`) inside the frontmatter block via a targeted regex and reassembles every other byte unchanged. It
>   is the precedent the engine's `number`/`parent`/`depends` rewriter must mirror; it must NOT round-trip through
>   `parseFrontmatter` + reserialize (18/ADR-007 reverted the last extension of that shared parser — the highest
>   blast-radius cut in the codebase).
>
> The graph is one input; the boundaries below are the architect's call. Prior-lesson acknowledgements are folded
> into the ADRs they bear on (00/ADR-001 folder-is-index → ADR-003; 18/ADR-007 parser-minimalism → ADR-001;
> 15/R5 ROADMAP-dormant → ADR-003; 37/R1 count-logical-seams → ADR-005).

---

## ADR-001: The re-index engine is a NEW deterministic module (`src/work-reindex.mjs`), NOT a function bolted into the `work.mjs` god-node — it IMPORTS `work.mjs`'s readers; `work.mjs` never imports it back. The frontmatter rewriter mirrors `rollbackItemStatus`'s surgical single-line discipline, never a `parseFrontmatter` reserialize

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The milestone needs a WRITER: a routine that renames `NN_type_slug` folders, bumps their frontmatter
`number`, and rewrites the stored `depends`/`parent` references so nothing dangles. `work.mjs` is the natural home
by subject — it already owns `listItems`/`findWork`/`parseFrontmatter`/`recordDoc`/`rollbackItemStatus`. But the
graph is unambiguous: `work.mjs` is imported by **36 modules** and imports only 3. Every line added to it is
inherited by the entire command surface, the board, the mesh launcher, the memory indexer, notion sync, the
worker executor. A renumber engine is a heavy, fs-mutating, multi-file routine; putting it inside `work.mjs` would
bloat the highest-fan-in module in the repo and drag all 36 dependents into its blast radius for no structural
gain — the engine needs `work.mjs`'s READERS, not the other way round. Separately, the engine must WRITE
frontmatter, and the codebase has exactly one sanctioned precedent for that (`rollbackItemStatus`): a surgical
line-level rewrite that touches only the target key and leaves every other byte identical. The tempting shortcut —
`parseFrontmatter(text)` → mutate the object → reserialize — is forbidden by 18/ADR-007, which REVERTED the last
extension of that shared parser precisely because it is the 14-importer god-parser and any round-trip through it
silently drops comments, key order, and formatting.

**Decision.**
- **A new module, `src/work-reindex.mjs`, is the re-index engine.** It exports a deterministic, pure-ish engine —
  indicatively `reindexForInsert(workDir, { at, space })` (opens a slot) plus the count primitive (ADR-004) —
  that: (1) enumerates the affected items via `work.mjs`'s `listItems`, (2) renames each folder `≥ P` in the
  target space up by one, (3) bumps that item's frontmatter `number`, and (4) rewrites the stored `depends`/
  `parent` values that pointed at a shifted number (ADR-003). It is the ONLY module that performs the renumber.
- **The dependency direction is FIXED: `work-reindex.mjs` imports `work.mjs`; `work.mjs` NEVER imports
  `work-reindex.mjs`.** The engine consumes the readers (`listItems`, `parseFrontmatter`, `recordDoc`, and the
  identity regex — `ITEM_RE` is promoted to an export by the engine story, the one new export `work.mjs` gains).
  `work.mjs`'s import list stays the sanctioned three (`fs`, `node-identity`, `workspace`) plus nothing. This
  keeps the god-node a pure READER hub and confines the WRITER's blast radius to the engine + its command
  wrappers — the engine is a near-leaf that no existing dependent of `work.mjs` is forced to import.
- **The frontmatter rewriter is SURGICAL, mirroring `rollbackItemStatus`.** To bump `number:` or rewrite a
  `depends:`/`parent:` value the engine replaces ONLY the target line(s) inside the frontmatter block via a
  targeted regex and reassembles the record doc byte-for-byte around them — exactly as `rollbackItemStatus`
  rewrites only the `status:` line. It does NOT parse the whole record into an object and reserialize it, and it
  does NOT extend `parseFrontmatter` (18/ADR-007). `parseFrontmatter` stays a pure READER used to LOCATE which
  items carry a reference that must change; the WRITE is the surgical line replacement.
- **The engine is fs-mutating but otherwise pure over its inputs.** Given the same stream + `{ at, space }` it
  performs the same renames/rewrites; it reads no config for its core logic (the confirmation policy that DOES
  read config/flags lives at the command boundary, ADR-004), and it injects no clock into the docs it rewrites
  (it does not bump `updated`, matching `rollbackItemStatus`'s "only the target field changes" bound — a renumber
  is a mechanical identity change, not a content edit).

**Consequences.**
- The 36-module blast radius of `work.mjs` does not grow; the WRITER lives beside it, not inside it.
- `acd-reindex-engine-blast-radius` (below) fails CI if `work.mjs` ever imports a reindex/insert module, and — as
  the engine lands — asserts `work-reindex.mjs` imports `work.mjs` (the sanctioned direction), never the reverse.
- The record docs survive a renumber byte-identical except for the exact reference lines that changed — no
  reformatting churn, no dropped comments, honouring the 18/ADR-007 parser-minimalism cut.
- `ITEM_RE` becoming an export is the single, minimal surface change to `work.mjs` the whole milestone requires.

---

## ADR-002: Re-index is MECHANICAL — a deterministic `aof work insert-*` CLI does the number assignment + slot-open + template scaffold; PROSE framing stays prompt/PO-authored, layered on top. The renumber/rewrite is NEVER LLM-authored

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The milestone exists because hand-renumbering folders and hand-chasing every `depends`/`parent`
reference is error-prone and validate-breaking. That failure mode is exactly what an LLM reproduces if asked to
"renumber the stream" in prose: an off-by-one, a missed `depends` edge, a `parent` left dangling. So the renumber
MUST be deterministic code. But framing a new item well — writing its objective, its scope in/out, its user
story — is genuine authoring work, and the existing `add-milestone`/`add-story`/`add-uat` skills already do it as
PROMPT-DRIVEN commands that compute the next number, scaffold from `.aof/templates/work/<type>/`, and (for nested
stories) add a `## Stories` bullet, spawning `aof-product-owner` for the prose. Today those skills only ever
APPEND (`NN = max + 1`); they own no mechanical placement engine. The question is the split between mechanical CLI
and framing prompt.

**Decision.**
- **A new mechanical CLI subcommand family: `aof work insert-milestone|insert-story|insert-uat <slug> --at <P>
  [--yes]`.** Each is a THIN command wrapper over the ADR-001 engine, mirroring `commands/validate.mjs`'s
  thin-over-`validateWork` pattern (registered on command-core, dispatched from `cli.mjs`, `--json` envelope).
  The command does everything MECHANICAL and deterministic:
  1. run the ADR-001 engine to open the slot at `P` in the correct number space (ADR-005) — rename folders `≥ P`,
     bump `number`, rewrite `depends`/`parent` (ADR-003);
  2. scaffold the new item's skeleton from `.aof/templates/work/<type>/` INTO the freshly-opened slot `P`, with
     correct identity frontmatter (`number = P`, `type`, `slug`, `parent` for a nested story, `created`/`updated`
     = today) — the SAME templates `add-*` uses;
  3. for a nested `insert-story`, insert the `## Stories` bullet at the right position in the milestone SPEC
     (ADR-003, best-effort surface);
  4. leave `aof work validate` green.
- **PROSE framing stays prompt/PO-authored, layered ON TOP — unchanged from `add-*`.** The CLI produces a valid,
  correctly-numbered, correctly-referenced SKELETON; it does NOT invent the objective/scope/user-story. The
  framing skill (an `insert-*` skill, or an extension of the existing `add-*` skills that adds an `at <P>` arg and
  calls the mechanical CLI instead of computing `max + 1`) authors the prose into the scaffolded skeleton via the
  same `aof-product-owner` spawn `add-*` already uses. The division is: **placement + numbering + reference
  rewrite = code; wording = prompt.** This is the honest reading of "reusing the framing logic of their `add-*`
  counterparts" in the SPEC — same templates, same PO authoring, different (mechanical, positioned) placement.
- **The renumber is never expressed as an LLM instruction.** No skill prompt is permitted to say "renumber the
  following folders" or "update the depends"; every number mutation flows through the deterministic engine. The
  prompt's only numeric input is the target `P` the operator asked for; everything downstream of `P` is computed.
- **Rejected alternative — a single mega-skill that both frames AND renumbers in prose.** Rejected: it puts the
  error-prone renumber back in the LLM's hands, which is the exact defect the milestone removes. The mechanical
  core must be code with executable coverage, not prose.

**Consequences.**
- The renumber/rewrite is deterministic and test-covered; the failure mode the milestone targets (a missed
  reference, an off-by-one) cannot originate in an LLM step.
- `insert-*` reuses the `validate.mjs` thin-command shape, so wiring is one registration + one CLI dispatch entry
  per verb, and the `acd-work-command-cli-bijection` guard already covers the new verbs for free.
- Framing stays where authoring belongs (the PO/skill), the mechanical slot-open where determinism belongs (the
  engine). No new authority over prose is created.

---

## ADR-003: The correctness surface is TIERED — validate-green (folder/frontmatter/`parent`/`depends`) is GUARANTEED; the SPEC `## Stories` bullets are BEST-EFFORT; prose mentions and ROADMAP.md are explicitly NOT touched. This resolves the SPEC's overstatement of the machine-reference surface

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The SPEC and STATE list the re-index's reference targets as "`depends` edges, `parent`,
milestone→story checklist bullets, and ROADMAP.md rows". Reading what `validateWork` actually ENFORCES corrects
that list. `validateWork` checks: folder-name ↔ frontmatter (`number`/`type`/`slug`), `parent` resolves to a
milestone number, `depends` resolves to a top-level driver number, and the `depends` graph is acyclic. It does
**NOT** parse the milestone `## Stories` checklist bullets, and it does **NOT** parse `ROADMAP.md` at all —
`ROADMAP.md` is a PROSE backlog (`## 1.`, `## 2.` are backlog entries; "Origin: milestone 03" is a prose mention),
not a machine-readable index keyed to milestone numbers, and the only tooling that ever cross-referenced it — the
m15 work-doctor roadmap-folder check — shipped DORMANT / opt-in by design (15/R5). Resolution itself is
stateless and folder-derived (00/ADR-001): renaming a folder makes the new number resolve with zero rebuild, so
folder + frontmatter identity auto-follows the rename. The only STORED references that do NOT auto-follow are
`depends` and `parent`. The acceptance bar ("`aof work validate` green, no manual repair") must therefore be
defined against what validate actually enforces, not against the SPEC's broader prose list — otherwise the story
chases surfaces validate never checks and mislabels a best-effort sweep as a hard guarantee.

**Decision — three tiers, explicitly:**
- **Tier 1 — GUARANTEED (the validate-green surface; the acceptance bar).** After any insert, the engine keeps
  these consistent so `aof work validate` is green with no manual repair:
  - every renamed folder's frontmatter `number` matches its new folder name;
  - every `parent` still resolves to its (possibly-renumbered) milestone;
  - every `depends` still resolves to its (possibly-renumbered) top-level driver, and the `depends` graph stays
    acyclic (a renumber is a bijective relabel — it cannot introduce a cycle, but the guarantee is asserted).
  This is the definition of "did the re-index stay honest." It is the ONLY tier the acceptance `@executable`
  scenarios gate on.
- **Tier 2 — BEST-EFFORT (human-correctness surface, updated but NOT gated).** The milestone `## Stories`
  checklist bullets are prose the humans read; `validateWork` does not parse them. The engine updates them on a
  best-effort basis (renumbering the `NN/SS` refs / re-titling the bullet when a nested story shifts) because it
  is cheap and keeps the SPEC honest for readers — but a stale bullet is a human-doc nit, NOT a validate failure,
  and MUST NOT be the thing that makes an insert "fail." It is repaired opportunistically, not guaranteed
  byte-perfect.
- **Tier 3 — NOT TOUCHED (explicitly out).** Prose cross-references inside doc bodies ("see milestone 34",
  "#34") are NOT rewritten (SPEC out-of-scope, confirmed). **`ROADMAP.md` is NOT rewritten either** — this
  DEPARTS from the SPEC's "ROADMAP.md rows" phrasing, consciously: `ROADMAP.md` is prose with no
  machine-number-keyed rows to rewrite, and its only cross-reference tooling shipped dormant (15/R5). Treating it
  as a machine surface would invent a parser for a backlog that has no stable schema. If a ROADMAP sweep is ever
  wanted it is a separate best-effort follow-up, not part of this milestone's correctness bar.

**Consequences.**
- The acceptance bar is precise and outsider-verifiable: run `aof work insert-* --at P`, then `aof work validate`
  is green — that is the gate, and it maps exactly to Tier 1.
- The story's `@executable` scenarios assert Tier 1 (validate green, no dangling `parent`/`depends`, folder ↔
  `number` consistent) and MAY assert Tier 2 as best-effort; they assert NOTHING about `ROADMAP.md` or prose
  bodies.
- The SPEC's reference list is reconciled to what the tool enforces; no one later mistakes a stale `## Stories`
  bullet or a ROADMAP mention for a validate regression.

---

## ADR-004: The "how many items shift" COUNT is an engine primitive; the confirmation THRESHOLD lives at the command boundary; an autonomous caller passes intent via `--yes` so the guard never deadlocks automation

**Status:** Accepted
**Date:** 2026-07-16

**Context.** Inserting at `P` shifts every item `≥ P` in the target space. A small shift (a couple of items) is
routine; a large shift (renumbering half the stream) is a heavy, reference-churning operation the operator should
consciously confirm — the SPEC asks for a count-gated confirmation. But a confirmation prompt is a deadlock hazard
for the non-interactive callers this repo runs constantly (the `--autonomous` cascade that runs every sub-step and
reviews once at the end; CI; a mesh worker). The count must be a testable fact, the threshold a policy, and the
autonomous path must pass intent without a human at the keyboard.

**Decision.**
- **The count is a PURE engine primitive.** `src/work-reindex.mjs` exports a count function — indicatively
  `countShiftedByInsert(workDir, { at, space })` — that returns, deterministically from `listItems`, how many
  items in the target space have `number ≥ P` (and thus will be renamed). It reads no config and prompts nothing;
  it is a pure projection over the stream, unit-testable against a fixture. The engine's slot-open reuses this
  same primitive, so the number the operator is warned about is the number that actually shifts (one source of
  truth).
- **The THRESHOLD and the prompt live at the COMMAND boundary, not in the engine.** The `insert-*` command
  (ADR-002) calls the count primitive, compares it to a threshold, and decides whether to proceed silently or to
  warn + confirm — mirroring `validate.mjs`'s split (pure `validateWork` engine; the face renders/decides). The
  threshold is a single documented constant resolved from config via the raw optional-chain idiom (NOT the
  config-editor whitelist — the recurring lesson), with a named default; the Three Amigos pin the exact number at
  per-story refine. Below the threshold ⇒ proceed automatically; at/above ⇒ warn the operator the re-order is
  costly and require explicit intent.
- **Autonomous intent is passed by flag — `--yes` (alias `--force`).** A non-interactive caller supplies `--yes`
  to assert "I have decided; do not prompt." With `--yes` the command proceeds regardless of count (the count is
  still computed and REPORTED in the result envelope for the record, just not gated on a TTY). Without `--yes`
  AND above the threshold AND no TTY, the command FAILS LOUD with a coded error ("re-order shifts N items; re-run
  with --yes to confirm") rather than hanging on a prompt that no one will answer — the never-deadlock discipline.
  This lets the `--autonomous` cascade drive inserts by passing `--yes` once at the top.
- **The count is always in the result envelope.** `--json` carries `{ shifted: N, at: P, space, ... }` so a
  caller (or a review step) can see the blast radius of an insert without parsing human output.

**Consequences.**
- The threshold policy is decoupled from the mechanics: the engine stays a pure, promptless, testable core; the
  guard is a thin command-layer decision.
- Automation never deadlocks: `--yes` is the single intent seam; a missing-intent-above-threshold case fails loud
  and coded, never hangs.
- The warned count equals the shifted count by construction (shared primitive) — the operator is never warned
  about a different number than the one that moves.

---

## ADR-005: The milestone partitions into THREE stories along the two NUMBER SPACES plus their shared foundation — (1) the re-index engine, (2) top-level insert (`insert-milestone` + `insert-uat`), (3) nested insert (`insert-story`). Stories 2 and 3 are independent siblings built on top of story 1

**Status:** Accepted
**Date:** 2026-07-16

**Context.** Story boundaries should follow REAL coupling, so stories build in parallel with minimal cross-story
dependency. The graph and the source show the milestone has ONE risk-carrying shared core (the deterministic
renumber engine) and TWO independent number-space axes that consume it. The two axes are genuinely different code
paths with different risk (established facts, confirmed from `work.mjs`):
- **The TOP-LEVEL space** — milestones, uat, spikes, chores, adhoc stories share one number space. Inserting here
  shifts every top-level item `≥ P`, which means rewriting `depends` edges (they point at top-level driver
  numbers) AND the `parent` of every nested story whose milestone shifted. Higher-risk: it touches the reference
  graph.
- **The NESTED space** — `stories/SS_story_slug` local to one milestone. Inserting a story shifts only that
  milestone's nested stories `≥ SS`; `parent` is unchanged (same milestone), stories carry no `depends`, so the
  validate-green cost is near-zero and the only human surface is the milestone `## Stories` checklist. Lower-risk.
This is a case of counting LOGICAL seams, not physical files (37/R1): the seam is the two number spaces + the
shared engine, not the three command files — naming the engine as its own story (rather than hiding it inside
`insert-milestone`) is the honest partition, because both command families IMPORT it.

**Decision — the three stories (the PO creates the folders; this ADR is the rationale it cites):**
- **Story 1 — `reindex-engine` (the shared foundation, the critical path).** `src/work-reindex.mjs`: the
  deterministic renumber + folder-rename + `depends`/`parent` rewrite core (ADR-001, ADR-003 Tier 1), the count
  primitive (ADR-004), and the arch-tests. **NO command surface** — it is tested via its direct API against a
  fixture work-stream. This is the risk-carrying core both command families depend on; isolating it means the
  hard, deterministic logic is proven once, independently, before either command wraps it.
- **Story 2 — `insert-top-level` (`insert-milestone` + `insert-uat`).** The two commands that place a new top-level
  driver — identical top-level-space placement mechanics (same axis, same `depends`/`parent`-rewrite consequences),
  differing only in which template they scaffold — plus the ADR-004 count-gated confirmation guard at the command
  boundary. Depends on story 1.
- **Story 3 — `insert-story` (the nested axis).** `insert-story` on the nested `SS` space: shift the milestone's
  stories `≥ SS`, scaffold the new story, best-effort-update the `## Stories` bullet (ADR-003 Tier 2). Depends on
  story 1; independent of story 2.

**Why this cut follows the coupling.**
- Stories 2 and 3 both `import` story 1's engine but touch DISJOINT number spaces and disjoint command files — a
  mechanical merge has no conflicting hunk; they are parallel siblings on top of the foundation.
- Making the engine an explicit story (not a hidden helper inside `insert-milestone`) is what keeps story 2 and
  story 3 honestly independent: neither owns the shared core, so neither blocks the other on it once story 1
  lands.
- The one edit to `work.mjs` (export `ITEM_RE`, ADR-001) belongs to story 1 — the single, minimal touch of the
  god-node, made by the story that owns the engine.

**Consequences.**
- Three stories with a clean dependency shape: 1 is the foundation; 2 ∥ 3 build on it in parallel.
- The risk-carrying deterministic logic (story 1) is proven in isolation against a fixture before any command
  surface exists — the milestone's headline correctness is not entangled with CLI wiring.
- `insert-milestone` and `insert-uat` share one story because they are one axis; `insert-story` is a separate
  story because it is the other axis — the partition is the two number spaces, not the three verbs.

---

## ADR-006: Pinning ADR-001/004's INDICATIVE engine signature to three Three-Amigos findings — the nested axis takes a REQUIRED `parent` selector, folder renames run DESCENDING (highest number first), and the `insert-*` `--json` envelope ECHOES the created item's identity (and, for `insert-uat`, its post-shift-resolved `depends`) alongside ADR-004's `{ shifted, at, space }`

**Status:** Accepted
**Date:** 2026-07-16

**Context.** ADR-001 and ADR-004 gave the engine's exports INDICATIVELY —
`reindexForInsert(workDir, { at, space })` and `countShiftedByInsert(workDir, { at, space })` — and left the
exact shape to be pinned at per-story refine. The Three-Amigos review of the story 01/02/03 task `.feature`s
surfaced three concrete gaps in that indicative shape, converged on independently by three feasibility
reviewers and verified here against the source before writing this ADR:

1. **The nested axis cannot name WHICH milestone.** `listItems` (`src/work.mjs`) enumerates a nested story as
   `{ number: SS, parent: <milestone number>, ref: "NN/SS" }` — a story's number `SS` is unique only WITHIN
   its milestone, so `{ at, space }` alone cannot say which milestone's `stories/` space `space === "nested"`
   targets. The authored features already presume a selector: `01/03_two-number-space-axes.feature` ("in the
   \"nested\" space under milestone \"02\""), `01/04_count-shifted-primitive.feature` (same), and story 03's
   command (`insert-story <slug> --at SS --under NN`). Without a third field the nested slot-open and nested
   count are ambiguous.
2. **Folder renames have an undocumented collision hazard.** Shifting every item with `number ≥ P` up by one
   is a sequence of `NN → NN+1` directory renames. ADR-001 fixes WHAT is renamed but never the ORDER.
   Renaming a lower number first (`P → P+1`) collides with the folder still occupying `P+1`; on Windows a
   rename onto an existing directory fails outright (and case-folding/locking makes a silent overwrite worse).
3. **The insert commands have no black-box channel to confirm WHAT was written.** ADR-004 mandates the `--json`
   envelope carry `{ shifted, at, space }` — the blast-radius count only. But `findWork` (`src/work.mjs`)
   returns exactly `{ ref, type, slug, status, title, parent, dir }` — it never surfaces `depends`, `created`,
   or `updated`. So `insert-uat`'s depends-framing scenarios (`02/01_insert-uat-depends-framing.feature`) and
   story 03's "reports the new item's ref" (`03/00_insert-story-places-and-scaffolds.feature`) have NO
   outsider-observable way to confirm the created item's identity or its resolved `depends`. `validate --json`
   proves a `depends` RESOLVES, but not its literal post-shift value.

None of the three REVERSES a prior decision — all three PIN the shape ADR-001/004 explicitly left indicative,
plus one net-new envelope-contract decision.

**Decision.**
- **The nested axis takes a REQUIRED `parent` selector.** The indicative signatures are pinned to:
  - `reindexForInsert(workDir, { at, space, parent })`
  - `countShiftedByInsert(workDir, { at, space, parent })`

  where `parent` is the milestone number that owns the target `stories/` space (the same field name
  `listItems` already puts on a nested item). `parent` is REQUIRED when `space === "nested"` and
  absent/ignored when `space === "top-level"`; a nested call with no `parent` FAILS LOUD (coded), it does NOT
  silently fall back to a global story sweep. A nested slot-open/count is scoped to exactly the items whose
  `parent` equals `parent` (sameNum-normalised), so a nested insert under milestone A never disturbs milestone
  B or any top-level item. At the command boundary story 03's `--under NN` maps onto `parent`;
  `insert-milestone`/`insert-uat` pass `space: "top-level"` with no `parent`.
- **Folder renames run in DESCENDING numeric order.** To open a slot at `P`, the engine renames the affected
  folders highest-number-first, working down to `P` (`M → M+1`, then `M-1 → M`, … , `P → P+1`), so every
  target slot is already vacated before an item moves into it — collision-free on every filesystem, and safe
  on Windows where rename-onto-existing fails. Ascending order is FORBIDDEN. The count primitive is read-only
  and order-independent; this bound is on the slot-open's mutation only. The new item is scaffolded into the
  now-vacant `P` AFTER the shift (per ADR-002).
- **The `insert-*` `--json` envelope ECHOES the created item's identity, alongside ADR-004's count fields.**
  Every `insert-*` `--json` result carries, in addition to the ADR-004 `{ shifted, at, space }`:
  - `created: { ref, type, slug, parent }` — the newly-scaffolded item's resolved identity (`ref` is the
    zero-padded folder ref the item finally occupies, e.g. `"05/01"`; `parent` is `null` for a top-level
    driver, the milestone number for a nested story). This is the black-box channel story 03's "reports the
    new item's ref" and the placement scenarios read.
  - for `insert-uat` ONLY, `created.depends` — the resolved `depends` list AS WRITTEN into the new session's
    record doc, i.e. renumbered against the POST-shift stream (an operator naming a driver that itself shifts
    as a consequence of this insert gets its NEW number). `insert-milestone` and `insert-story` carry no
    depends concept and report `created.depends` as absent/empty (feature `02/01` asserts `insert-milestone`
    reports no depends).

  The envelope does NOT echo `created`/`updated` TIMESTAMPS — those stay confirmable via `validate --json`
  (feature `03/00` reads them there), keeping the echo an identity-and-references contract, not a full record
  dump. The echo is a FACE concern: the command's `--json` adapter shapes it (mirroring `validate.mjs`'s thin
  command), from an identity the engine hands back — the engine itself prints nothing.

**Consequences.**
- The nested slot-open/count are unambiguous and match the authored features verbatim; a nested call without
  `parent` is a loud coded error, never a silent cross-milestone sweep. `parent` is an engine ARG, not a new
  `work.mjs` export, so `acd-reindex-engine-blast-radius` (the `work-reindex → work` direction guard) is
  unaffected.
- The descending-order rule becomes an `@executable` invariant story 01 gates on — the one-slot-shift
  scenarios already exercise it end-to-end, and an ascending implementation would collide and fail them; no
  half-shifted stream survives a collision.
- Every insert is outsider-verifiable from `--json` alone (identity + shift count, plus resolved `depends` for
  uat), with `find`/`validate` as the independent second channel. `insert-uat`'s depends-framing scenarios
  gain the observable they require.

---

## Fitness functions (the enforced invariants)

Arch-tests live under `test/arch/acd-*.test.mjs` (node:test-style `archTests` arrays, registered in
`scripts/test.mjs`). Two are committed GREEN now, asserting invariants that hold TODAY and must not regress; the
target-state behavioural invariants that need the not-yet-built engine are recorded here as prose fitness criteria
and will be covered by the stories' `@executable` scenarios at per-story refine (NOT committed red now).

**Committed, GREEN today:**
- **`acd-reindex-resolution-folder-derived`** (ADR-003 foundation / honours 00/ADR-001). Behavioural proof that
  resolution is stateless and folder-derived, so "re-index by rename" is SUFFICIENT for resolution with no index
  to rebuild: in a fixture stream, `findWork`/`listItems` resolve a top-level number and a nested `NN/SS` pair;
  after renaming the folders to new numbers (simulating a shift) with NO rebuild step in between, a FRESH
  `findWork` resolves the NEW numbers and the OLD numbers resolve to nothing. If resolution ever grew a persistent
  index/cache, this fixture would resolve stale numbers and the test would fail.
- **`acd-reindex-engine-blast-radius`** (ADR-001). Source-discipline guard on the dependency direction:
  `src/work.mjs` imports NONE of a reindex/insert engine module (its import list stays the sanctioned `fs` /
  `node-identity` / `workspace`), so the god-node's 36-module blast radius does not grow. Guard-if-present: IF
  `src/work-reindex.mjs` exists, it MUST import `./work.mjs` (the engine depends on the readers, never the
  reverse); while it is absent, that half is a clean skip so the suite stays green pre-build and arms the moment
  the engine lands.

**Prose fitness criteria (covered by the stories' `@executable` scenarios once the engine exists — NOT committed
red now):**
- **Insert-at-`P` is an exact one-slot shift.** After `aof work insert-* --at P`, the new item occupies `P` and
  every pre-existing item that was `≥ P` in the target space has moved up by EXACTLY one — no gaps, no
  collisions, no double-shift. (Story 1 API scenario over a fixture; stories 2/3 end-to-end.)
- **Validate stays green after an insert (ADR-003 Tier 1).** `aof work validate` passes with no manual repair:
  folder ↔ frontmatter `number` consistent for every shifted item, every `parent` resolves, every `depends`
  resolves, the `depends` graph is acyclic. This is the acceptance bar.
- **No dangling reference.** No `depends` or `parent` value points at a number that no longer exists after the
  shift; a `depends` that pointed at a shifted driver now points at its new number.
- **The frontmatter rewrite is surgical (ADR-001).** A renumbered record doc is byte-identical to before except
  the exact reference line(s) that changed (`number`, and any `depends`/`parent` pointing at a shifted item) — no
  reformatting churn, no dropped comments, `updated` unchanged (mirrors `rollbackItemStatus`).
- **The renumber originates in code, never an LLM step (ADR-002).** Every number mutation flows through the
  deterministic engine; no skill prompt authors a renumber.
- **Count-gated confirmation never deadlocks automation (ADR-004).** Below-threshold proceeds silently;
  at/above-threshold without `--yes` on a non-interactive caller fails LOUD and coded (never hangs); `--yes`
  proceeds and the shifted count is always reported in the `--json` envelope.

---

## Out of scope / known follow-ups

- **Derived indexes key on item numbers and dangle after a renumber — but they REBUILD.** The memory index
  (`work memory`) records carry a milestone scope (`digest.scope.item`, the `(m<item>)` id tag) and source paths
  that embed `NN`; the graphify records are keyed on file paths that include the folder name. A renumber
  invalidates those keys. This is OUT of scope for the milestone (SPEC scopes the correctness surface to machine
  references in the work stream), and it is not a correctness hazard because BOTH indexes are DERIVED and
  rebuildable — `aof work memory reindex` (and a graph rebuild) re-key them from the renamed stream. **Follow-up
  worth flagging:** decide whether `insert-*` should trigger a memory reindex as a courtesy (so recall doesn't
  surface stale `(mNN)` tags until the next manual reindex), or leave it to the operator. Real, but derived +
  self-healing — not blocking.
- **Concurrent inserts.** Single-actor assumption (SPEC); two simultaneous inserts racing the same number space
  are not locked. Out of scope.
- **Moving / re-ordering an EXISTING item.** This milestone only INSERTS new items; renumber-in-place of already-
  present work reuses the same engine but is a separate capability (SPEC out-of-scope).
- **`insert-chore` / `insert-spike`.** Not requested; the engine and command shape extend to them without redesign
  when wanted (SPEC out-of-scope).
