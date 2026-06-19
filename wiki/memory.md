# Memory

> **The question this document answers:** *Where do a milestone's hard-won lessons go, and how does
> the next milestone recall them — so ACD agents improve over time instead of relearning the same
> mistakes?*

Every milestone distils its difficulties and bad decisions into a [`RETROSPECTIVE.md`](documents.md)
and its rationale into [`ARCHITECTURE.md` ADRs](documents.md). Without memory those lessons are
**siloed** in the folder that produced them: an architect about to repeat a "requiring-grep" mistake,
or a developer about to forget to pin line endings, has no way to be told *"we already learned this."*

**Memory** is the seam that carries those lessons forward. It is a **CLI surface** — `aof work memory
…` — that any ACD agent or command can call to **recall** relevant prior lessons at a decision point,
and to **ingest** new ones at Accept. It was delivered by milestone
[`05_work-memory`](work/05_milestone_work-memory/SPEC.md).

## The load-bearing constraint: memory is a *derived index*

The single rule the whole subsystem rests on:

> **Memory is a derived index, rebuildable from the work-stream `.md` files — never an authoritative
> second copy.**

This preserves ACD's single-source-of-truth principle ([philosophy.md → principle 4](philosophy.md)).
The source of truth is always the `RETROSPECTIVE.md` / `ARCHITECTURE.md` files themselves; the index is
disposable. A fresh rebuild reconstructs it exactly, nothing accretes, and **every record traces back
to live source text** (`path:line`). Without this, memory would become the very drift vector ACD exists
to defend against — a summary that silently diverges from the docs it summarises.

## The seam: `aof work memory <verb>`

The seam is **backend-agnostic by contract**. Agents call five verbs through one unchanging interface;
*which backend answers* is a config choice they never see.

| Verb | What it does |
|---|---|
| `recall <query>` | Surface prior lessons/ADRs matching a query, scope-filtered and ranked — "we already learned this" at the moment it would help. |
| `brief` | A situational digest: the lesson/ADR split + lessons-by-area (composed over `recall`). |
| `reindex [ref]` | Rebuild the derived index from the work-stream `.md` files. `--all` = whole stream; `--item NN` / a milestone ref = one milestone. |
| `ingest [ref]` | Alias of `reindex` — the verb agents call at Accept to fold a just-written lesson in. |
| `status` | Report the active backend, record count, store location, and lesson/ADR split. |

Scope flags are first-class filters: `--area --stage --kind --owner --item`, plus `--limit N` and
`--json` (the structured `records` array; the default is a rendered text view). The interface itself is
frozen at exactly **four methods** — `{ name, recall, reindex, status }`; `brief` and `ingest` are
seam-side conveniences, not new methods, so a richer backend never has to implement them.

The seam lives in [src/work-memory.mjs](../src/work-memory.mjs) and dispatches via `aof work memory` in
[src/cli.mjs](../src/cli.mjs).

## Where memory is stored

| Layer | Location | Notes |
|---|---|---|
| **Source of truth** | `wiki/work/NN_milestone_*/RETROSPECTIVE.md` and `…/ARCHITECTURE.md` | The `.md` files. Memory never owns this — it only reads it. |
| **Derived index** (local backend) | `.aof/aof.memory.index.json` (project root) | A single JSON file, **git-ignored**, rebuilt wholesale by `reindex`. The only artifact the local backend persists, and it is disposable. |
| **`none` backend** | nothing | Stores nothing; every verb is a graceful no-op. |

The index path is fixed ([src/memory/local-indexing.mjs](../src/memory/local-indexing.mjs)) and
`reindex` idempotently adds it to `.gitignore` — a committed index would be an authoritative second
copy, the invariant violation above. **In this repo today** the live `.aof/aof.config.json` selects no
backend, so `none` is active and no index file exists; the index is materialised on demand (e.g. by a
project that sets `memory.backend: "local"`, or by a temp-store reindex during verification).

## What goes into memory

The local backend parses **two source kinds** across every milestone folder, producing one record each:

- **`lesson`** — one per `## R<n>` heading in a milestone's `RETROSPECTIVE.md`. The meta line
  (`**Kind:** … · **Area:** … · **Stage:** … · **Owner:** …`) drives those fields; the heading drives
  `id` + `title`.
