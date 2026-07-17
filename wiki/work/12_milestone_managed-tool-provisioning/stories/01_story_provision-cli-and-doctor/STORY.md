---
type: story
number: 01
slug: provision-cli-and-doctor
title: "The lifecycle surface — aof project provision + the store/prereq/platform doctor checks"
parent: 12
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
# 01 · The lifecycle surface — provision command + doctor checks

## User story

As an operator standing up aof's tool dependencies,
I want `aof project provision <tool>` to install/pin a tool into the managed store, and `aof project doctor` to tell me whether each managed tool is present-and-versioned **from the store**, whether the provider prerequisite (`uv`) is there, and whether my platform is supported,
so that aof's dependency stack is provisioned and diagnosed through one honest surface — not assembled by hand and silently mis-resolved.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 12/01`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [provision-command](tasks/00_provision-command.feature)** — `project:provision` is a registered command-core command; `aof project provision <tool> [--version V] [--force] [--uninstall] [--json]` plans/installs into the store via the registry and returns the `ProvisionResult`; `--uninstall` removes only the version dir. _(@executable green; live install row deferred @manual → verify.)_
- [x] **01 · [doctor-checks](tasks/01_doctor-checks.feature)** — three `doctorConfig` checks: `managed-tool` (store-first; present-store→ok, present-PATH→ok "not managed", absent→warning) superseding `graphify-binary`; `provider-prereq` (`uv` present→ok / absent→warning); `tool-platform` (unsupported→warning, never error/throw).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** the lifecycle surface;
**ADR-002/001** the registry + resolver it drives). This story **owns**: a new
`src/commands/project-provision.mjs` (the `project:provision` command, added to `COMMANDS` in
[command-core.mjs](../../../../../src/command-core.mjs)), the `aof project provision` dispatch in
`projectCommand` ([cli.mjs](../../../../../src/cli.mjs)), and the three new checks in `doctorConfig`
([config-inspect.mjs](../../../../../src/config-inspect.mjs)) — **superseding the 09 `graphify-binary`
check in place** with the store-aware `managed-tool` check. It does **not** build the store/registry
(story 00 — it consumes them) or re-point any tool driver (02/03). The `aof project doctor` CLI face is
unchanged — it already renders `checks[]` + `--json`.

**Independent because** it consumes only story 00's frozen registry + resolver and the existing
`doctorConfig`/`projectCommand` seams — and produces a CLI command + doctor checks no sibling's internals
depend on. The command structure (dispatch, dry-run plan, `--json` result) and the degrade-clearly checks
(lanes/resolver stubbed) are `@executable`; a real `uv venv`+install of a tool is `@manual` (live binary).

**Feasibility (developer amigo seat — confirmed at Contract):** Feasible. `project:provision` is a
straight command-core registration: a new `src/commands/project-provision.mjs` carrying the frozen
`{ id, input, run, cli:{argv,render,json} }` shape (mirror `src/commands/graph-build.mjs`), added to
`COMMANDS` in `src/command-core.mjs:49`. The CLI dispatch is a one-branch addition to `projectCommand`
(`src/cli.mjs:170-194`) routing through `invoke("project:provision", …)` — the exact `graphVerbCommand`
idiom (`src/cli.mjs:312` does `getCommand → loadWorkspace → invoke → cli.json/render`, with the `--json`
single-envelope path already solved there), so the 08 bijection is inherited for free. `run` drives story
00's registry (`planProvision` for the plan, install into `toolVersionDir`; `--uninstall` → the store-scoped
removal). All `@executable` rows (registration shape, the `--json` ProvisionResult plan envelope under
dry-run, the uninstall-target assertion) are CI-runnable with the lanes stubbed; the live `uv venv`+install
is correctly `@manual`.

The three doctor checks join `doctorConfig.checks[]` cleanly. The check shape is
`{ id, severity, message, details? }` (`config-inspect.mjs:234-294`; severity ∈ `ok|warning|error|info`),
each pushed onto the local `checks` array; the CLI face (`doctorCommand`, `src/cli.mjs:1476-1507`) renders
`report.checks` and filters by severity for `--json` — so adding `provider-prereq` + `tool-platform` and
**superseding `graphify-binary` in place** rides the unchanged face. Supersession is a single-line swap:
`config-inspect.mjs:296` is `checks.push(graphifyBinaryCheck(options))` — replace it with the store-aware
`managed-tool` check (which fronts `resolveManagedBinary` instead of the PATH-only `resolveGraphifyBinary`
imported at line 31). The existing `graphifyBinaryCheck` already proves the never-throws/degrade-to-warning
contract the three new checks need, with an injectable resolver seam (`options.resolveGraphifyBinary`,
line 322) the doctor-checks feature reuses for hermetic state coverage. No contract change.
