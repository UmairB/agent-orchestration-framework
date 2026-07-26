---
type: story
number: 00
slug: doctor-command-core
title: "The doctor command core — work:doctor on the command spine, its finding envelope, the pluggable engine, and every face"
parent: 15
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
schema: 1
aofVersion: 0.1.0
---
# 00 · The doctor command core — the spine the check-groups plug into

## User story

As the work stream's health lane (and as the three sibling stories that author the check-groups and wire the keystone),
I want `work:doctor` registered on the milestone-08 command core with its own `{ code, severity, path, message }` finding envelope, a `doctorWork(workDir, config, scope, { now, staleWindow })` engine that builds the item snapshot once and runs a registry of pure check-GROUP functions, a CLI face (`aof work doctor [scope] [--json] [--strict]`) with the advisory/`--strict` exit policy, a thin `/api/work/doctor` board route, and the milestone-08 bijection arch-tests generalised from "exactly six" to registry-derived,
so that the health lane has ONE canonical command both faces inherit for free (no new door), an envelope `--strict` and the faces can reason over, and an extension seam stories 01/02 — and milestone 16 — append check-groups into without editing each other.

<!-- This is the SPINE (ADR-001/002/003/005). It freezes the finding envelope, the snapshot-once +
     pure-check-group-registry engine, the injectable clock, the `--strict` face policy, and the
     registry-derived bijection. It ships with ZERO or ONE trivial check-group — the real groups are
     stories 01/02. It owns the four cross-cutting fitness functions. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 15/00`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. Structural invariants
     (envelope contract, determinism, registry-derived bijection, --strict exit matrix) live in the
     ARCHITECTURE.md fitness functions as arch-tests, NOT here. -->

- [x] **00 · [doctor-command](tasks/00_doctor-command.feature)** — `work:doctor` registered in the core; `invoke("work:doctor",{scope?})` → `{ findings }`; scope-as-filter (unresolved scope → empty, no throw); a clean fixture → empty findings (healthy), a seeded violation → a finding.
- [x] **01 · [cli-face](tasks/01_cli-face.feature)** — `aof work doctor [scope] [--json] [--strict]`: the human render (healthy line / `severity: code — message`, cwd-relative paths); `--json` envelope (cwd-relative) + the `{ healthy, strict, errors, warnings, findings }` summary; the advisory-vs-`--strict` exit behaviour observable through the face.
- [x] **02 · [board-face](tasks/02_board-face.feature)** — `/api/work/doctor` answers the envelope through the registry (projectRoot-relative, forward-slashed paths); a thin pass-through with no operation logic in the face; the board never gates (no `--strict`).
- [x] **03 · [engine-spine](tasks/03_engine-spine.feature)** — `doctorWork` builds the snapshot once (reusing `listItems`/`readMeta`) and concatenates a registry of pure `(snapshot, ctx) => Finding[]` group fns; an appended group's findings appear (the milestone-16 extension seam); identical `code+path+message` findings de-dupe.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-001 envelope · ADR-002 `--strict`
face policy · ADR-003 engine/clock · ADR-005 registry-derived bijection). This story **owns**:
`src/commands/doctor.mjs` (registers `work:doctor`, the CLI face) and the `doctorWork` engine + the
check-group registry (whether it lives in `doctor.mjs` or a `src/work-doctor.mjs` sibling of `work.mjs`
is the developer's call); it adds the `work:doctor` entry to the `COMMANDS` array in
[command-core.mjs](../../../../../src/command-core.mjs), the `subcommand === "doctor"` branch in
`workCommand` ([cli.mjs](../../../../../src/cli.mjs)), and the `/api/work/doctor` route in
[board-ui.mjs](../../../../../src/board-ui.mjs). It **reuses** `work.mjs`'s `listItems` / `readMeta` /
`parseFrontmatter` / `isDriver` / `recordDoc` / `ITEM_RE` — it adds NO new identity parsing and does
**not** duplicate `validateWork`'s per-file checks. It lands the four cross-cutting **fitness functions**
(envelope contract, engine determinism, the two generalised bijection arch-tests, `--strict` exit) — the
test change to the two existing bijection files ships WITH the wiring so the suite stays green.

**Independent because** it consumes nothing new — only the already-shipped `work.mjs` model and the
milestone-08 command core — and produces the ONE frozen contract (the envelope + the engine's check-group
registry + the faces) that stories 01/02/03 consume. It is the spine they fan out from; it carries zero or
one trivial check-group so the spine is provable end-to-end without their groups.

**Feasibility (developer amigo seat — confirmed at Contract):** every seam already exists — the command
contract (`{id,input,run,cli}`), the basis-neutral `{ findings }` shape and scope-as-filter (cloned from
`validate.mjs`), the `--strict` exit form (read verbatim from `cli.mjs` `doctorCommand`), the snapshot
model (`listItems`+`readMeta`), and the injectable-seam idiom (config doctor's `resolveManagedBinary`).
The only genuinely new code is the group-registry composition and the one mtime probe in the snapshot — a
new *consumer* of the model, not a change to it. The bijection generalisation is a swap of two hard-coded
literals for a `listCommands()`-derived set.
