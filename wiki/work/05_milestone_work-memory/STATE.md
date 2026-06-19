---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 05 · Work Memory — State

**Reopened 2026-06-19** — scope corrected. The seam (stories `00`–`02`) was built, verified, and
accepted, but scoping the **read/write hooks out** was the wrong cut: a callable seam that no command
invokes leaves the objective ("agents improve over time") unmet. Added story **`03_story_memory-hooks`**
to *use* the seam (recall at `refine`/`continue`, ingest at `verify`); milestone status → `in-progress`.
Stories `00`–`02` remain `done` and their acceptance stands ([VERIFICATION.md](VERIFICATION.md)); the
milestone closes again once `03` is built and verified.

**Story `03` verified + accepted 2026-06-19** (`aof:verify 05/03`) — milestone **re-closed**. The two
`@executable` tasks (00 render + 04 no-op) are green in both runners; the three `@manual` tasks
(01 refine / 02 continue / 03 verify) were discharged by agent observation over the **live `wiki/work`
stream** in a throwaway root (index isolated to a temp `.aof/`; the repo's `.aof/` never written): the
architect `--area architecture --block` and developer `--kind near-miss --block` read hooks surface a
compact, scope-filtered, milestone-qualified block, and the `verify` ingest hook — run after this
milestone's `RETROSPECTIVE.md` gained **R5** — folded the new lesson in (recordCount 47 → 48) so R5 is
recallable #1 at its live source. The lone finding (F1, the colliding-ids injection gap) was resolved at
the story-03 review gate before `in-review` and graduated to RETROSPECTIVE **R5**. Gate
`aof:validate 05` → PASS; **zero `@uat`**, no user sign-off owed. All four stories `done` → `SPEC.md
status: done`. Evidence + accept decision in [VERIFICATION.md](VERIFICATION.md) "Story 03" appendix.

**Story `03` built + reviewed 2026-06-19** (`aof:continue 05/03`). Built the read/write hooks: the one new
mechanical surface `renderRecallBlock` (the compact injection block) + a `--block` flag on the `recall`
verb in `src/work-memory.mjs`; the `@manual` recall/ingest steps wired into the bundled `refine`/`continue`/
`verify` prompts (manifest regenerated); the no-op-when-off guard rides on the `none` backend (no prompt
branches on the backend name — `acd-memory-backend-selection` stays green). Both `@executable` tasks green:
`00_recall-block-injectable` (5 scenarios) + `04_hooks-inert-when-memory-off` (7 cases) — **556 unit ok / 0
failing**, all 6 fitness functions green. The three `@manual` tasks (`01`/`02`/`03`) are wired and deferred
to `aof:verify` (agent-observed). Structural review (architect): **CONFORMS**. Behavioural review (qa):
PASS with one design-gap fixed at the gate (see Feedback). Story `status: in-review`; **next: `aof:verify 05/03`**.

**Seam accepted 2026-06-19** (`aof:verify 05`, stories `00`–`02`). Compacted at that close: the durable
decisions have graduated to ADRs ([ARCHITECTURE.md](ARCHITECTURE.md) ADR-001…007); the Review-gate
process lessons have graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4) and the
`## Feedback (for retro)` section has been archived with them; the verification record lives in
[VERIFICATION.md](VERIFICATION.md). The blow-by-blow framing/refine/build/review narrative has been
archived; only the closure record and carried follow-ups remain below.

## Outcome

All three independent stories built, verified, and accepted — the backend-agnostic `aof work memory`
seam (ADR-003) with a zero-dependency local backend behind it:

- [x] `00_story_memory-seam` — `aof work memory` verb surface + `config.memory.backend` selection +
  `$defs/memory` schema + the `none` no-op backend → `src/work-memory.mjs`, `src/memory/none-backend.mjs`,
  `aof work memory` dispatch in `src/cli.mjs`. (`status: done`)
- [x] `01_story_local-backend-indexing` — RETROSPECTIVE + ARCHITECTURE parsers → derived index at the
  git-ignored `.aof/aof.memory.index.json`; `reindex`/`status` → `src/memory/local-indexing.mjs`.
  (`status: done`)
