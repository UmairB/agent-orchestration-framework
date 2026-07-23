---
doc: verification
milestone: 41
verified: 2026-07-19
verifier: aof:verify
verdict: accept
---
<!--
  Milestone VERIFICATION.md — the verification record. Pointers, not restatements.
  Only sections with content are written (absence of a section is information — no @uat, no UI here).
-->
# 41 · Work-item insertion & re-index — Verification

Ref resolved via `aof work find 41 --json` → milestone `work-item-insertion`, 3 stories, all
`in-review` at gate entry. Lanes in scope: **`@executable` only** — all 13 task scenarios are
`@executable`; there are **no `@manual` and no `@uat`** scenarios, and **no UI/`DESIGN.md` surface**.
The human-acceptance step and the design-conformance review are therefore both out of scope (no user is
pestered, no browser render). This is a foundational CLI/engine milestone verified entirely on its
automated contract.

## Verification evidence

### Automated + fitness functions (no human)

- **`@executable` suite green** — `node scripts/test.mjs` → exit 0, **2576 ok / 0 not-ok** (zero
  `not ok` lines), plus the Rust `app/desktop` lanes green (`cargo test` 79 passed, `cargo check` ok).
  The 19 m41 test modules (`test/work-reindex-*.mjs`, `test/work-insert-*.mjs`, `test/arch/acd-reindex-*.mjs`)
  contribute ~100 m41-scoped assertions inside that total, all green. *verifies →* `01/*.feature`,
  `02/*.feature`, `03/*.feature` `@executable`.
- **Both m41 fitness functions armed + green** (they self-activate now that `src/work-reindex.mjs`
  exists and `work.mjs` exports `ITEM_RE`):
  - `arch/ADR-001(m41)` — *`src/work.mjs` imports NO reindex/insert engine module; the 36-module
    god-node blast radius does not grow* (+ the guard-if-present: once `work-reindex.mjs` exists it
    imports `./work.mjs`, never the reverse) → **ok**. *verifies →* `acd-reindex-engine-blast-radius`.
  - `arch/ADR-003(m41)` — *a top-level folder RENAME (05 → 07) re-resolves with no index rebuild;
    resolution is folder-derived* → **ok**. *verifies →* `acd-reindex-resolution-folder-derived`.
