---
type: story
number: 02
slug: notion-cli-provisioning-doctor
title: "The managed Notion CLI + opt-in config + doctor — the NOTION_DESCRIPTOR, the work.integrations.notion schema block, env-var auth, and the project-doctor surface"
parent: 17
status: in-review
owner: product-owner
created: 2026-06-25
updated: 2026-06-26
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 02 · The managed Notion CLI + the opt-in config block + the doctor surface

## User story

As the operator who configures the integration once, on one machine,
I want the Notion CLI provisioned as a first-class milestone-12 managed tool (`ntn`, the `npx`-lane
`NOTION_DESCRIPTOR`), a `work.integrations.notion` config block the schema validates (the `data_source_id`,
the `statusMap`, the relation/status property names, and the `tokenEnv` env-var NAME — never the secret), the
token read from that named env var at run time, and `aof project doctor` reporting the CLI present-and-versioned
+ auth reachable,
so that the integration has a managed, version-pinned binary, a validated opt-in config that never commits a
secret, and a single health surface that tells the operator whether a sync will actually reach Notion — the
provisioning and configuration half of the milestone, separable from the sync logic.

<!-- This is the provisioning/config/doctor surface (ADR-004). It owns the NOTION_DESCRIPTOR, the schema
     block + validator, the env-var auth read, and the doctor check. It honours the milestone-12 npx-lane
     decision (the descriptor is provider:"npx" — NOT the version-keyed store). It owns NO sync/projection
     logic (story 01), NO command registration / no-op gate (story 00 owns the config-LOAD + gate), NO
     arch-tests (story 03). The live CLI presence + auth round-trip is @manual (no token on the dev host). -->

## Tasks

<!-- Contract authored at the Three Amigos stage (`aof:refine 17 --autonomous`, 2026-06-25): PO headline
     Scenarios + aof-qa Examples tables/tagging + aof-developer feasibility. Each task is one `.feature`
     under tasks/; the box is ticked when its `@executable` feature is green (at `aof:continue`) — the live
     `ntn` install + auth-reachability rows are `@manual` (real binary + token). The structural
     "no committed secret" invariant lives in ARCHITECTURE.md fitness functions (story 03), NOT here. -->

- [x] [`tasks/00_config-block-validates.feature`](tasks/00_config-block-validates.feature) — the compiled
  `aof.schema.json` accepts a well-formed `work.integrations.notion` block (`dataSourceId`, `tokenEnv`,
  `statusProperty`, four-status `statusMap`, `relationProperty`) and rejects a malformed one naming the
  offending field; the block has NO field that holds a token (a `token`-value field is rejected as an unknown
  property). Tags `@cli @adapter @validate`, `@executable`. (4 scenarios) — ADR-004
  <!-- Re-bound at refine from `validateConfig` to the Ajv-2020 schema-compile seam (milestone-06 idiom):
       validateConfig does no `work.*` subtree validation today — see STATE Feedback. -->
- [x] [`tasks/01_descriptor-registered.feature`](tasks/01_descriptor-registered.feature) — `NOTION_DESCRIPTOR`
  (`provider:"npx"`, `packageSpec:"ntn"`, `version:"0.17.0"`, `binaries:["ntn"]`, win32 x64-only/Node-22+
  platform note) is in `TOOL_DESCRIPTORS`; the m12 registry + `descriptorFor("notion")` resolve it;
  provisioning plans the npx lane, NOT the version-keyed store. Tags `@cli @adapter @scaffold`, `@executable`.
  (5 scenarios) — ADR-004
- [x] [`tasks/02_auth-env-reference.feature`](tasks/02_auth-env-reference.feature) — the spawn env carries
  the token from `process.env[<tokenEnv>]` plus `NOTION_KEYRING=0`; no token literal in the argv; an absent
  token is an honest fail. Tags `@cli @adapter @scaffold`; mixed lane — 4 `@executable` (stubbed spawn) + 1
  `@manual` (live `ntn api` auth). (5 scenarios) — ADR-004
- [x] [`tasks/03_doctor-surfaces-notion.feature`](tasks/03_doctor-surfaces-notion.feature) — `aof project
  doctor` reports the Notion CLI via the existing m12 `managed-tool`/`tool-platform` checks plus an
  auth-reachability advisory; absent/unsupported/unreachable → `warning` with guidance, never a hard error.
  Tags `@cli @adapter @scaffold`; mixed lane — 4 `@executable` (injected resolver/platform/reachability) + 1
  `@manual` (live install + token). (5 scenarios) — ADR-004
  <!-- tool-platform outline re-scoped at refine: the frozen single-`win32` descriptor + arch-blind
       toolPlatformCheckFor make win32 ok-with-x64-note (no arm64 warning) — see STATE Feedback. -->

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): **ADR-004** (opt-in via `work.integrations.notion`;
auth is an env-var REFERENCE — `tokenEnv`, never a committed secret, `RESEARCH §A2`; the **m12 npx-lane tension
resolved as option (ii)** — the Notion CLI is a first-class managed tool via a `provider:"npx"`
`NOTION_DESCRIPTOR`, provisioned as a node framework, NOT the version-keyed store, so no m12 frozen contract is
edited; surfaced by `aof project doctor`'s existing `managed-tool`/`tool-platform` checks + a sibling
auth-reachability advisory). The `data_source_id` (`§A7`), `statusMap` (`§A4`), and relation property (`§A3`)
shapes come from RESEARCH.

This story **owns**: the `NOTION_DESCRIPTOR` in [tool-store.mjs](../../../../../src/tool-store.mjs)'s
`TOOL_DESCRIPTORS`; the `work.integrations.notion` block in
[aof.schema.json](../../../../../schemas/aof.schema.json) (`$defs.work`) + its `validateConfig` acceptance in
[config-inspect.mjs](../../../../../src/config-inspect.mjs); the env-var-reference auth read + `NOTION_KEYRING=0`
pass-through; the auth-reachability advisory check on `doctorConfig.checks[]`. It **reuses** the m12 registry,
the `managed-tool`/`provider-prereq`/`tool-platform` checks, and the npx provisioning lane unchanged.

**Independent because** the descriptor + schema block + doctor check are config/provisioning surfaces that do
not touch the sync logic — they ride the EXISTING milestone-12 registry + doctor checks (`12/ADR-002/003`) and
the config validator. It parallelizes with story 01 (which stubs the CLI binary behind an injectable seam) and
consumes only story 00's config-block shape. **Off the critical path** — only the `@manual` live binary
round-trip ultimately needs it; the structure (descriptor registration, schema acceptance, doctor wiring) is
`@executable` with the live install/token stubbed.
