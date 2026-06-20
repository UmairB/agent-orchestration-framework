---
doc: state
---
# 00 · Work CLI — State

Milestone **done** (accepted 2026-06-17). All three stories built, green, and traced; the
`@executable` suite (226 tests) and the ADR-001 fitness function are green; `aof:validate 00` →
PASS, no findings. Evidence and the accept decision are in [VERIFICATION.md](VERIFICATION.md).

## Progress

- [x] `00_story_resolve-items` — done (`aof work find`; tasks 00/01 traced)
- [x] `01_story_validate-stream` — done (`aof work validate`; tasks 00/01/02 traced)
- [x] `02_story_order-work` — done (`aof work next`; tasks 00/01 traced)

## Durable decisions

Graduated to [ARCHITECTURE.md](ARCHITECTURE.md): ADR-001 (the folder name is the index — discovery
is content-free) with its `work-content-free-discovery` fitness function, and ADR-002 (folder ↔
frontmatter identity is controlled redundancy, enforced by the validator). The engine
(`src/work.mjs`) and its traceability suites (`test/work-{resolve,validate,next}.test.mjs`) codify the
proven behaviour; this milestone's build was traceability wiring over an already-green engine, with no
engine changes, no blockers, and no contract problems.

<!-- Blow-by-blow build narrative and the `## Feedback (for retro)` notes archived on accept
     (2026-06-17). Retrospective: clean run — no carryable lessons, no RETROSPECTIVE.md. -->
