---
doc: retrospective
updated: 2026-06-22
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. Reference findings/ADRs/commits, never restate.
  Source: STATE ## Feedback (for retro) + VERIFICATION ## Findings + blocker stops.
  Clean findings with no process lesson stay in VERIFICATION — they are NOT retro entries.
-->
# 12 · Managed Tool Provisioning — Retrospective

## R1 — A supersession "in place" drags the prior milestone's tests into the blast radius

- **Kind:** near-miss · **Area:** architecture · **Stage:** refine (surfaced at build) · **Owner:** architect · **Raised by:** developer (build)
- **What happened.** ADR-003/ADR-004 superseded milestone-09's `graphify-binary` doctor check (→ `managed-tool`)
  and the `resolveGraphifyBinary` install hint (→ `aof project provision graphify`). That silently invalidated
  **09's** own tests — the traceability test `test/graph-binary-provisioning.test.mjs` and the 09 fitness
  function `test/arch/acd-graph-binary-absent.test.mjs` (09/ADR-006 inv.3) — which asserted the old check id /
  old hint string. The build had to find and update them mid-wave.
- **Why.** The superseding ADRs framed the change as "supersede the check/string in place" but did not enumerate
  the prior milestone's `@executable` + fitness tests that assert that exact id/string — so the build did not
  budget for them up front.
- **Lesson.** When an ADR supersedes a prior milestone's check/string/contract **in place**, name the prior
  milestone's affected `@executable` + fitness tests in the superseding ADR's **Consequences**. The guarantee
  is preserved (09 inv.3 — warns-when-absent / degrades-clearly / never-crashes — still holds over `managed-tool`),
  but the tests carrying it are part of the change surface and should be planned, not discovered.
- **Refs:** ADR-003, ADR-004; 09/ADR-006 inv.3; `test/graph-binary-provisioning.test.mjs`,
  `test/arch/acd-graph-binary-absent.test.mjs`; STATE §Feedback "Cross-milestone supersession blast radius".

## R2 — A guard/edge test that asserts an identity holding under its own failure proves nothing

- **Kind:** mistake · **Area:** contract (test design) · **Stage:** build (caught at review) · **Owner:** developer / QA · **Raised by:** architect + QA (review gate)
- **What happened.** Two tests were tautological. (1) The uninstall store-scoping fitness (ADR-005 inv.5)
  asserted `removed === toolVersionDir(name,version)` — but that equality **holds even for an escaping
  `--version ../../x`**, because both sides are built from the same un-guarded `path.join`. A real
  path-traversal out of the store root (into `rmSync`) sailed past it — a **BLOCKER**. (2) The QA version-probe
  "degrade to null" rows asserted a `()=>null` stub, so they passed without ever exercising the real
  `defaultProbe` branch they claimed to cover.
- **Why.** Both tests asserted a value that is true under the very failure mode they exist to catch — an
  identity over the computed target, and a stub that cannot fail — instead of asserting the **refusal /
  real-branch behaviour**.
- **Lesson.** A containment/edge test must assert the **negative it guards**: traversal is **REFUSED**
  (added `assertSafeToolSegment` at the boundary + a containment assertion at the removal site, with a
  RED-proving traversal case), and a degrade row must drive the **real branch** via a row-specific fake, not
  an inert stub. If the assertion still passes when you inject the bug, the test is decorative.
- **Refs:** ADR-005 inv.5; `test/arch/acd-uninstall-store-scoped.test.mjs` (traversal-refusal case),
  `test/tool-doctor-checks.test.mjs` (degrade rows); STATE §Feedback "Review findings" (1) + (4).

## R3 — A command that shells an external tool must gate success on the exit code and refuse lanes it can't execute

- **Kind:** mistake · **Area:** code · **Stage:** build (caught at review) · **Owner:** developer · **Raised by:** architect (review gate)
- **What happened.** Two live-path MAJORs in `project:provision`. (1) The live install reported
  `status:"installed"` even when the `uv` spawn **failed** — it never checked the exit status. (2) The `npx`
  lane silently **no-op'd** on the live path (it returns a plan but the command only executes uv), reporting
  success while running nothing.
- **Why.** The happy-path return shape (`status:"installed"`) was emitted unconditionally after the plan, with
  no branch on the spawn result and no guard for a provider the command cannot itself execute.
- **Lesson.** When a command drives an external process: (a) gate the reported status on `result.status === 0`
  / `result.error`, throwing a **structured** failure (`provision-failed`) on a bad exit — never assume
  success; (b) a provider/lane the command does not execute must **refuse loudly** (`provider-not-executable`),
  not fall through to a success return. Silence reads as success.
- **Refs:** `src/commands/project-provision.mjs` (`provision-failed`, `provider-not-executable`);
  STATE §Feedback "Review findings" (2) + (3).

## R4 — A descriptor two sibling stories' contracts consume belongs in the spine, not a consuming story

- **Kind:** near-miss · **Area:** architecture (story boundaries) · **Stage:** build (decision flagged for retro) · **Owner:** developer · **Raised by:** developer (build)
- **What happened.** The graphify + headroom tool descriptors were placed in the frozen spine
  `src/tool-store.mjs` (alongside `PACKAGE_BINARIES`), **not** inside each retrofit story's module — because
  story 01's `@executable` contract (`project:provision graphify`) and story 03's (`tool-platform` over
  headroom's matrix) both **consume** the descriptors. Co-locating them with a single retrofit story would
  have created a circular cross-story dependency.
- **Why.** Shared, contract-bearing data read by more than one independent story is spine state, not
  story-local state — placing it in one consumer couples the others to that consumer's internals.
- **Lesson.** At refine/break-down, when sibling stories' contracts both read a shared descriptor/map, site it
  in the spine story (00) that the others already depend on. The retrofit stories still own their resolver
  **re-point** (the behaviour); the spine owns the **data** they share. No observable-contract change.
- **Refs:** ADR-001 (`PACKAGE_BINARIES` / spine); `src/tool-store.mjs`; STATE §Progress "Build decision
  (flagged for retro)".
