---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 00 · Work CLI — Architecture Decisions

## ADR-001: The folder name is the index; content reads never identify an item

**Status:** Accepted
**Date:** 2026-06-17

**Context.** Before this module, commands found work items by improvising
`**/*.md` globs and reading frontmatter to discover what each file *was*. That
couples every lookup to file content: an unparseable or half-written record doc
makes an item vanish from enumeration, and identity (number/type/slug) is only
knowable after a successful read. The work stream already encodes identity
structurally — every item is an `NN_type_slug` folder (see `wiki/documents.md`,
"Frontmatter — the authoritative record"). That structural index is the cheaper,
more robust source of truth for *which items exist* and *which one a ref means*.

**Decision.** Enumeration (`listItems`) and ref/slug resolution (`findWork`'s
matching) derive identity from folder names **alone** — they parse `NN_type_slug`
via `ITEM_RE` and never open a file to find or identify an item. Content (a
record doc's frontmatter, via `readMeta`) is read only *after* an item is already
resolved, and only to (a) enrich a matched row with `status`/`title`, or (b) be
cross-checked by the validator. The record stays the authoritative *record*; the
folder name is the authoritative *index*.

**Alternatives considered.**
- *Glob + read-to-classify (the prior approach)* — rejected: lookup depends on
  content, so a corrupt/missing doc erases the item and identity is unknowable
  until a read succeeds. Exactly the fragility this module removes.
- *A generated index/manifest file* — rejected: a second source of truth that
  drifts and needs regenerating; the folder layout already *is* the index, for free.

**Consequences.** Discovery is total and content-independent: every well-named
folder is listed and every ref resolves even if its record doc is absent or
malformed (`readMeta` swallows the read error, yielding the match with `null`
status/title). The folder grammar `ITEM_RE` becomes load-bearing — a rename
changes identity, a malformed name silently drops the item from the index (the
validator, not discovery, is where doc-level defects surface). This is the
invariant a fitness function must protect against regression toward
content-coupled lookup.

**Invariant.** Enumeration and ref-resolution match on folder names only; content
reads happen only to enrich or validate an already-resolved item — never to find
or identify one. (Enforced below by `work-content-free-discovery`.)

## ADR-002: Identity is duplicated (folder ↔ frontmatter) as controlled redundancy

**Status:** Accepted
**Date:** 2026-06-17

**Context.** Given ADR-001, the folder name carries identity for *mechanics*. But
the record doc's frontmatter also carries `type`/`number`/`slug` — so the record
survives a change of folder convention or an export to another store, and stays
self-describing in isolation. Two copies of identity invite silent drift.

**Decision.** Keep the duplication deliberately, and make the validator
(`validateWork`, check 1: folder ↔ frontmatter) assert the two copies agree —
`type`, `number`, and `slug` must match the folder. Redundancy is *controlled*:
the index and the record may each stand alone, but a divergence is a CI finding,
not a tolerated state.

**Alternatives considered.**
- *Identity in the folder name only* — rejected: the record doc becomes
  non-self-describing and brittle to relocation/export.
- *Identity in frontmatter only* — rejected: would force content reads to
  enumerate, breaking ADR-001.

**Consequences.** The two sources can be trusted to agree because CI enforces it;
discovery may rely on the folder while tooling/exports may rely on the record.
The agreement is a *behavioural* property of the validator (it has its own tested
scenarios), so it is **not** a fitness function here — only ADR-001's
content-free-discovery invariant is.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| Enumeration and ref-resolution depend on folder names only; corrupt/absent record docs still list every item and still resolve `NN`, `NN/SS`, and a slug (yielding `null` status/title) | `test/arch/work-content-free-discovery.test.mjs` (behavioural proof over a content-corrupted fixture) | ADR-001 |
