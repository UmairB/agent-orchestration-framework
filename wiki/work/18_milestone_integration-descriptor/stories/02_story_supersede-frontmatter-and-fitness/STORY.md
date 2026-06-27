---
type: story
number: 02
slug: supersede-frontmatter-and-fitness
parent: 18
status: done
owner: product-owner
created: 2026-06-26
updated: 2026-06-27
---
# 02 · Supersede the frontmatter mechanism + author the fitness invariants

## User story

As a maintainer who must not leave the superseded design half-standing, I want the prior milestone-18
frontmatter mechanism **removed at the root** — `src/work.mjs` `parseFrontmatter` reverted to its **pre-m18
minimal** shape (no inline-flow-map `{}` branch), the central `notion.parent` frontmatter convention gone,
and the five superseded arch-tests + their behavioural tests deleted — and the new design **locked by the
milestone's fitness invariants** (FF-A..F), so the shared frontmatter parser is de-risked for all 14 of its
importers and the descriptor design is enforced in CI, not just intended.

<!-- The CLEANUP + FITNESS story (ARCHITECTURE.md ADR-007 + §Fitness functions). `work.mjs` is the
     GOD-NODE (14 importers) — reverting its parser branch is the highest-blast-radius cut in the milestone,
     and is safe ONLY after stories 00+01 have made the descriptor the sole routing source (nothing reads
     `notion.parent` from frontmatter). This story therefore lands LAST. It also authors the six new
     fitness arch-tests atomically with deleting the five they supersede. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 18 --autonomous`, Contract stage). The two `.feature`
     tasks carry the OBSERVABLE behaviour of the revert + the schema/convention removal. The six fitness
     arch-tests (FF-A..F) are the milestone's STRUCTURAL invariants — authored in THIS story under
     test/arch/ and wired into scripts/test.mjs, atomically with deleting the five superseded arch-tests
     (acd-notion-associate-frontmatter-only, -association-committed, -parent-no-read, -parent-projection,
     -parents-schema) and the superseded behavioural tests (notion-associate*, notion-parent-projection,
     notion-parents-schema). They are NOT .feature tasks — see §Notes for the full list. -->

- [x] **00 · [parser-reverted-to-minimal](tasks/00_parser-reverted-to-minimal.feature)** — `parseFrontmatter`
  / `parseScalarOrCollection` back to the pre-m18 minimal reader: a scalar, a quoted scalar, and an inline
  list `[a, b]` (e.g. `depends: [17]`) still parse exactly as before; an inline **flow map**
  `notion: { parent: p1 }` in frontmatter **no longer parses to an object** — the `{}` branch is gone, so it
  round-trips as a stripped scalar string and routes **nothing**; the work-stream `validate`/`list`/`next`
  traversals over real items are unaffected by the revert.
- [x] **01 · [legacy-mechanism-removed](tasks/01_legacy-mechanism-removed.feature)** — the superseded
  mechanism carries no meaning: a milestone with a stray `notion: { parent: … }` in its **frontmatter** (and
  no `.integrations.json`) projects **top-level** (frontmatter is no longer a routing source); the schema no
  longer exposes a **notion-top-level** `parents` peer to `boards` (the central global map is gone — `parents`
  lives per board, ADR-001/002); a config written in the prior-m18 shape (a top-level `notion.parents` beside
  the boards registry) is **rejected** at the Ajv-2020 seam.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): **ADR-007** (revert
`parseScalarOrCollection` to scalars + inline lists only — drop the `{}` inline-flow-map branch
`src/work.mjs:138-150`; remove the `notion.parent` convention + the notion-top-level `parents` schema block;
safe only after 00+01) and the **§Fitness functions** suite.

**The six fitness arch-tests authored in this story** (under `test/arch/`, wired in `scripts/test.mjs`):
- **FF-A · `acd-integrations-descriptor-committed`** — routing read from `.integrations.json` + config, never
  the sidecar; the sidecar entry shape gains no routing field. *Supersedes* `acd-notion-association-committed`.
- **FF-B · `acd-integrations-reader-is-json`** — the reader uses `JSON.parse` with no `parseFrontmatter`
  dependency, AND `parseScalarOrCollection` has no `{}` flow-map branch (encodes the revert). *New.*
- **FF-C · `acd-integrations-board-resolution`** — board resolution + default fallback + the absent-descriptor
  ⇒ m17-byte-for-byte arm. *Subsumes the no-regression arm of* `acd-notion-parent-projection`.
- **FF-D · `acd-integrations-no-notion-read`** — no Notion spawn-seam / read-verb on associate or projection +
  the `acd-notion-one-way` snapshot guard. *Supersedes* `acd-notion-parent-no-read`.
- **FF-E · `acd-integrations-descriptor-extensible`** — the reader tolerates an unknown provider key (ignored,
  not a hard failure). *Supersedes the extensibility intent of* `acd-notion-parents-schema`.
- **FF-F · `acd-integrations-boards-schema`** — the `boards` registry (+ flat back-compat `oneOf`) validates at
  the Ajv-2020 compile seam; a malformed board / unknown peer is rejected; the block stays closed.
  *Supersedes* `acd-notion-parents-schema`.

**Deleted atomically** (with their mechanism): the five superseded arch-tests above and the behavioural
`notion-associate` / `notion-associate-registered` / `notion-associate-roundtrip` / `notion-parent-projection`
/ `notion-parents-schema` test files + their `scripts/test.mjs` imports **and** registrations (the dev grep
resolves this to 8 imports + 8 registrations + the backing files; delete `acd-notion-association-committed`
**atomically** with this story — its self-check greps `projection.mjs` for `meta.notion.parent`, which story 01
removes, so it goes red in the 01→02 gap). **Kept:** `acd-notion-one-way` (reaffirmed by FF-D) and
`acd-notion-mapping-sidecar` — the latter's **re-point** to the v2 multi-board sidecar shape is owned by
**story 01** (it lands with the `mapping.mjs` re-shape); this story only KEEPS the file, changing nothing in it.

**Independent in scope but build-ordered LAST** (00 → 01 → 02): the revert + the test-swap are a single
atomic cleanup, but the god-node parser cut is correctness-safe only once nothing reads `notion.parent` from
frontmatter — which is true only after stories 00 (descriptor write) and 01 (descriptor read in projection)
land.

**Feasibility (developer amigo seat — confirmed at Contract): BUILDABLE as specified, no contract change.**
The **gating grep** (the load-bearing 00→01→02 dependency) found exactly ONE runtime reader of an inline-map
frontmatter value as an object: `projection.mjs:51` (`item.meta?.notion?.parent`) — replaced by story 01's
descriptor read. `notion-associate.mjs` reads/writes `notion.parent` via its OWN regex (not the `{}` branch)
and is retargeted by story 00; `notion-sync-work.mjs:64` reads only title/status. So **no non-routing reader
relies on the `{}` branch** — the revert is correctness-safe once 00+01 land. **Build notes:** (1) post-revert
`parseScalarOrCollection("{ parent: p1 }")` falls to the quote-strip return = the literal string
`{ parent: p1 }` (the task-00 step-def asserts `meta.notion` is that string and `meta.notion.parent` is
`undefined` — not empty, not the inner). (2) The schema `oneOf` accept/reject matrix was verified against live
Ajv-2020; a rejected config reports a cluster at `/work/integrations/notion`, so the task-01 step-def matches
"some error at that instancePath" (the `acd-notion-parents-schema` idiom). (3) **FF-A** must word-bound its
forbidden-field matcher (`\bboard\b`) so it does not false-positive on the v2 `boards` bucket key in
`mapping.mjs`. Arch-test idioms to mirror are present: `test/arch/acd-notion-parents-schema.test.mjs` (Ajv seam),
`acd-notion-associate-frontmatter-only.test.mjs` (registry temp-fixture + non-vacuous self-check),
`acd-notion-one-way.test.mjs` (comment-stripped source-grep + snapshot guard).
