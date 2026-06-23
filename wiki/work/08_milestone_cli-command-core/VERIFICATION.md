---
doc: verification
ref: "08"
verified: 2026-06-21
verdict: "milestone accepted — all four stories (00 command-core, 01 cli-face, 02 board-face, 03 command-fitness) done; @executable suite + the four ADR-004 fitness functions + the re-anchored board-write-isolation green; m03 board envelope byte-for-byte intact; no blocker finding open"
---
# 08 · CLI Command Core — Verification

Verification lanes in scope: **`@executable` only** (10 task features across stories 00/01/02 — every
Scenario Outline row — plus story 03's four arch-tests, whose contract is ADR-004 itself). There are
**zero `@manual`** scenarios (a backend-contract inversion: every structural guarantee is an arch-test
and every observable behaviour is `@executable`; there is no agent-runnable live procedure beyond the
automated harness) and **zero `@uat`** scenarios — the milestone re-homes existing operations behind a
contract and changes no rendered surface, so there is no human-judgement surface and the user is not
pulled in. No `DESIGN.md` / UI surface (the board's rendered UI + API envelope are unchanged), so the
design-conformance lens does not apply.

## Verification evidence

- **`@executable` suite — green.** `node ./scripts/test.mjs` → **886 ok / 0 not-ok (exit 0)** (was 798
  at milestone start). The three traceability modules cover stories 00/01/02 end-to-end and are all
  registered in [scripts/test.mjs](../../../scripts/test.mjs) and spread into the run array:
  `test/command-core-contract.test.mjs` (story 00 — the registry `{id,input,run,cli}→result` contract,
  the six registered commands, the basis-neutral result, the feedback write moved into the command),
  `test/cli-face-contract.test.mjs` (story 01 — `work doc`/`work tasks`/`work feedback` added +
  `list`/`validate`/`next` rewired through the registry via the scope-aware `render(result, faceCtx)`
  adapter), and `test/board-face-contract.test.mjs` (story 02 — `/api/work*` reduced to
  route→invoke→projection, the error envelope/status and the resolver distinction preserved).
  verifies → all 10 `@executable` task features under `stories/0{0,1,2}/tasks/*.feature`.
- **Fitness functions — green (the load-bearing deliverable, ADR-004).** All four arch-tests pass and
  are registered + run in the suite:
  `acd-work-command-route-coverage` (inv. 1 — every served `/api/work*` route maps to a registered
  `work:<op>` command; no UI route without a command), `acd-work-command-cli-bijection` (inv. 2 — every
  registered command carries a non-null `cli` adapter **and** a reachable `aof work <sub>` dispatch
  branch; no command the CLI cannot run), `acd-work-ui-no-core-import` (inv. 3 — `board-ui.mjs` imports
  no work-operation core from `./work.mjs`, no `parseFeature` from `./feature-parse.mjs`; the registry
  `./command-core.mjs` is the only operation-bearing door; it runs no work-operation filesystem call of
  its own; and `setup-ui.mjs` reaches the work surface only via the board face), and
  `acd-work-command-no-subprocess` (inv. 4 / ADR-001 — no `child_process` import, no spawn/exec, and no
  `aof` CLI string on the work-serving path: the boundary is in-process, not per-request subprocess).
  Negative-control / mutation verification (each test bites on a deliberate breach) was performed at
  build and recorded in STATE.
  verifies → the structural invariants in [ARCHITECTURE.md](ARCHITECTURE.md) ADR-004 `## Fitness functions`.
- **Migration observably inert — m03 envelope byte-for-byte.** The re-anchored
  `acd-board-write-isolation` arch-test is green (the sole feedback-write helper now lives in
  `src/commands/feedback.mjs` and targets STATE.md / the verbatim heading; the board runs the operation
  in-process via the registry, never a CLI shell-out; no frontmatter/status write, no restatus route),
  and the milestone-03 regression nets stay byte-for-byte green: `board-api/00` (list endpoint serves
  the flat work-list contract), `board-api/03` (validate endpoint returns the validator's findings,
  scoped reporting, changes no files), and the `work list --json` / `work list` / `work validate`
  contract tests. The board returns what it did before the inversion on both faces.
  verifies → SPEC `## Objective` ("the board returns byte-for-byte what it does today") + the inv. 1–4
  enforcement.

## Validate gate

`aof:validate 08` → **PASS**. The keystone `aof work validate 08` exits 0 with `PASS — 08 is
well-formed.` (folder↔frontmatter, the closed tag vocabulary, the `depends: [00, 03]` graph resolving
and acyclic). Agent layer clean: **test-traceability** — every `@executable` scenario (and every
Scenario Outline row) is backed by a green test registered in `scripts/test.mjs` (the three contract
modules + the four ADR-004 arch-tests + the re-anchored board-write-isolation are all imported and
spread into the run array; 886 ok / 0 fail); no `@manual` evidence row or `@uat` sign-off row is owed;
no dangling `@finding-<id>` and no `verifies →` to resolve (no findings raised); no `uat` session in
scope. **Litmus** advisory-clean — the structural invariants are arch-tests (their correct home per
ADR-004's closing note, not inside a behaviour feature), and the `@executable` `Then` steps assert the
observable surface only: the `--json` command contract, the CLI's byte-for-byte stdout, and the board's
milestone-03 API envelope — none asserts internal call ordering, registry internals, or any visual
fidelity.

> Note: the whole-stream `aof work validate` reports 3 issues, **all in milestone 09**
> (graphify-command-core — scenarios carrying both `@manual` and `@executable`). Milestone 09 is a
> separate, still-being-refined milestone and is **out of scope** for this gate; the scoped `validate 08`
> is clean.

## Accept decision

**Accepted — 2026-06-21.** Gate `aof:validate 08` is PASS, the `@executable` + fitness lanes are green
(886 ok / 0 fail; 4/4 ADR-004 fitness functions + the re-anchored board-write-isolation), the m03
envelope is byte-for-byte intact on both faces, and **no blocker finding is open** — the build was
clean. The three review-stage should-fixes (the dead `cli.render` adapter trio reconciled through
`faceCtx`, the QA human-render/CLI-slug coverage gaps, the `no-core-import` guard extended to
`setup-ui.mjs`) were all caught and resolved *before* this gate; the three process/ADR-text
observations (the workspace-loader re-export the registry needs, the "kept green" → "re-anchored,
guarantee preserved" wording, and the dead-adapter lesson) are not behaviour defects and are carried
into [RETROSPECTIVE.md](RETROSPECTIVE.md). All four stories are `done`, so the milestone is accepted:
`SPEC.md status: done`, its `## Stories` boxes ticked, `STATE.md` compacted. No human `@uat` lane
existed, so no user sign-off was required. This is the **foundational milestone of a multi-milestone
inversion** — it establishes the CLI-as-contract command core and proves it on the read-mostly
`/api/work` surface; the `/ws/terminal` session-launch seam and the setup-UI CRUD follow on their own
milestones, inheriting the now-enforced contract.
