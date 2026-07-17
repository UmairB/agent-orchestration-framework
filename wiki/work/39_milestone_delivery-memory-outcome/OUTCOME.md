# 39 · Delivery Memory — Outcome

## Delivered

### The OUTCOME.md record doc
The aof bundle ships a milestone `OUTCOME.md` template (`## Delivered` / `## Assumptions` / `## Gaps`) at both `src/bundle/templates/milestone/OUTCOME.md` and `.aof/templates/work/milestone/OUTCOME.md`, LF-pinned and carrying the leading bundle marker; `aof:verify` instantiates and authors it at Accept, and `recordDoc` never resolves to it — it is an additional artifact, never an item's identity record doc.

### Delivery is recallable over the ADRs
`parseOutcome` turns each `## Delivered` `### ` heading into a `capability` record and each `## Gaps` `### ` heading into a `gap` record through the shared `buildRecords`, so delivery records reach both the `local` and `graphify` backends from one edit; a capability-intent recall ("what provides X / is X built") returns the capability record ahead of verbose keyword-dense ADRs via a bounded `TYPE_BOOST_CAPABILITY` (0.1, strictly below `TITLE_BOOST_PER_TERM` 0.6) plus an `--area delivery` hard pre-filter.

### Gaps are schedulable debt
A `gap` record carries an `open` | `discharged` lifecycle in the reused `MemoryRecord.status` field and its discharge condition in searchable text; `aof work memory recall --status open` returns only open debt (`status` is now a scope flag in `work-memory.mjs` and a scope field in `local-retrieval.mjs`), and `aof work promote-gap` (backed by the new `aof work insert-chore` seam) scaffolds a top-level `chore` whose `## Definition of Done` is seeded from an open gap's discharge condition and which back-references the originating gap.

### The dangling-declaration fitness function
`test/arch/acd-outcome-declared-field-has-producer.test.mjs` computes the `MEMORY_RECORD_FIELDS` entries with zero producer write-site among the record parsers and fails red on any non-empty result, catching a declared record-format field with no writer (the `warnings_delivered` shape) whether or not an `OUTCOME.md` declared it; a planted producerless field trips the same detector, so the check is proven able to fail.

## Assumptions

- **`aof:verify` is the sole author of `OUTCOME.md`** — the delivery record's worth is bounded by the record-doc-ownership rule (ADR-004); a developer or evidence subagent authoring it reintroduces the fabrication path this milestone counters.
- **A capability's title names the surface it delivers** — the recall surfacing rests on authoring discipline: a capability whose title carries the queried terms earns the title boost and out-ranks a verbose ADR, while the bounded capability boost does not rescue a mis-titled capability.
- **The declared field set is a single-source enumerable list and its producers are same-language grep-able assignment sites** — the dangling-declaration check is statically reachable only for record-format fields (`MEMORY_RECORD_FIELDS` × its parser write-sites) and makes no claim beyond that class.

## Gaps

### Automated gap discharge (open to discharged) has no producer
- **Status:** open
- **Discharge condition:** a promoted chore records the originating gap's structured `source` ref (not only its title in prose) and a chore-completion path flips the linked gap's `status` from `open` to `discharged`.
A promoted chore's link back to its gap is unstructured prose (the gap title under `## Notes`); no code path sets a gap's `status` to `discharged` when its chore completes, so a gap is discharged only by a manual re-author of the `OUTCOME.md`, never automatically.

### Dangling-declaration coverage is record-format fields only
- **Status:** open
- **Discharge condition:** a statically-enumerable declaration source and a producer-detector exist for one of CLI flags, HTTP endpoints, or config keys, wired into a fitness function under `test/arch/`.
The fitness function catches a producerless `MEMORY_RECORD_FIELDS` field and renders no verdict on CLI flags, HTTP endpoints, config keys, or dynamic, computed, reflective, or cross-language producers; those declaration classes carry no dangling-declaration check.

### Per-capability assumption attribution is unexpressed
- **Status:** open
- **Discharge condition:** the `## Assumptions` grammar and `parseOutcome` gain per-capability nesting so an assumption attaches to a named capability rather than the last one in document order.
Every `## Assumptions` bullet folds into the last `## Delivered` capability's searchable text; a milestone with more than one capability cannot attribute an assumption to a specific earlier capability, and this record's own assumptions fold onto "The dangling-declaration fitness function."
