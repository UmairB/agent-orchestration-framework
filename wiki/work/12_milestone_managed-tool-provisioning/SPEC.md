---
type: milestone
number: 12
slug: managed-tool-provisioning
title: "Managed Tool Provisioning — aof owns its external tool dependencies in the ~/.aof home"
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
depends: [08]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 12 · Managed Tool Provisioning — aof owns its external tool dependencies in the ~/.aof home

## Objective

aof has begun accreting **external tool dependencies with heavy, non-npm stacks** — graphify (Python,
milestone 09) and headroom (Python / Rust / ONNX, milestone 06) — and each milestone independently chose
the same deferral: *aof never installs the tool; it only PATH-checks it and prints an install hint*
(09 ADR-004 "assets-only + doctor check"; 06 ADR-004/005 "aof never installs it"). Sensible per-tool, but
across two-plus tools it leaves the operator assembling aof's dependency stack by hand, **globally and
unversioned** — aof has no control over which version of which tool a project actually runs, and the same
"PATH-check + hint" logic is re-implemented per tool.

This milestone gives aof a **managed tool store it owns**: a single, version-pinned home under the aof
**global** directory — `~/.aof/tools/<name>/<version>/` (the existing `defaultGlobalWorkspaceDir`,
`src/paths.mjs:18` — `AOF_GLOBAL_HOME`-overridable, default `<homedir>/.aof`) — into which aof provisions
its external tools through a **pluggable provisioner** that generalizes today's npx-only installer
(`src/frameworks.mjs` hardcodes `npx <pkg>`) into a small provider registry (a `uv` lane for Python tools,
the existing `npx` lane for node frameworks, extensible for the next). Tool **drivers resolve the
tool-home FIRST, then fall back to global PATH** — so an aof-managed install wins, but an operator's own
global binary still works (nothing already shipped breaks). `aof project provision` installs/pins/upgrades;
`aof project doctor` reports presence + version from the store (and checks the provisioner prerequisite,
e.g. `uv`). Because the store is version-keyed, it is **shared across all the operator's projects**
(install once) **and** a project can pin which version it consumes — the user-home cache + per-project
reproducibility, with no repo pollution (it lives outside any repo, so no `.gitignore` cost).

An outsider can verify the objective is met when: `aof project provision` installs a named tool into
`~/.aof/tools/<name>/<version>/` via the right provider (graphify via `uv`), `aof project doctor` reports
it present-and-versioned **from the store** (not just PATH), a tool driver resolves the store binary ahead
of a global one, and the provider seam is generalized so adding the next Python tool is a registry entry,
not a new bespoke installer. This **supersedes** the "aof never installs" stance of 06-ADR-004/005 and
09-ADR-004 — both of which explicitly recorded that decision as **reversible** and named this managed
lifecycle as their graduation path.

## Scope

In scope:
- **The managed tool store under `~/.aof`** — `~/.aof/tools/<name>/<version>/` rooted at the existing
  `defaultGlobalWorkspaceDir` (`AOF_GLOBAL_HOME`-overridable); version-keyed so projects share one home
  yet can pin a version; the layout + the "store-first, PATH-fallback" resolution contract.
- **The pluggable provisioner (generalize `src/frameworks.mjs` beyond npx)** — a provider registry
  (`npx` for node, `uv` for Python; extensible) so a tool declares *how* it provisions; the npx lane
  stays behaviourally intact (its lock/attempt machinery preserved), `uv` is a peer lane, not a rewrite.
- **The lifecycle surface** — `aof project provision <tool>` (install/pin/upgrade into the store) and the
  `aof project doctor` checks (present-and-versioned from the store; the provisioner prerequisite present,
  e.g. `uv`/Python for graphify) — authored as command-core commands (milestone-08 contract) with `--json`.
