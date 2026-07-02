---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  COMPACTED at Accept (2026-06-30): durable decisions live in ARCHITECTURE.md (ADR-001..004);
  the process lessons graduated to RETROSPECTIVE.md (R1..R6); the build blow-by-blow and the
  `## Feedback (for retro)` running notes are archived (their content has graduated). What
  remains is the closure record + the follow-ups carried out of this milestone.
-->
# 22 · Mesh Foundation — State

## Status: DONE (accepted `2026-06-30`)

Lifecycle: framed `2026-06-29` (`aof:shatter` from
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), Phase 1) →
refined `2026-06-30` (`aof:refine 22 --autonomous`: ARCHITECTURE.md = 4 ADRs + 4 fitness functions; 3
independent stories, each Contract authored) → built + reviewed `2026-06-30` (`aof:continue 22`; architect
GAPS→resolved, QA PASS) → **verified + accepted `2026-06-30` (`aof:verify 22`)**.

All three stories `done`: **00 mesh-store** (`src/mesh-store.mjs` — the partition seam + opaque per-node
persist/read + the `aof mesh` skeleton + arch-tests #1/#2/#3), **01 node-identity** (`src/node-identity.mjs`
+ `mesh:identity`/`mesh:status` + the `meshVerbCli` face), **02 git-sync** (`src/mesh-sync.mjs` — the
payload-agnostic git transport + `mesh:sync` + the injected-ticker cadence loop + arch-test #4).

**Verification (`→ VERIFICATION.md`):** `@executable` suite + all 4 fitness functions green (3 verify-time
full-suite runs, 1598/0 each — flake-detection satisfied); the `@manual` 22/02/02 outsider acceptance passed
end-to-end (two nodes on a shared remote each render the other's record, merge-clean, purely over git —
11/11, driven only through the `aof mesh` face). `aof:validate 22` → PASS. Two non-blocker findings (F1, F2).

## Durable decisions

Graduated to [ARCHITECTURE.md](ARCHITECTURE.md): **ADR-001** (`mesh:*` as command-core commands + the
namespace bijection gate), **ADR-002** (the path-partition convention — `meshDir`/`nodeRecordPath`, adopting
19's frozen `runRecordPath` shape for the run dimension), **ADR-003** (node-id derivation + the frozen 7-key
capability descriptor), **ADR-004** (the git-sync engine — git stays the system of record; honest failure;
pathspec-scoped commit; injected-ticker cadence). Process lessons → [RETROSPECTIVE.md](RETROSPECTIVE.md)
(R1..R6).

## Carried follow-ups (out of m22)

- **F1 / R5 — line-ending pin (→ m23).** The git-tracked `.mesh/` records need a `.gitattributes`
  `eol=lf` / `-text` pin so a mixed-OS fleet sees byte-stable records. Non-blocker; m23 builds presence on
  the same bus. (`VERIFICATION.md` F1.)
- **F2 / R6 — same-host id collision (→ backlog).** `mesh:identity.run` derives the id from the hostname
  without feeding `takenIds`, so two same-host installs collide on one `nodes/<id>.json`; ADR-003's
  collision-suffix is unreachable from the command path. Wire `takenIds` from the post-sync roster on
  republish, or document the operator-set-`mesh.nodeId` constraint. Non-blocker. (`VERIFICATION.md` F2.)
- **R2 — Examples mis-spec.** Correct `tasks/01_path-partition-convention.feature`'s two traversal-row
  `expected-leaf` literals to the coerced leaves (`--escape.json` / `a-b.json`). Cosmetic; the test asserts
  the genuine no-escape invariant for all rows.
- **R4 — self-host ignore.** Add `wiki/work/.mesh/` to the aof self-host repo's `.gitignore` (the self-host
  repo is not itself a mesh node; in a real deployment `.mesh/` IS the committed bus).
- **Latent edges → m23 triage** (clean catches, logged in build, no process lesson): `readNodeRecord`
  null-ambiguity (absent vs literal-null); `readNodeRecords` silently skipping a torn record file;
  `flatLeaf`'s cosmetic trailing-dot leaf. All path-safe / rebuildable; below the m22 contract.

## Accept decision

**ACCEPTED `2026-06-30` by `aof:verify 22`** — automated + agent-run lanes green, `@manual` outsider
acceptance passed, validate PASS, no blocker finding open. See `VERIFICATION.md ## Accept decision`.