- **`adr`** — one per `## ADR-NNN` block in a milestone's `ARCHITECTURE.md`. `area` is always
  `"architecture"`; `status` comes from the block's `**Status:**` line.

Every record is the frozen **`MemoryRecord`** shape (ADR-005). Fields that don't apply to a record's
type are present as `""` (never omitted), so retrieval filters uniformly:

| Field | Meaning |
|---|---|
| `recordType` | `"lesson"` or `"adr"` |
| `id` | `R1`, `ADR-002`, … |
| `item` / `itemSlug` | the milestone number / slug the record came from |
| `title` | the de-emphasised heading prose |
| `area` / `stage` / `kind` / `owner` | scope fields (lesson meta line; `area="architecture"` for ADRs) |
| `status` | ADR status (lessons: `""`) |
| `summary` | the one-line gist — the short display line |
| `text` | the searchable blob (title + what/why/lesson, or context/decision/invariant) |
| `source` | `path:line` back to the live heading — the trace that proves the record is derived |

As of milestone 05's acceptance the live stream yields **38 records = 8 lessons + 30 ADRs**.

## How `recall` ranks

The spike's headline finding was that *ranking, not parsing, is the hard part* — raw term repetition in
a long ADR must not bury a short, on-point lesson. So retrieval ([src/memory/local-retrieval.mjs](../src/memory/local-retrieval.mjs))
applies, in order:

1. **Scope pre-filter** — the `--area/--stage/--kind/--owner/--item` flags are intersected (AND) and
   applied as a *hard* filter before any scoring. Off-scope records never compete.
2. **BM25-lite, length-normalised scoring** — so a dense short match beats a long term-heavy one.
3. **Title-match + record-type boosts** — a query-term hit in the title lifts a record; at equal
   relevance a `lesson` outranks an `adr` (a tiebreaker, never a relevance override).

The proof it works: `recall "requiring grep fitness function smell"` ranks milestone-01's **R1 lesson
#1**, far above the ADRs — a lesson first written in milestone N reaches the decision-maker building
milestone N+1, which is the whole objective.

## Backend selection

One config key, read in exactly one place (ADR-002), picks the backend:

```jsonc
// .aof/aof.config.json
"memory": { "backend": "local" }   // or "none"; absent ≡ "none"
```

- **`none`** (default) — a total no-op. ACD runs unchanged when memory is absent; recall returns empty,
  reindex reports zero. Nothing to install, nothing to break.
- **`local`** — the zero-dependency backend described above. Ships in the box.
- **future: semantic (e.g. MemPalace)** — a vector/semantic backend plugs in behind the *same* four
  verbs, with no change to a single agent prompt. That substitutability is the reason the seam exists;
  the cheap local backend proves the seam earns its keep first.

An unknown backend name is rejected by the `$defs/memory` schema enum, not discovered at runtime.

## What is wired today — and what is not

Memory is **callable but not yet auto-invoked.** The verb surface, the local backend, and config
selection are done and verified (stories `00`–`02`); the **read/write hooks** that wire it into the
loop are [story `03_story_memory-hooks`](work/05_milestone_work-memory/stories/03_story_memory-hooks/STORY.md)
— authored as acceptance criteria, not yet built:

- No bundled ACD agent or command prompt yet calls `aof work memory recall` / `ingest` on its own — not
  `refine`, not `continue`, not `verify`. An agent recalls only if a human runs the verb.
- So memory does not yet *automatically* surface a recall at a decision point or ingest a lesson at
  Accept. Threading the verbs into [the agent prompts and the workflow](agents.md) is the next step the
  seam was built to enable (see [05's spike findings](work/05_milestone_work-memory/spike/FINDINGS.md)).

Until those hooks land, the value is realised by invoking the verbs directly — `aof work memory recall
"<the decision you're about to make>"` before committing to an approach.

## Next

- The documents memory reads from (`RETROSPECTIVE.md`, `ARCHITECTURE.md`) → [documents.md](documents.md)
- Why single-source-of-truth / derived-not-duplicated matters → [philosophy.md](philosophy.md)
- Who would call recall/ingest once the hooks land → [agents.md](agents.md)
- The milestone that delivered it → [work/05_milestone_work-memory/](work/05_milestone_work-memory/SPEC.md)
