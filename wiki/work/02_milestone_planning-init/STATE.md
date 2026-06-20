---
doc: state
---
# 02 · Planning Init (the bought seam) — State

> **Compacted at close (aof:verify 02, 2026-06-19).** The blow-by-blow build/fix log and the
> `## Feedback (for retro)` running notes have **graduated**: their lessons live in
> [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R8), the defect record + triage in
> [VERIFICATION.md](VERIFICATION.md) `## Findings`, and the durable decisions in
> [ARCHITECTURE.md](ARCHITECTURE.md) (ADRs). This file now keeps only the outcome, decision pointers,
> and carried follow-ups.

## Outcome — ACCEPTED 2026-06-19

All three stories `done`; milestone `done`. The bought planning seam stands end-to-end:
`aof planning init --runtime claude` registers pm-skills over HTTPS at the clonable tag `#v2.0.0`,
installs the 3 recommended planner plugins, and records pinned-sha provenance; `aof:shatter` discovers
and reads a real `create-prd` PRD into objective + scope + milestone chunks and stamps `origin`; and all
pinned state lives in named sections of the single `.aof/aof.lock.json`.

- **00 · planning-init** — `aof planning init` (`src/planning-init.mjs` + CLI). Reopened twice at verify
  (F1 SSH transport → ADR-007; F2 sha-not-clonable → ADR-008 + the networked clone-smoke); both resolved,
  live install proven.
- **01 · shatter-consumes-prd** — `discoverPrd`/`readSeam` (`src/planning-prd.mjs`), `shatter.md` bound to
  the helper. Reopened once at verify (F3: read-out empty on the real 8-section template → ADR-010
  hardened `readSeam`; genuine create-prd output is now a first-class fixture); resolved, re-verified.
- **02 · unify-project-lock** — the per-vertical lock files (`aof.planning.lock.json`,
  `aof.work.lock.json`) eliminated and folded into named sections of `.aof/aof.lock.json`; every writer
  read-merge-writes (ADR-009, superseding ADR-003 + m01-ADR-004).

Three blocker stops total (F1 → F2 → F3), all at `aof:verify`, all resolved; one non-blocker (F4)
deferred. Final suites green: full `test` 523 ok / 0, `test-unit` 544 ok / 0; 8/8 milestone fitness
functions, 0 skipped (the networked clone-smoke ran).

## Durable decisions (graduated to ARCHITECTURE.md)

Recorded as ADRs — referenced, not restated:
- **ADR-001/002** — install mechanics (plan → dry-run → network boundary → argv spawn); 40-hex sha is the
  integrity anchor.
- **ADR-004** — Claude-first; `--runtime codex` honestly degrades (marketplace-only, `pluginsInstalled:false`).
- **ADR-005** (annotated) / **ADR-010** — the PRD-discovery convention + the create-prd 8-section read-out
  contract (`### 7.2 Key Features` → chunks; `## 8. Release` bold-lead labels → in/out scope; additive
  fallbacks keep the hand-shaped + inline fixtures green).
- **ADR-007 → ADR-008** — marketplace source = HTTPS git URL pinned at the clonable tag `#v2.0.0`
  (superseding the SSH shorthand, then the bare `#<sha>`); resolved commit recorded as the audit anchor.
- **ADR-009** — the single `.aof/aof.lock.json` with flat asset fields + nested `planning`/`work`
  sections; every writer preserves foreign sections (supersedes ADR-003 + m01-ADR-004).

No SECURITY/COMPLIANCE/DESIGN doc — proportionate ceremony (supply-chain folded into ADR-002 + the
`acd-planning-provenance-sha` fitness function; no regulated data; no UI surface).

## Carried follow-ups (out of this milestone's scope)

- **ROADMAP.md §1 install snippet is factually wrong** — [wiki/ROADMAP.md](../../ROADMAP.md) shows the
  Claude verb as `add` (it is `install`) and implies a `<runtime>=claude|codex` parity that does not
  exist (no `codex plugin install`). The ADRs hold the correct contract; the ROADMAP still shows the bad
  one. Fix the ROADMAP (or raise `aof:feedback`) so a future reader doesn't re-introduce the wrong commands.
- **F4 (deferred, backlog/housekeeping)** — two orphaned atomic-write temp files
  (`.aof/.tmp-aof.lock.json-…`, dated 2026-05-16/22, old pre-ACD `gsd` lock shape) linger in the
  gitignored `.aof/`. Predate this milestone. Delete them; optionally have the atomic lock writer clean
  its temp on a failed rename. See VERIFICATION.md `## Findings` F4.
- **R7 / ADR-008 consequence** — a `marketplaceVersion` bump must run the networked clone-smoke **online**
  (it loud-skips offline), because `MARKETPLACE_REF = v${VERSION}` assumes a `v`+semver tag shape.
