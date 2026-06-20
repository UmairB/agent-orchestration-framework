---
doc: design
---
<!--
  Milestone DESIGN.md — answers ONE question: how should it look and feel, and why?
  Owner: designer. Conditional (only if there is UI). Shared by the milestone's stories.
  Does NOT contain: UI BEHAVIOUR (→ task .feature). "The form offers Telnyx" is a behavioural
  outcome (a scenario); "the picker is a radio group laid out thus" is design.
  Prefer a visual artifact (mockup / Figma link) to prose — markdown is poor at visual design.
-->
# NN · <Milestone Title> — Design

## Intent

<!-- What experience are we creating? Who is the user, and what are they trying to do? -->

## Screens / surfaces

### <surface name>

- **Mockup:** <Figma / image / design-bundle link>  *(the visual source of truth)*
- **Route:** <the path this surface renders at, e.g. `/properties` — appended to the design-review base
  URL (`work.ui.baseUrl` / `aof:verify --url`) so the conformance review can render it>
- **Layout & interaction:** <intent — not pixel specs>
- **Component choices:** <what, and WHY (the rationale is the part worth writing down)>
- **Binding checklist (when a mock exists):** the checkable facts the mock fixes — the regions in
  order, the components each holds, the states (empty / loading / error / populated), and which design
  ramp each uses. The developer builds to this; the design-conformance review (`aof:continue` /
  `aof:verify`) verifies the built surface against it.

## Behavioural outcomes (cross-reference)

<!-- The user-visible BEHAVIOUR is specified as task scenarios, not here. Link to them. -->

- <behaviour> — see the story's `tasks/<slug>.feature`
