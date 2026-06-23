---
doc: verification
updated: 2026-06-22
---
<!--
  Milestone VERIFICATION.md — answers ONE question: is it truly done, and what is the evidence?
  Written at aof:verify. Only sections with content appear (absence is information — no empty "None").
  This milestone has NO @uat scenarios → no ## User sign-off section (no human was pestered).
  This milestone has NO UI surface → no design-conformance section (CLI/tooling only).
-->
# 12 · Managed Tool Provisioning — Verification

## Verification evidence

### Automated + fitness (always; no human)

- **`@executable` suite green** — `node scripts/test.mjs` → **989 ok / 0 not-ok** (exit 0), re-run at
  verify 2026-06-22. _verifies →_ every `@executable` scenario across stories 00/01/02/03 task features.
- **Fitness functions green (the load-bearing deliverable, ADR-005 / story 04)** — all five arch-tests
  enforce in the suite:
  - `acd-tool-store-resolution-order` (inv.1) — store-first, PATH-fallback, structured no-throw miss, over
    `resolveManagedBinary` + the re-pointed `resolveGraphifyBinary` (09) + `resolveHeadroomBinary` (06),
    asserted on BOTH win32 + POSIX shapes.
  - `acd-tool-store-global-home` (inv.2) — root relocates under `AOF_GLOBAL_HOME`; no `os.homedir(` / `.aof`
    literal in `tool-store.mjs` / `project-provision.mjs`.
  - `acd-provider-neutral-registry` (inv.3) — uv lane never shells `npx`, npx lane never shells `uv`,
    dispatch keys on `descriptor.provider`, unknown/absent provider rejects.
  - `acd-npx-lane-preserved` (inv.4) — `frameworks.mjs` planner/executor/lock + npx argv shape intact
    (GREEN-now regression guard).
  - `acd-uninstall-store-scoped` (inv.5) — removal targets exactly `toolVersionDir`; **traversal/separator/
    absolute version REFUSED** (the review-gate BLOCKER fix, proven RED-then-fixed).

### `@manual` lanes (agent-run, live `uv` 0.9.26 — no human)

Pre-state confirmed: `uv` 0.9.26 present; the temporary global `graphifyy v0.8.44` on PATH at
`c:\Users\Umair\.local\bin\graphify.exe` (from 09's verify); no `~/.aof/tools` store yet.

- **graphify installs into the managed store** _(02/01, 01/00 — @manual)_. Procedure: `aof project provision
  graphify` → uv created the venv at `C:\Users\Umair\.aof\tools\graphify\0.8.44`, installed `graphifyy==0.8.44`
  (+ 29 tree-sitter deps); `…\Scripts\graphify.exe --version` → `graphify 0.8.44`. Result: PASS.
  _verifies →_ 02/01 "provision graphify installs graphify into the store" + 01/00 @manual "installs a real
  tool into the store".
- **graphify resolves the store copy once provisioned** _(02/01 — @manual)_. Procedure: `resolveGraphifyBinary()`
  → `{found:true, source:"store", path:"…\.aof\tools\graphify\0.8.44\Scripts\graphify.exe", version:"0.8.44"}`
  (was `source:"path"` at the global before). Result: PASS — the managed install wins over the global.
  _verifies →_ 02/01 "graphify resolves the store copy once provisioned".
- **⚠ CLEANUP OBLIGATION CLOSED — temp global removed after migration, graphify still resolves** _(02/01 —
  @manual; sequencing load-bearing)_. Sequencing honoured: removal done **only after** the store copy
  resolved. Procedure: `uv tool uninstall graphifyy` → "Uninstalled 2 executables: graphify, graphify-mcp";
  `uv tool list` → "No tools installed"; `graphify` no longer on PATH; the global file
  `c:\Users\Umair\.local\bin\graphify.exe` is gone; `resolveGraphifyBinary()` still → `source:"store"`.
  Result: PASS — graphify now runs exclusively from `~/.aof/tools/graphify/`, the 09 carry-over obligation
  is discharged. _verifies →_ 02/01 "the temporary global graphify is removed after migration and graphify
  still resolves" + STATE ⚠ CLEANUP OBLIGATION (precondition of accepting story 02).
- **doctor reports the store + the platform matrix, live** _(01/01 surfaced live; 03/01 win32 matrix)_.
  Procedure: `aof project doctor --json` (`healthy:true`, 0 errors, 2 warnings). `managed-tool` graphify →
  `ok` "present from the store (version 0.8.44)", `source:"store"`. `managed-tool` headroom → `warning`
  (absent → provision hint, advisory not error). `provider-prereq` → `ok` "uv is available".
  `tool-platform` graphify win32 → `ok`; **`tool-platform` headroom win32 → `warning` "headroom on win32:
  needs rust."** Result: PASS — the store-aware doctor surface and the headroom platform matrix are honest
  on this host. _verifies →_ 03/01 "the tool-platform check reflects headroom's platform matrix (win32)".

### `@manual` lane platform-blocked on this host (not a defect)

- **headroom live install** _(03/01 — @manual)_ is gated "Given uv is installed **on a platform with a
  headroom wheel**". This is a **win32** host with **no headroom wheel** (the live `tool-platform` warning
  above confirms it needs Rust). The live `headroom-ai[all]` install is therefore **not exercised on this
  host by design** — the platform matrix advisory IS the host-appropriate evidence. To be run on a
  linux/darwin host with a prebuilt wheel (or a win32 host with a Rust toolchain). This is the matrix
  functioning as designed, **not** a finding.

## Findings

No blocker and no design-gap findings. The non-blocker craft follow-ups surfaced at the build/review gate
and deliberately punted to verify-time remain open and **deferred to backlog** (none gate acceptance):

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| V12-1 | re-provision is non-idempotent; the contract's `status:"present"` is unreachable (a dir-exists short-circuit on the live path would make it honest) | tech-debt | non-blocker | defer to backlog | open |
| V12-2 | `--force` is advertised in CLI help but is a no-op on the uv lane (only matters once a present-short-circuit exists, paired with V12-1) | tech-debt | non-blocker | defer to backlog | open |
| V12-3 | the `where`/`which` PATH-walk is duplicated between `tool-store.mjs` (`findBinaryOnPath`) and `config-inspect.mjs` (`defaultUvWhich`) — a DRY consolidation win, low risk | tech-debt | non-blocker | defer to backlog | open |
| V12-4 | ADR-003 mentioned a provision-route bijection arch-test ADR-005 never named; the route is covered behaviourally by the spawn test — a structural guard is optional table-completeness | tech-debt | non-blocker | defer to backlog | open |

## Accept decision

**ACCEPTED — 2026-06-22.** The `@executable` suite (989/0) and all five ADR-005 fitness functions are
green; every agent-runnable `@manual` lane on this host passed (graphify store install + store-first
resolution + the ⚠ CLEANUP OBLIGATION closed + the live doctor store/platform surface); the only
unexercised `@manual` lane (headroom live install) is platform-blocked by design, not a defect; no `@uat`
scenarios exist (no human gate); `aof work validate` is clean and the `aof:validate 12` gate PASSES; no
blocker or design-gap finding is open. All five stories accepted → the milestone is accepted.
