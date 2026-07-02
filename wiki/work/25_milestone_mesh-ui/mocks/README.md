# Mocks — milestone 25 (Mesh UI)

The read-only designer's **conformance source of truth** for the `aof mesh ui` fleet surface lives here as a
locally-readable artifact (never a remote design-tool link).

- **`Mesh.dc.html`** *(landed 2026-07-02)* — the fleet mission-control web view (the m21
  `work-board-runs.dc.html` family convention). Authored from `DESIGN.md` Appendix A / the binding checklist
  (surface 1). The populated state's render is `mesh-ui.png` beside it. `02_story_fleet-ui` is built to
  conform to this file (see the milestone STATE / VERIFICATION).
- **`mesh-ui.png`** — the committed render of the populated state (top bar + Nodes region + Boards region),
  the visual truth the design-conformance review judges the build against.
- **`mesh-ui.prompt.md`** — the generation brief the mock was produced from (kept for provenance / regen).

Surfaces that need no mock: `aof mesh status` (a `@cli` text render) and `aof work ui` (visually unchanged
from milestone 03's board — a rename only).