- **Retrofit graphify (09) and headroom (06) onto the store** — point `resolveGraphifyBinary` and
  headroom's PATH lookup at the tool-home first (PATH fallback retained); migrate graphify off the
  temporary global `uv tool install graphifyy` into `~/.aof/tools/graphify/` and **remove that global
  install** once migrated (see STATE — the carry-over cleanup obligation from 09's verify).

Out of scope:
- **Vendoring or forking the tools themselves** — aof provisions the *published* tools into its store; it
  does not own their source (unchanged from 06/09).
- **Replacing the npx lane / rewriting `frameworks.mjs` wholesale** — npx stays; this *adds* provider
  lanes behind one seam. The existing GSD/npx install behaviour and lock semantics are preserved.
- **A per-repo `<repo>/.aof/tools/` store** — the store is the user-home `~/.aof` (shared + version-keyed),
  not repo-local; per-project control is expressed by *pinning a version*, not a private copy.
- **Changing any tool's own privacy model or runtime config** — graphify's local-AST / backend boundary
  and headroom's transport role are provisioned and respected, never modified.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 12.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-21` (`aof:refine 12 --autonomous`) into **five** stories — **00 is the spine; 01 / 02
/ 03 / 04 fan out from its frozen contract in parallel** (critical path is 00 only). See
[ARCHITECTURE.md](ARCHITECTURE.md) (5 ADRs) and [RESEARCH.md](RESEARCH.md). Load-bearing decisions resolved:
the store layout `~/.aof/tools/<name>/<version>/` + store-first/PATH-fallback resolution (ADR-001); the
provider registry generalizing `frameworks.mjs` with a **`uv venv`** lane — not `uv tool install`, which
isn't version-keyed (ADR-002); `aof project provision` + the doctor checks (ADR-003); the 06/09 retrofit
incl. the graphify global-install cleanup (ADR-004), superseding both milestones' "never install" stance.
Contracts authored `2026-06-21` (Three Amigos) for 00/01/02/03; 04's contract is ADR-005 (five arch-tests).

- [x] **00 · [tool-store-and-providers](stories/00_story_tool-store-and-providers/STORY.md)** — the store
  geometry + store-first resolver (`src/tool-store.mjs`) + the npx+uv provider registry + frozen tool
  descriptor. The spine (ADR-001/002). 2 tasks. _done_
- [x] **01 · [provision-cli-and-doctor](stories/01_story_provision-cli-and-doctor/STORY.md)** — `aof
  project provision` (registered command) + the three store/prereq/platform doctor checks (ADR-003).
  Consumes 00. 2 tasks. _done_
- [x] **02 · [graphify-retrofit](stories/02_story_graphify-retrofit/STORY.md)** — re-point
  `resolveGraphifyBinary` store-first + provision into the store + **remove the temp global** (ADR-004 +
  the STATE cleanup obligation). Consumes 00. 2 tasks. _done — cleanup obligation closed at verify._
- [x] **03 · [headroom-retrofit](stories/03_story_headroom-retrofit/STORY.md)** — re-point headroom's
  lookup store-first + provision `headroom-ai[all]` via the uv lane + the win32 platform matrix (ADR-004).
  Consumes 00. 2 tasks. _done — live uv install platform-blocked on win32 (no wheel); matrix warning verified._
- [x] **04 · [provisioning-fitness](stories/04_story_provisioning-fitness/STORY.md)** — the five enforcing
  arch-tests (ADR-005). Asserts against 00–03; four RED-until-built, npx-preserved GREEN now.
  5 arch-tests. _done_

## Dependencies

- **08 · cli-command-core** — `aof project provision` / the doctor checks arrive as registered
  command-core commands with `--json` contracts (the milestone-08 "new ops arrive as commands first"
  rule), inheriting the registry + result-shape pattern rather than re-litigating it.
- **06 · headroom-plugin** and **09 · graphify-command-core** *(consumers, retrofit — not blockers)* —
  their ADR-004/005 "never install, PATH-check + hint" decisions are the deferrals this milestone
  graduates; both flagged that stance reversible. They are retrofitted onto the store (driver resolution
  re-pointed); this milestone does not block on them and they do not block it (09 already ships with a
  PATH-fallback resolver this milestone fronts).
