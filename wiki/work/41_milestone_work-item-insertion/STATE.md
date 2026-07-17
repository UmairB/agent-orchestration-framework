---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  COMPACTED at Accept (2026-07-16, aof:verify 41): durable decisions graduated to ARCHITECTURE.md
  ADR-001..006; the blow-by-blow build log + the ## Feedback (for retro) notes graduated to
  RETROSPECTIVE.md (R1..R4); verification evidence lives in VERIFICATION.md.
-->
# 41 · Work-item insertion & re-index — State

## Progress

**ACCEPTED `2026-07-16`** via `aof:verify 41` — all three stories `done`, milestone `done`.

- Framed + broken down `2026-07-16` (`aof:refine 41` → architect `ARCHITECTURE.md`, 5 ADRs + a
  reconciling ADR-006); all three stories' task `.feature`s authored in one cascaded Three-Amigos pass
  (`--autonomous`) — 13 tasks total (01: 5, 02: 4, 03: 4).
- `01 · reindex-engine` — **done** (5/5 tasks). Deterministic renumber + `depends`/`parent` rewrite core
  + pure shift-count primitive (`src/work-reindex.mjs`); descending renames, surgical single-line
  frontmatter rewrite, the one sanctioned `work.mjs` touch (`ITEM_RE` export). Architect + QA review PASS.
- `02 · insert-top-level` — **done** (4/4 tasks). `work:insert-milestone` + `work:insert-uat` over the
  engine, count-gated confirmation (threshold = 5) + `--yes` override, `--json` envelope echoes created
  identity. Depends on 01. Architect + QA review PASS.
- `03 · insert-story` — **done** (4/4 tasks). `work:insert-story` nested axis (required `parent`),
  best-effort `## Stories` checklist update (recognises both bullet forms, honestly reports `skipped`).
  Depends on 01, ∥ 02. Architect + QA review PASS.
- Craft review (2026-07-16) fixed 4 should-fix bugs with regressions (atomic pre-flight before any
  rename; CRLF/BOM-tolerant bundle-marker strip + `.gitattributes` pin; loud fail on a silent `number:`
  bump no-op; `## Stories` updater recognises both bullet forms) + closed 3 QA coverage gaps.

## Durable decisions (graduated)

Recorded in [`ARCHITECTURE.md`](ARCHITECTURE.md):
- **ADR-001** — the re-index engine is a NEW leaf module (`src/work-reindex.mjs`) that imports `work.mjs`'s
  readers, never the reverse (guards the 36-module god-node blast radius); surgical single-line frontmatter
  rewrite à la `rollbackItemStatus`, never a `parseFrontmatter` reserialize.
- **ADR-002** — re-index is MECHANICAL (`aof work insert-*` CLI); prose framing stays prompt/PO-authored;
  the renumber/rewrite is NEVER LLM-authored.
- **ADR-003** — the correctness surface is TIERED: validate-green (folder/frontmatter/`parent`/`depends`)
  guaranteed; `## Stories` bullets best-effort; prose + ROADMAP.md not touched (resolves the SPEC's
  machine-reference overstatement — see RETROSPECTIVE R1).
- **ADR-004** — the shift COUNT is an engine primitive; the confirmation THRESHOLD lives at the command
  boundary; `--yes` carries autonomous intent so the guard never deadlocks automation.
- **ADR-005** — the three-story partition along the two number spaces + their shared engine foundation.
- **ADR-006** — pins ADR-001/004's indicative signature: nested axis takes a required `parent`, folder
  renames run DESCENDING (highest-first — a real Windows collision hazard), and the `--json` envelope
  echoes the created item's identity (+ resolved `depends` for `insert-uat`).

Process lessons → [`RETROSPECTIVE.md`](RETROSPECTIVE.md): R1 (define the acceptance bar against what the
tool ENFORCES, not the SPEC's prose), R2 (the bundle-marker framework bug births validate-broken record
docs — recurred at verify in m38/03; carried as a root-fix `chore`), R3 (a new `work:*` command trips
THREE registry guards, not one), R4 (a shared placeholder token meaning different things per frontmatter
key can't be served by one blanket-replace).

## Verification

See [`VERIFICATION.md`](VERIFICATION.md). Summary: `@executable` suite + both m41 fitness functions green
(`node scripts/test.mjs` → exit 0, 2576 ok / 0 not-ok), `aof work validate 41` PASS. **No `@manual`/`@uat`
lane** and no UI/`DESIGN.md` (foundational CLI/engine milestone — no human sign-off, no design conformance).
Two deferred non-blocker findings (F-4101 pad-width non-uniformity across a 2→3 digit boundary; F-4102
inline-only `depends` rewrite vs block-list). Environmental note: whole-stream validate flags a pre-existing,
unrelated m38 doc-hygiene issue (bundle marker) — outside m41's scope, flagged for the m38 owner.