- **Traceability + litmus (agent-only layer of `aof:validate`)** — the 13 task features map 1:1 to the
  19 m41 test modules, enforced live by the registry fitness functions `acd-work-command-cli-bijection`,
  `acd-work-command-route-coverage`, and `command-core-contract` (`WORK_IDS` exact-membership) — all
  green in the suite run above, so `work:insert-milestone` / `work:insert-uat` / `work:insert-story` are
  honestly registered across every registry-derived guard (the BOARD route bijection is satisfied via a
  documented `BOARD_DEFERRED` carve-out, ADR-002's CLI-only scope). The load-bearing invariants
  verified through real observable channels at build (QA behavioural lens, CONFORMS): exact one-slot
  shift, whole-stream validate-green after an insert (Tier 1), byte-identical surgical frontmatter
  rewrite, `>=`-threshold count-gate on both axes, and fail-loud-nothing-mutated.
- **`aof work validate 41` → PASS** (exit 0, `[]`) — folder↔frontmatter, closed tag vocabulary, depends
  graph, all clean for the milestone and its three stories.

### Environmental note (not a m41 finding)

Whole-stream `aof work validate` surfaces exactly one finding — `38_.../stories/03_story_per-org-credential-scoping/STORY.md`
"missing or empty record doc". This is a **pre-existing milestone-38 hygiene issue**, unrelated to m41:
the file is untracked (`??`) and begins with the bundle marker `<!-- aof-generated: bundle -->`, which
`parseFrontmatter` (anchoring on `^---` with no `/m`) reads as empty — the exact framework bug already
documented in m41's own STATE `## Feedback`. m41's reindex engine was **never run against the live
stream** (only against isolated test fixtures), so it did not cause this. Flagged for the m38 owner;
**not a m41 blocker**. Scoped `validate 41` is clean.

## Re-verification — Claude command surface (re-open 2026-07-19)

The 2026-07-16 acceptance verified the CLI + engine but missed that the milestone shipped **no bundle
command surface** for the insert commands, so the feature was unusable via `aof work update` (RETROSPECTIVE
R5). Re-opened, fixed, and re-verified against the SPEC "Acceptance criteria — Claude command surface":

- **Wrappers authored + declared** — four `src/bundle/commands/insert-{milestone,story,uat,chore}.md`
  (the whole insert family — `insert-chore` had the identical defect), each mirroring its `add-*` twin and
  describing placement via the mechanical `aof work insert-*` CLI (ADR-002). Declared in `bundle.json`;
  `manifest.json` regenerated (73 entries). Each renders BOTH a `/aof:insert-*` Claude command and a codex
  `aof-insert-*` skill (capability matrix, ADR-006). *verifies →* acceptance criterion 1.
- **Parity guarded** — new registry-derived fitness function `acd-work-insert-command-bundle-parity`:
  every `work:insert-*` command in the registry must have a matching bundle command member under the `aof`
  namespace — no carve-out, so a future insert command cannot ship CLI-only again. *verifies →* criterion 3.
- **Focused suites green (126 assertions / 0 not-ok)** — the new parity test + every guard the change
  touches: `acd-bundle-membership`, `acd-bundle-manifest-hashes`, `acd-command-namespace` (count tripwire
  17→21), `acd-capability-delegation`, `acd-work-command-cli-bijection`, `bundle.test.mjs` (command set +
  resource count 25→29), `command-core-contract`, plus the render-path suites (`roundtrip-install-proof`,
  `work-init`, `roundtrip-harness`, `bundle-spike-chore-membership`).
- **Proven end-to-end in a consumer repo** (criterion 2 — reachable via `aof work update`, not just green
  tests; memory: green tests ≠ running system) — `aof work init` into a throwaway repo renders all four
  `/aof:insert-*` commands + codex skills; `aof work update` on an install that lacked them reports exactly
  **`4 created`** (idempotent no-op when already present). The user's original complaint, observed fixed.

## Findings

Both findings below were surfaced at the build/craft-review gate and deferred there; recorded here as
the canonical findings home. My verify run surfaced no new defects.

| id  | observed | type | severity | triage | routed-to | status |
|-----|----------|------|----------|--------|-----------|--------|
| F-4101 | A stream crossing a 2→3 digit numbering boundary (inserting so item `99` shifts to `100`) ends with a non-uniform zero-pad width across the stream — `reindexForInsert` preserves each shifted item's own existing width and never re-pads the whole number space. Rare in practice. | non-blocker (edge-case / design decision) | low | defer | backlog — whether to re-pad every sibling on a boundary crossing is a design call, not a bug fix | open (deferred) |
| F-4102 | `rewriteReferences` (src/work-reindex.mjs) and `renumberDepends` (src/commands/insert-shared.mjs) both assume `depends` is an INLINE list (`depends: [a, b]`) — the only form `parseFrontmatter` parses today. A YAML BLOCK-list `depends:` would parse to empty and survive a renumber un-rewritten, silently dangling. Latent, not exploitable — no author writes block-list `depends` in this codebase. | non-blocker (latent limitation) | low | defer | backlog — blocked on `parseFrontmatter` growing block-list support | open (deferred) |

<!-- Only genuine defects/gaps are tabled. No blocker finding — acceptance proceeds. -->

## Accept decision

**RE-ACCEPT (2026-07-19).** The re-opened Claude command surface gap is closed and verified per the
section above — four bundle wrappers shipped + rendered on both runtimes, guarded by a registry-derived
parity fitness function, 126 focused assertions green, and proven end-to-end (`aof work update` → `4
created`). No blocker. The milestone is accepted again → `done`.

**ACCEPT (2026-07-16, CLI/engine).** The only lane in scope — `@executable` — is fully satisfied: suite green (2576 ok / 0
not-ok) with both m41 fitness functions armed and green, the 13 task features traced 1:1 through the
green registry guards, and `aof work validate 41` PASS. No `@manual`/`@uat` lane exists (foundational
CLI/engine milestone, no UI), so no human sign-off and no design conformance apply. Both open findings
(F-4101, F-4102) are deferred non-blockers — no blocker finding is open. The one whole-stream validate
finding is a pre-existing, unrelated m38 doc-hygiene issue outside this milestone's scope. All three
stories (`41/01`, `41/02`, `41/03`) are accepted → `done`; the milestone is accepted.