- [x] `02_story_local-backend-retrieval` — scope pre-filter + BM25-lite ranking + title/record-type
  boosts; `recall`/`brief` → `src/memory/local-retrieval.mjs`. (`status: done`)
- Integration glue `src/memory/local-backend.mjs` composes 01's index + 02's recall behind the frozen
  4-method interface; the seam composes the `brief` digest from `recall`'s records (no 5th method).

Verification: `@executable` (13) + `@manual` (1, live-stream corpus) — all green; 6 fitness functions
green; **zero `@uat`**. The live `reindex` parsed **34 records = 4 lessons + 30 ADRs** (exact match to
the stream's `## R<n>` + `## ADR-NNN` corpus), and recall surfaced milestone-01's R1/R2 lessons #1 —
the objective ("a milestone-N lesson reaches the decision-maker in N+1") is met. Gate
`aof:validate 05` → PASS. See [VERIFICATION.md](VERIFICATION.md). Milestone 05 is a leaf (nothing
`depends:` on it).

## Carried follow-ups

Open items deliberately deferred past this milestone (not lessons — see RETROSPECTIVE.md for those):

- **ADR-006 wording correction owed (RETROSPECTIVE R2).** ADR-006's invariant text still credits the
  anti-inversion guarantee to length-normalisation *alone*; the honest property is the combined
  length-norm + title + record-type signal stack. ADRs are immutable, so the correction is owed to a
  **superseding ADR** (or carried into the semantic-backend milestone that revisits ranking).
- **`brief` digest consolidation (RETROSPECTIVE R1).** Story 02's `local-retrieval.brief()` /
  `renderBriefText()` remain feature-tested but are now redundant with the seam-side `briefDigest`
  (`src/work-memory.mjs`). Consolidate when the deferred read/write hooks land.
- **Read/write hooks — PULLED INTO SCOPE (story `03`, 2026-06-19).** Auto-injecting `recall` into the
  bundled `refine`/`continue` prompts and `ingest` into `verify` at Accept is no longer deferred — it is
  story `03_story_memory-hooks`, the work that makes the objective true. (The MemPalace semantic/vector
  backend behind the same verbs remains the out-of-scope later milestone.) See `spike/FINDINGS.md`.
- **Title backtick-stripping (flag).** The parsers strip markdown backticks from titles (a display
  field) — `01_parse-architecture-adrs.feature` was authored to that reading. Flag in case the PO ever
  wants verbatim heading text.
- **`none`-vs-`local` scope echo divergence (low impact).** The `none` backend echoes the raw `scope`
  while `local` echoes the normalised scope; only bites a programmatic caller passing unknown scope
  keys (the CLI never produces them). Left for a future polish pass.

## Notes & decisions in flight

- **`@memory` domain tag (default decision, 2026-06-19, refine `--autonomous`; confirmed at the review
  gate).** Added `@memory` to `work.tags.domains` in `.aof/aof.config.json` — the closed vocabulary had
  no domain for a distinct subsystem ADR-002 makes a first-class top-level config object. All 14 task
  features tag `@cli @work @memory`; `aof work validate` accepts the vocabulary. Durable; kept.
- **Spike (`spike/`) — throwaway exploration, retained as provenance.** `memory-spike.mjs` proved the
  verb shape and the headline finding (ranking, not parsing, is the hard part — F1) against the real
  stream before the contract locked. Not a deliverable; informs the hooks/semantic-backend follow-ons.

## Feedback (for retro)

<!-- Archived at the story-03 close (aof:verify 05/03, 2026-06-19). The one story-03 review-gate
     observation — the injection block dropping milestone provenance under colliding ids — has graduated
     into RETROSPECTIVE.md R5 (and was logged as VERIFICATION finding F1, closed). Nothing else pending;
     the section is retained empty as the record that the graduation happened, exactly as durable
     decisions graduate into ADRs. -->

_None — graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) R5 (F1 in [VERIFICATION.md](VERIFICATION.md))._
