---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 09 · Graphify Command Core — State

> **Compacted at Accept (2026-06-22).** Durable decisions live in [ARCHITECTURE.md](ARCHITECTURE.md)
> (6 ADRs); the verify evidence + findings in [VERIFICATION.md](VERIFICATION.md); the execution lessons
> in [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R6). The blow-by-blow build/review narrative is archived.

## Progress

- **Framed → Refined → Built → Verified & ACCEPTED (2026-06-21 → 2026-06-22).** Shattered from
  [PRD-graphify-integration.md](../../planning/PRD-graphify-integration.md) as the foundation of the
  three-milestone graphify arc (09 → 10/11). Refined (`aof:refine 09 --autonomous`) into **5 independent
  stories** (00 spine · 01/02/03/04 fan out) over 6 ADRs; built in waves (`aof:continue 09`); verified
  and accepted (`aof:verify 09`). All five stories **done**: **00** graph-command-core · **01**
  binary-provisioning · **02** rendered-faces · **03** graph-fitness · **04** mcp-server-runtime.
- **MCP face split (durable).** ADR-005's "MCP server asset" was split into a rendered **config entry**
  (story 02, on the existing machinery) + a net-new **server runtime** (`aof graph serve`, story 04). The
  runtime is **hand-rolled stdio JSON-RPC, no SDK** — see ADR-005 (amended) and RETROSPECTIVE R4.
- **Accepted 2026-06-22** (`aof:verify 09`). `@executable` (990/0) + the six ADR-006 fitness functions
  (991/0) green; the live `@manual` lanes (binary-resolution, build, query, triage, MCP round-trip) pass
  against the store-provisioned graphify 0.8.44; `aof work validate 09` = PASS. The gate caught and fixed
  two blockers (F1 fitness-hermeticity regression from milestone 12; F2 build `--out` driver defect) and
  deferred one non-blocker (F3 hyperedge key) — see VERIFICATION.md + RETROSPECTIVE R5/R6.

## Durable decisions & carry-forwards (for milestones 10/11)

<!-- The decisions 10/11 inherit. Full rationale in the ADRs; this is the pointer + the still-open flags. -->
- **Install path = Option B** (ADR-004): assets-only provisioning + an `aof project doctor` check;
  `src/frameworks.mjs` (npx) untouched. Superseded/extended by **milestone 12** (managed `~/.aof` tool
  store + `aof project provision`; the resolver is now store-first). Reversible if a future milestone
  needs aof to own the install lifecycle.
- **Command verbs / result shape** (ADR-001): the stable façade `graph:build`/`graph:query`/`graph:triage`,
  each result derived from `graph.json`; graphify's markdown `stdout` carried opaque, never parsed.
- **No `@graph` tag domain.** The `work.tags` vocabulary is closed; graph work maps to existing tags
  (driver → `@adapter`; faces → `@assets`/`@distribution`; provisioning → `@scaffold`; fitness →
  `@validate`). **Flag** if a dedicated domain is wanted before 10/11.
- **Live-only graphify assumptions re-verify on any version bump** (RESEARCH §A; pinned 0.8.44). Confirmed
  live at verify: `extract` writes **target-relative** (driver pins `--out projectRoot` — ADR-002 amended,
  R5); `prs` verb exists (hidden from `--help`); the store binary probes `--version` → `0.8.44`. **Still
  open (F3, deferred):** the normalizer reads `raw.graph.hyperedges` but 0.8.44 emits `hyperedges`
  top-level — fix + re-fixture from a real captured artifact before relying on hyperedge counts.

## Verification

<!-- Pointers, not restatements. Full evidence + findings live in VERIFICATION.md. -->
- **Accepted 2026-06-22** — `@executable` green (990/0), six ADR-006 fitness functions green (991/0), all
  live `@manual` lanes pass, `aof work validate 09` PASS, no blocker open. Findings F1/F2 **fixed &
  re-verified**; F3 deferred to backlog. See [VERIFICATION.md](VERIFICATION.md).
- Feedback-for-retro graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R6) and archived from here.
