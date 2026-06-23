---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 12 · Managed Tool Provisioning — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the managed `~/.aof/tools/<name>/<version>/`
> store, the pluggable provisioner generalizing `frameworks.mjs` beyond npx, the `aof project provision` /
> `aof project doctor` lifecycle surface, the 06/09 retrofit) and `STATE.md` (`§Carry-forward to refine`:
> the store layout + resolution contract, the `frameworks.mjs` generalization without regressing npx, the
> `~/.aof` vs `defaultDataDir` choice — user picked `~/.aof`; and the **⚠ CLEANUP OBLIGATION** carried from
> `aof:verify 09`). ADRs cite these as `SPEC §…` / `STATE §…`, and cite the researcher's `RESEARCH.md` as
> `RESEARCH §…` / `§A1…A5`.
> The seams this milestone EXTENDS / generalizes (all read at authoring): `src/paths.mjs`
> (`defaultGlobalWorkspaceDir` = `~/.aof`, `AOF_GLOBAL_HOME`-overridable, line 18 — the store root; and
> `defaultDataDir`, the alternative NOT used); `src/frameworks.mjs` (the npx-only installer —
> `planFrameworkInstall` hardcodes `["npx", pkg, runtimeFlag, scopeFlag]` line 66, the lock/attempt
> machinery `executeFrameworkInstallPlan`/`frameworkPlanFromLock` PRESERVED); `src/graphify.mjs`
> `resolveGraphifyBinary` (PATH-only today, re-pointed store-first); `src/headroom.mjs` +
> `src/work-headroom.mjs` (headroom's PATH lookup + "never install, hint", re-pointed store-first); the
> doctor seam `doctorConfig` (`src/config-inspect.mjs:230`, `checks[]`) surfaced by `aof project doctor`
> (`cli.mjs:1476`); and milestone-08's command core (`src/command-core.mjs` `{ id, input, run, cli }`
> registry, `08/ADR-002`; the bijection + `test/arch/*` fitness idiom, `08/ADR-004`).
> This milestone does NOT re-litigate the boundary model (08/ADR-001) or the registry shape (08/ADR-002);
> the lifecycle command registers a NEW command into the SAME core, and the doctor checks extend the SAME
> `doctorConfig` `checks[]` the `graphify-binary` check (09/ADR-004) already lives in.
>
> **Prior-lesson recall.** `aof work memory recall "tool provisioning installer store path resolution uv
> npx" --area architecture --block` returned an EMPTY block — no near-miss to honour or depart from.
> Decisions below stand on RESEARCH + the 08/09/06 contracts alone.

## ADR-001: The managed tool store is `~/.aof/tools/<name>/<version>/` rooted at `defaultGlobalWorkspaceDir`; tools resolve STORE-FIRST then PATH-fallback, off a frozen platform-aware resolver keyed by a package→binary map

**Status:** Accepted
**Date:** 2026-06-21

**Context.** This is the spine of the milestone — the *one* place a managed tool's on-disk home and its
resolution rule are defined, that every tool driver (graphify, headroom, the next) couples through.
`SPEC §Scope` fixes the layout: `~/.aof/tools/<name>/<version>/` rooted at the **existing**
`defaultGlobalWorkspaceDir` (`src/paths.mjs:18` — `AOF_GLOBAL_HOME`-overridable, default
`<homedir>/.aof`), version-keyed so all the operator's projects share one home yet a project can pin a
version. `STATE §Carry-forward (3)` records the user's explicit choice of `~/.aof` over the platform
`defaultDataDir` (AppData / Library / `.local/share`), and `AOF_GLOBAL_HOME` as the override — so the
store root MUST derive from `defaultGlobalWorkspaceDir`, never from a hardcoded `os.homedir()` or a
`~/.aof` literal (the relocation guard, ADR-005 inv. b). `RESEARCH §"Cross-platform binary resolution"`
is decisive on three load-bearing facts the resolver must own in ONE place: (1) for a uv-lane tool the
exe lands at `<store>/<name>/<version>/Scripts/<binary>.exe` on Windows and
`<store>/<name>/<version>/bin/<binary>` on POSIX (uv follows the standard venv layout); (2) one package
ships MORE than one binary (graphify's `graphifyy` package ships `graphify` AND `graphify-mcp`; the
install spec name ≠ the binary name) — so resolution needs a **package→binary map**, not a name guess;
(3) version verification is a `<bin> --version` probe that must degrade to `version: null` rather than
throw (`RESEARCH §A4` — the flag is live-only/unconfirmed for headroom). Today's resolvers (graphify's
`resolveGraphifyBinary`, headroom's `defaultWhich`) resolve off **PATH only** — there is no store-first
lookup; that is exactly the gap this milestone closes WITHOUT breaking an operator's own global binary.

**The resolution-order crux (resolved here).** Store-first, PATH-fallback (`SPEC §Objective`: "an
aof-managed install wins, but an operator's own global binary still works — nothing already shipped
breaks"). The resolver checks `<store>/<name>/<version>/{Scripts|bin}/<binary>[.exe]` FIRST; only on a
miss does it fall back to the PATH walk the 06/09 resolvers do today. This ordering is what makes the
retrofit (ADR-004) non-breaking: a project with a managed install gets the pinned store copy; a project
that never provisioned still resolves the global binary exactly as before. The PATH-fallback path is the
06/09 behaviour, preserved — the store check is a prefix, not a replacement.

**Decision.** A new module **`src/tool-store.mjs`** (the house flat-`src/` layout — `paths.mjs`/
`frameworks.mjs`/`graphify.mjs` are flat, so the store is too) owns the store geometry and the
store-first resolver. The store root derives from `defaultGlobalWorkspaceDir(env)` + `tools/`; a tool's
version dir is `<root>/<name>/<version>/`; the platform-specific exe dir + suffix
(`Scripts`+`.exe` on win32, `bin`+`""` on POSIX) and the package→binary map live HERE, not duplicated in
each driver. `paths.mjs` gains the pure path helpers (`toolStoreRoot`, `toolVersionDir`); the resolver
(`resolveManagedBinary`) lives in `tool-store.mjs`. The resolver returns a structured `{ found:false }`
on a total miss (never an opaque ENOENT), carrying the install hint — the same no-throw contract the 09
resolver established (`09/ADR-002`).

**The locked store + resolver contract (frozen 2026-06-21):**

```js
// src/paths.mjs (extended) — PURE path geometry, basis-neutral raw absolutes. NO homedir literal,
// NO "~/.aof" literal: the root derives from defaultGlobalWorkspaceDir (AOF_GLOBAL_HOME-overridable).
//   toolStoreRoot(env = process.env)                  → <defaultGlobalWorkspaceDir(env)>/tools
//   toolVersionDir(name, version, env = process.env)  → <toolStoreRoot(env)>/<name>/<version>

// src/tool-store.mjs — the STORE-FIRST resolver. The single place store geometry + the package→binary
// map + the cross-platform exe path live. graphify (ADR-004) and headroom (ADR-004) front this; their
// PATH-fallback is the 06/09 behaviour, preserved.
//
//   resolveManagedBinary({ name, version, binary, env?, platform?, pathValue?, useLocator?, probe? })
//     → { found:true,  source:"store", binary, path, version }   // store hit: <verDir>/{Scripts|bin}/<binary>[.exe]
//     | { found:true,  source:"path",  binary, path, version }   // store miss → PATH walk (06/09 behaviour)
//     | { found:false, hint }                                    // total miss: structured, never throws
//
//   exeDirFor(versionDir, platform)  → <versionDir>/Scripts (win32) | <versionDir>/bin (POSIX)
//   exeNameFor(binary, platform)     → "<binary>.exe" (win32) | "<binary>" (POSIX)
//   PACKAGE_BINARIES                 → { graphifyy: ["graphify","graphify-mcp"], "headroom-ai": ["headroom"] }
//
//   - STORE-FIRST: check <store>/<name>/<version>/{Scripts|bin}/<binary>[.exe] BEFORE any PATH lookup.
//   - PATH-FALLBACK: on a store miss, the existing locator (`where`/`which`) + PATH scan (06/09), unchanged.
//   - version: probe `<bin> --version`, degrade to null on any failure (RESEARCH §A4) — NEVER throw.
//   - injectable seams (env/platform/pathValue/useLocator/probe) so the resolver is hermetic under test.
```

**Alternatives considered.**
- *Root the store at the platform `defaultDataDir` (AppData / Library / `.local/share`)* — rejected by
  the user's explicit call (`STATE §Carry-forward (3)`): `~/.aof` is the home aof ALREADY owns
  (`defaultGlobalWorkspaceDir`, with `aof.config.json` + `assets/` already on disk), so the tool store
  *extends* a home rather than introducing a second data location. `AOF_GLOBAL_HOME` remains the override
  for both.
- *A per-repo `<repo>/.aof/tools/` store* — rejected (`SPEC §Out of scope`): the store is the user-home
  `~/.aof` (shared across the operator's projects, version-keyed); per-project control is a version PIN,
  not a private copy — and a repo-local binary store would carry a `.gitignore` cost the user-home home
  avoids.
- *PATH-first, store-fallback (or PATH-only, ignore the store)* — rejected: it inverts the whole point —
  an aof-managed pinned install must WIN over a stray global, else provisioning a version is meaningless.
  Store-first/PATH-fallback is the only order that both pins AND keeps the operator's global working.
- *Guess the binary name from the package name* — rejected by `RESEARCH §"Cross-platform"`: the install
  spec (`graphifyy`, `headroom-ai`) ≠ the binary (`graphify`, `headroom`), and one package ships several
  binaries (`graphify` + `graphify-mcp`). A package→binary map is load-bearing, not optional.

**Consequences.** Story 00 builds `src/paths.mjs`'s store helpers + `src/tool-store.mjs`'s resolver +
the package→binary map; the contract above is frozen the moment 00 lands, and stories 01/02/03/04 consume
it without renegotiation. The store-first/PATH-fallback ordering is what makes the 06/09 retrofit
(ADR-004) provably non-breaking. `defaultGlobalWorkspaceDir` stays the single source of the root, so the
relocation guard (ADR-005 inv. b) has one expression to police.

**Invariant.** A managed tool resolves the store binary
(`<store>/<name>/<version>/{Scripts|bin}/<binary>[.exe]`) AHEAD of any PATH binary, and the store root
derives from `defaultGlobalWorkspaceDir` (no `os.homedir()` / `~/.aof` literal in the store/provision
code). Enforced by `acd-tool-store-resolution-order` + `acd-tool-store-global-home` (ADR-005).

## ADR-002: The provisioner is a PROVIDER REGISTRY `{ npx, uv }` (extensible) behind one seam; the npx lane is the re-homed `frameworks.mjs` behaviour (lock/attempt PRESERVED), the uv lane provisions via `uv venv` + `uv pip install --python` (NOT `uv tool install`); a tool declares HOW it provisions via a frozen descriptor

**Status:** Accepted
**Date:** 2026-06-21

**Context.** `SPEC §Scope` requires generalizing today's npx-only installer "beyond npx" into "a provider
registry (`npx` for node, `uv` for Python; extensible) so a tool declares *how* it provisions", with the
npx lane "behaviourally intact (its lock/attempt machinery preserved)" — "a peer lane, not a rewrite".
`RESEARCH §"Existing seam this milestone generalizes"` pins the npx lane precisely: `planFrameworkInstall`
builds `["npx", packageName, runtimeFlag, scopeFlag]` (`frameworks.mjs:66`) and
`executeFrameworkInstallPlan` spawns it with a fixed `SAFE_NPM_EXEC_ENV` (the `npm_config_*` hardening),
and there is **lock/attempt machinery** — skip-if-already-succeeded keyed on
framework/runtime/scope/source, `--force` to rerun, `frameworkPlanFromLock` to replay a lock — that must
survive. `RESEARCH §"Store layout"` is decisive on the uv lane's MECHANISM: `uv tool install` is
**package-keyed, NOT version-keyed** (confirmed live — it lands at `<UV_TOOL_DIR>/<package>/` with no
version segment, so two versions collide and it cannot realize `<name>/<version>/`); the version-keyed
store is reachable ONLY via **`uv venv <verDir>` + `uv pip install --python <verDir> "<spec>[extras]==<version>"`**
(confirmed live end-to-end: binary appeared at `<verDir>/Scripts/graphify.exe`, `--version` →
`graphify 0.8.44`). `RESEARCH §"Headroom"` adds that headroom is the SAME uv lane (PyPI `headroom-ai` →
binary `headroom`, plain console-script) — so NO third provider is needed — but the lane's spec model must
carry an **extras** field (`headroom-ai[all]`) and tolerate a **per-tool platform matrix** (no Windows
wheel for headroom). The two lanes do NOT share an exec env: the npx env is npm-specific
(`SAFE_NPM_EXEC_ENV`) and does NOT transfer to uv; each lane owns its exec env.

**Decision.** Generalize `src/frameworks.mjs`'s install seam into a small **provider registry**
`{ npx, uv }` (a plain object keyed by provider id, extensible by adding a key — the registry is the
extension point, not a class hierarchy). A tool declares HOW it provisions via a frozen **tool
descriptor** (below); `planProvision(descriptor, options)` dispatches on `descriptor.provider` to the
lane's planner and returns a **dry-run/plan** (mirroring `planFrameworkInstall`'s `dryRun` — the plan is
the command list, executed only when not `dryRun`). The two lanes:
- **`npx` lane** — a **re-home** of the existing `frameworks.mjs` behaviour behind the registry, NOT a
  rewrite. `planFrameworkInstall`/`executeFrameworkInstallPlan`/`frameworkPlanFromLock` and
  `SAFE_NPM_EXEC_ENV` stay; the registry's `npx` provider DELEGATES to them. Its lock/attempt/skip/
  `--force` semantics are preserved verbatim (the regression guard, ADR-005 inv. d). The npx lane installs
  a node framework as today (it does NOT target the version-keyed store — node frameworks keep their npx
  scope model; the store is the uv lane's home for the Python tools this milestone provisions).
- **`uv` lane** — a PEER lane that provisions INTO the store: `uv venv <toolVersionDir>` then
  `uv pip install --python <toolVersionDir> "<packageSpec>[<extras>]==<version>"`. It owns its OWN exec
  env (NOT `SAFE_NPM_EXEC_ENV`). `uv` is a doctor-checked prerequisite (ADR-003). The plan is the two
  commands; `dryRun` returns them without spawning.

The registry is the single dispatch point both the lifecycle command (ADR-003) and the retrofit
provisioning (ADR-004) call; no provisioning code shells `npx` or `uv` outside its lane.

**The locked descriptor + provider contract (frozen 2026-06-21):**

```js
// THE TOOL DESCRIPTOR — a tool declares HOW it provisions. Plain serialisable data (08/ADR-002 spirit).
// {
//   name:       string,           // the store key, e.g. "graphify" / "headroom" (the <name> dir).
//   provider:   "npx" | "uv",     // which lane (the registry key; extensible).
//   packageSpec:string,           // the install-spec package, e.g. "graphifyy" / "headroom-ai"
//                                 //   (≠ name, ≠ binary — RESEARCH §"Cross-platform"/"Headroom").
//   version:    string,           // the pinned version; uv lane installs "<packageSpec>[extras]==<version>".
//   binaries:   string[],         // the binaries this package ships, e.g. ["graphify","graphify-mcp"]
//                                 //   / ["headroom"] (the package→binary map; ADR-001).
//   extras?:    string[],         // uv-lane extras, e.g. ["all"] → "headroom-ai[all]" (RESEARCH §"Headroom").
//   platforms?: { [platform]: { supported:boolean, prereqs?:string[], note? } },
//                                 // the per-tool platform matrix, e.g. headroom win32 = { supported:false|
//                                 //   needs-rust, note } (RESEARCH §A3). Absent ⇒ supported everywhere.
// }

// THE PROVIDER REGISTRY — { npx, uv }, keyed by provider id; extensible by adding a key.
//   planProvision(descriptor, options) → ProvisionPlan   // dispatch on descriptor.provider
//     options.dryRun → return the command list, DO NOT spawn (mirrors planFrameworkInstall dryRun).
//
//   npx lane  → DELEGATES to the existing frameworks.mjs planner/executor (lock/attempt PRESERVED,
//               SAFE_NPM_EXEC_ENV unchanged). A re-home behind the registry, not a rewrite.
//   uv  lane  → plan = [ ["uv","venv", toolVersionDir(name,version)],
//                        ["uv","pip","install","--python", toolVersionDir(name,version),
//                                 `${packageSpec}${extras?`[${extras.join(",")}]`:""}==${version}`] ]
//               owns its OWN exec env (NOT SAFE_NPM_EXEC_ENV). `uv` is a prereq (ADR-003).
//
//   uninstall(descriptor) → remove ONLY toolVersionDir(name, version) (ADR-003; ADR-005 inv. e) —
//                           never a global/system path, never `uv tool uninstall` of the store.
```

**Alternatives considered.**
- *Provision the uv lane via `uv tool install <pkg>==<ver>` (the obvious uv command)* — REJECTED by
  `RESEARCH §"Store layout"` (confirmed live): `uv tool install` is package-keyed, lands at
  `<UV_TOOL_DIR>/<package>/` with NO version segment, so it cannot realize `<name>/<version>/` and two
  versions collide. `uv venv` + `uv pip install --python <verDir>` is the ONLY route to the
  deterministic, version-keyed, aof-named path the store needs.
- *Rewrite `frameworks.mjs` into the registry (fold npx INTO a unified planner)* — rejected
  (`SPEC §Out of scope`: "Replacing the npx lane / rewriting `frameworks.mjs` wholesale"): npx stays; the
  registry ADDS lanes behind one seam and the npx lane DELEGATES to the existing planner. A rewrite risks
  the lock/attempt semantics the npx tests (and milestone-01/GSD) depend on — the milestone explicitly
  keeps them intact (ADR-005 inv. d).
- *A pipx lane (pipx is on PATH and can install the same PyPI tools)* — rejected: pipx would not give the
  uv-controlled, version-keyed venv path the store resolves with zero guessing (`RESEARCH §"Version pin"`);
  the milestone names `uv` as the lane. (pipx remains a future registry KEY if ever needed — the registry
  is extensible.)
- *A class hierarchy / plugin interface for providers* — rejected for house consistency: the codebase
  models extension points as plain keyed objects (the `FRAMEWORKS` map, the `ROUTABLE` set); a `{ npx, uv }`
  object keyed by id is the lighter, idiomatic shape and keeps the dispatch a lookup.

**Consequences.** Story 00 builds the provider registry + the uv lane + the frozen descriptor, re-homing
the npx lane behind the registry (delegating to `frameworks.mjs`, which it does NOT rewrite). The contract
is frozen when 00 lands; stories 01/02/03 consume it. Because the npx lane delegates to the untouched
planner, the existing framework-install behaviour and the milestone-01/GSD tests stay a free regression net
(ADR-005 inv. d). The provider-neutrality guard (ADR-005 inv. c) has two expressions to police: the uv lane
never shells `npx`, the npx lane never shells `uv`.

## ADR-003: The lifecycle surface is `aof project provision <tool>` (a NEW command-core command, install/pin into the store; uninstall = remove the version dir) + THREE new `doctorConfig` checks (store presence-and-version, provider prereq, platform support) — extending the SAME doctor seam the 09 `graphify-binary` check lives in

**Status:** Accepted
**Date:** 2026-06-21

**Context.** `SPEC §Scope` requires the lifecycle surface "authored as command-core commands
(milestone-08 contract) with `--json`": `aof project provision <tool>` (install/pin/upgrade into the
store) and the `aof project doctor` checks (present-and-versioned FROM THE STORE; the provisioner
prerequisite present, e.g. `uv`). Two seams already exist and must be respected, not duplicated. (1) The
command core (`src/command-core.mjs`, `08/ADR-002`) is the registry every new operation registers into
(`09/ADR-001` registered `graph:*` there) — so `aof project provision` is a NEW registered command with a
`cli` adapter, inheriting the bijection (`08/ADR-004`) and `--json` for free. (2) The doctor seam is
`doctorConfig` (`config-inspect.mjs:230`), which returns a `checks[]` array surfaced by `aof project
doctor` (`cli.mjs:1476`, already `--json`-capable); the **`graphify-binary` check (09/ADR-004) is already
a member of that array** (`config-inspect.mjs:296`) — so the new doctor checks EXTEND that same
`checks[]`, they do not invent a parallel reporter. `RESEARCH §"Version pin, lockfile, prerequisite"`
fixes `uv` as the hard prereq for the uv lane; `RESEARCH §"Headroom"` fixes the per-tool platform matrix
(headroom-on-Windows → warn).

**The new-vs-extend split (resolved here).** `aof project provision` is **NEW** (a registered
command-core command). The doctor work is **EXTEND**: three new checks join `doctorConfig`'s existing
`checks[]` (alongside `config-valid`, `generated-output-drift`, `graphify-binary`), and the
**`graphify-binary` check (09) is SUPERSEDED in place** by a store-aware managed-tool check (it resolved
PATH-only; it now resolves store-first via ADR-001's resolver). The `aof project doctor` CLI face
(`doctorCommand`) is unchanged — it already renders `checks[]` + `--json`; the new checks ride it.

**Decision.** A NEW command-core command registers into `src/command-core.mjs`'s `COMMANDS`
(`src/commands/project-provision.mjs`, one module, the house one-per-command idiom):
- **`project:provision`** — input `{ tool, version?, force? }`; `run` looks up the tool's descriptor
  (ADR-002), and via the provider registry installs/pins it INTO the store
  (`toolVersionDir(name, version)`); returns basis-neutral data (the resolved store path raw-absolute, the
  provider, the version, whether it was a fresh install or already present). Its `cli` adapter is
  `aof project provision <tool> [--version V] [--force] [--json]`, dispatched in `projectCommand`
  (`cli.mjs:170`) like the other `project` subcommands, but routing through `invoke("project:provision", …)`
  so it is a registry command (the 08 bijection). **Uninstall** is `aof project provision <tool> --uninstall`
  (or a sibling `project:unprovision`): it removes ONLY `toolVersionDir(name, version)` (ADR-002's
  `uninstall`; the store-scoped removal guard, ADR-005 inv. e) — never a global/system path.

Three NEW checks join `doctorConfig`'s `checks[]` (the `graphify-binary` check is superseded in place):
- **`managed-tool` (supersedes `graphify-binary`)** — for each managed tool, resolve store-first via
  `resolveManagedBinary` (ADR-001): present-from-store → `ok` with the resolved version; present-on-PATH
  only → `ok` ("present on PATH, not managed"); absent → `warning` (NOT error — a project may legitimately
  not use the tool) with the provision guidance. Degrades to "present, version unknown" on a null version
  probe (`RESEARCH §A4`), never throws.
- **`provider-prereq`** — the lane prerequisite is present, e.g. `uv` on PATH for any uv-lane tool;
  absent → `warning` with the install guidance for `uv`. (`RESEARCH §"Version pin"`.)
- **`tool-platform`** — the tool's descriptor platform matrix supports the current platform; unsupported
  (e.g. headroom on win32, no wheel) → `warning` naming the prereq (Rust) or "unsupported on this
  platform" (`RESEARCH §A3` / §"Headroom"). NEVER an error — it is an advisory.

**The locked lifecycle contract (frozen 2026-06-21):**

```js
// NEW command-core command (extends 08's COMMANDS; id is project:*). Basis-neutral result (08/ADR-002).
//   project:provision  input { tool, version?, force?, uninstall? }   → ProvisionResult
//     run → descriptor = descriptorFor(tool); planProvision(descriptor{version}, {force}) via the registry
//           (ADR-002); install into toolVersionDir; uninstall:true → remove ONLY that version dir (ADR-002).
//     ProvisionResult { tool, provider, version, storePath, status:"installed"|"present"|"uninstalled", plan }
//       storePath — raw absolute to <store>/<name>/<version>/ (basis-neutral; CLI face relativises).
//   cli: aof project provision <tool> [--version V] [--force] [--uninstall] [--json]
//        (dispatched in projectCommand, cli.mjs:170, routing through invoke("project:provision", …)).

// EXTEND doctorConfig's checks[] (config-inspect.mjs:230) — three NEW checks; graphify-binary SUPERSEDED:
//   managed-tool     — resolveManagedBinary store-first per tool; present-from-store→ok(version);
//                      present-on-PATH→ok("not managed"); absent→warning(provision guidance);
//                      version-unknown→ok("present, version unknown"). NEVER throws (RESEARCH §A4).
//   provider-prereq  — uv on PATH (any uv-lane tool) → ok; absent → warning(install uv).
//   tool-platform    — descriptor.platforms[process.platform].supported → ok; unsupported → warning
//                      (Rust prereq / "unsupported on this platform"; RESEARCH §A3). Advisory, never error.
//   (`aof project doctor`'s CLI face — doctorCommand, cli.mjs:1476 — is UNCHANGED; it renders checks[]+--json.)
```

**Alternatives considered.**
- *Make `aof project provision` a direct CLI dispatch like `project show`/`validate`/`doctor` (NOT a
  registry command)* — rejected by `SPEC §Scope`/`§Dependencies` (the milestone-08 "new ops arrive as
  commands first" rule): a NEW operation registers into the command core so it inherits the bijection +
  `--json` and a future face (board/MCP) gets it for free. The existing `project show/validate/doctor`
  predate the core (they are direct dispatch for historical reasons); the NEW `provision` is a registry
  command. (The doctor CHECKS, by contrast, extend the existing `doctorConfig` seam — they are not new
  commands, so they ride the unchanged `aof project doctor` face.)
- *A standalone provisioning reporter instead of extending `doctorConfig`'s `checks[]`* — rejected: the
  `graphify-binary` check (09) already lives in `doctorConfig.checks[]`; a parallel reporter would
  duplicate `aof project doctor`'s `--json`/render and split tool health across two surfaces. The new
  checks join the SAME array (and supersede `graphify-binary` in place).
- *Absent managed tool / missing `uv` / unsupported platform as a doctor `error`* — rejected (mirrors
  09/ADR-004): a project that does not use a given tool should still be "healthy"; absence/missing-prereq/
  unsupported-platform are `warning`s with guidance, not hard failures. (A `graph:*` or headroom run
  WITHOUT the tool fails clearly at the command level — that is the command's own guard, distinct from the
  project-health check.)
- *`provision` upgrades by mutating the existing version dir in place* — rejected: the store is
  version-keyed; an "upgrade" provisions the NEW `<name>/<new-version>/` dir (the old one stays until
  uninstalled), so a project pinning the old version is unaffected. Upgrade = provision a new version, not
  overwrite.

**Consequences.** Story 01 builds `src/commands/project-provision.mjs` + the three `doctorConfig` checks
(superseding `graphify-binary`) and the `cli.mjs` `project provision` dispatch. The command inherits the
08 bijection (it carries a `cli` adapter, dispatches via the registry) — so the 08
`acd-work-command-cli-bijection` family extends to it (ADR-005 names the provision-specific guard). The
live `uv venv`+install of a real tool is `@manual` (a live binary, heavy); the plan/resolution/check
STRUCTURE (dry-run plan, store-first resolution, degrade-clearly checks) is `@executable` with the lanes
stubbed.

## ADR-004: graphify (09) and headroom (06) are RETROFITTED store-first — `resolveGraphifyBinary` and headroom's lookup front the ADR-001 resolver (PATH-fallback retained); the graphify retrofit provisions into the store AND removes the temporary global install (the STATE cleanup obligation); headroom carries the platform matrix — SUPERSEDING 06-ADR-004/005 and 09-ADR-004's "never install" stance

**Status:** Accepted
**Date:** 2026-06-21

**Context.** `SPEC §Objective` graduates the deferral both consumer milestones independently took:
*aof never installs the tool; it only PATH-checks it and prints a hint* (09/ADR-004 "assets-only +
doctor check"; 06/ADR-004/005 "aof never installs it") — both of which **explicitly recorded that
stance as REVERSIBLE and named this managed lifecycle as their graduation path** (09/ADR-004 "Graduation
path: if a future milestone needs aof to *manage* the graphify install lifecycle … generalize the
installer THEN — the doctor check is the seam"; 06/ADR-005 "aof never installs it"). This milestone is
that graduation, so it SUPERSEDES those ADRs' "never install" stance — citing them, not editing them
(IMMUTABLE house rule). `STATE §⚠ CLEANUP OBLIGATION` (user-instructed 2026-06-21) is load-bearing: during
`aof:verify 09` a **temporary GLOBAL** graphify was installed — `uv tool install graphifyy` (graphify
0.8.44, on PATH at `~/.local/bin/graphify`) — to exercise the live `@manual` lanes; it **MUST be removed**
(`uv tool uninstall graphifyy`) once graphify migrates into `~/.aof/tools/graphify/`, but **NOT before**
(09's live integration currently depends on it). `RESEARCH §"Headroom"` adds headroom's platform reality:
PyPI `headroom-ai` → binary `headroom`, uv lane with `[all]` extras, but **no Windows wheel** (sdist +
Rust on win32) → the platform matrix.

**Decision.** Re-point both resolvers at the store-first resolver (ADR-001), PATH-fallback retained
(non-breaking, ADR-001's crux):
- **graphify (09 retrofit).** `resolveGraphifyBinary` (`src/graphify.mjs`) is re-pointed to call
  `resolveManagedBinary({ name:"graphify", version:PINNED_GRAPHIFY_VERSION, binary:GRAPHIFY_BINARY, … })`
  — store-first, then its existing PATH walk as the fallback. Its frozen no-throw `{found:false,hint}`
  contract (`09/ADR-002`) is preserved; the install hint updates to name `aof project provision graphify`.
  graphify is provisioned into the store via the uv lane (descriptor `{ name:"graphify", provider:"uv",
  packageSpec:"graphifyy", version:"0.8.44", binaries:["graphify","graphify-mcp"] }`). **Then the temporary
  global is REMOVED** (`uv tool uninstall graphifyy`) and `resolveGraphifyBinary` is confirmed to resolve
  the store copy — the `STATE §⚠ CLEANUP OBLIGATION`, a precondition of accepting this story.
- **headroom (06 retrofit).** headroom's `defaultWhich`-based lookup (`src/headroom.mjs`,
  `src/work-headroom.mjs`) is re-pointed store-first (the store-first resolver, then the existing
  `defaultWhich` PATH probe as fallback). headroom is provisioned via the SAME uv lane (descriptor
  `{ name:"headroom", provider:"uv", packageSpec:"headroom-ai", version:<pin>, extras:["all"],
  binaries:["headroom"], platforms:{ win32:{ supported:false, prereqs:["rust"], note:"no Windows wheel —
  sdist build needs Rust" } } }`). The `tool-platform` doctor check (ADR-003) surfaces the
  headroom-on-Windows warning. headroom's enable/disable config surface (`work-headroom.mjs`'s
  `useHeadroom`/`unuseHeadroom`, 06/ADR-004) is UNCHANGED — only the binary LOOKUP is re-pointed; the
  config read-merge-write and its isolation guard stay intact.

Both retrofits change ONLY the resolution lookup (store-first) and ADD provisioning; neither changes a
tool's privacy/runtime model (`SPEC §Out of scope`) — graphify's local-AST/backend boundary (09/ADR-005)
and headroom's transport role (06/ADR-003) are provisioned and respected, never modified.

**Alternatives considered.**
- *Leave 06/09 PATH-only and provision a parallel copy without re-pointing the resolvers* — rejected: the
  whole objective is that a managed install WINS; if the resolvers stay PATH-only, the store copy is never
  resolved. Re-pointing store-first (PATH-fallback) is the graduation.
- *Remove the temporary global graphify BEFORE the store migration lands* — rejected by
  `STATE §⚠ CLEANUP OBLIGATION`: 09's live integration currently depends on the global binary; removal is
  sequenced AFTER the store install + resolver re-point, as a precondition of accepting the graphify
  retrofit story (the loop closes in ONE story, not split).
- *Block headroom provisioning on Windows entirely* — rejected: the platform matrix WARNS (sdist + Rust
  prereq) rather than hard-blocking — an operator with Rust can build the sdist; the doctor advises, it
  does not forbid. (A hard "unsupported" is expressible in the matrix per tool, but headroom's win32 is
  "supported with the Rust prereq", not "impossible".)
- *Rewrite headroom's `defaultWhich` to drop PATH fallback once the store exists* — rejected: an
  operator's own global `headroom` (or `graphify`) must still resolve when unprovisioned — store-first
  with PATH-fallback (ADR-001) keeps nothing-shipped-breaks true.

**Consequences.** Story 02 (graphify-retrofit) re-points `resolveGraphifyBinary` store-first, provisions
graphify into the store, and REMOVES the temporary global (the cleanup obligation closes here). Story 03
(headroom-retrofit) re-points headroom's lookup store-first, provisions `headroom-ai[all]` via the uv
lane, and lands the platform matrix + the win32 warning. Both consume the ADR-001 resolver + the ADR-002
registry frozen by story 00. This SUPERSEDES 06-ADR-004/005 and 09-ADR-004's "never install" stance —
the resolvers now resolve a store aof provisions; the 06/09 doctor/enable surfaces otherwise stay intact.
The live `uv venv`+install of graphify/headroom and the actual global removal are `@manual` (live
binaries); the store-first RE-POINT (resolution order) is `@executable` with the store stubbed.

**Invariant.** `resolveGraphifyBinary` and headroom's lookup resolve the store BEFORE PATH (ADR-001's
order), and uninstall/removal targets only `~/.aof/tools/<name>/<version>/`, never a global/system path.
Enforced by `acd-tool-store-resolution-order` (extended to the 06/09 resolvers) + `acd-uninstall-store-scoped`
(ADR-005).

## ADR-005: The structural guarantees are FIVE fitness functions — store-first resolution, AOF_GLOBAL_HOME-honoured/no-hardcoded-home, provider-neutral registry, npx-lane-preserved, uninstall-store-scoped — each a `test/arch/*` arch-test, RED until built

**Status:** Accepted
**Date:** 2026-06-21

**Context.** This is the load-bearing deliverable, mirroring `08/ADR-004` and `09/ADR-006`: the store +
resolver (ADR-001), the provider registry (ADR-002), the lifecycle surface (ADR-003), and the retrofit
(ADR-004) are durable only if ENFORCED. The guarantees are structural facts over the resolver, the store
root derivation, the provider lanes, the npx installer, and the uninstall path — so they are fitness
functions here, NOT Gherkin scenarios. The OBSERVABLE counterparts — "`aof project provision graphify`
installs a real venv into `~/.aof/tools/graphify/0.8.44/` and `aof project doctor` reports it from the
store", "`headroom --version` runs from the store copy" — are task `.feature` files over the REAL `uv` +
the real tools, authored by stories 01/02/03 and gated `@manual` where they need a live binary
(`RESEARCH §A2/A3/A4`). The house idiom is the 08/09 one: source-grep (call-form-not-comment discipline) +
registry/driver import with injected seams + CLI spawn-and-parse. **RED-until-built is correct now**:
`src/tool-store.mjs`, the provider registry, `src/commands/project-provision.mjs`, and the re-pointed
06/09 resolvers do not exist yet; the tests reference them and fail cleanly until stories 00/01/02/03 land.

**Decision.** Five invariants, five arch-tests under `test/arch/`:

1. **Store-first resolution.** A managed tool resolves the store binary
   (`<store>/<name>/<version>/{Scripts|bin}/<binary>[.exe]`) AHEAD of a PATH binary; on a store miss it
   falls back to PATH (06/09 behaviour). Proven by importing `resolveManagedBinary` (and the re-pointed
   `resolveGraphifyBinary` / headroom lookup) with BOTH a store hit and a PATH hit injected, asserting the
   store path wins; and the structured `{found:false,hint}` on a total miss (no throw).

2. **`AOF_GLOBAL_HOME` honoured / no hardcoded homedir.** The store root derives from
   `defaultGlobalWorkspaceDir` (so `AOF_GLOBAL_HOME` relocates it); no `os.homedir()` and no `~/.aof`
   string literal appears in the store/provision code. Proven by importing `toolStoreRoot` with
   `AOF_GLOBAL_HOME` set and asserting the root relocates; AND source-grepping `tool-store.mjs` /
   `project-provision.mjs` (comments discounted) for `os.homedir(`/`".aof"`/`'.aof'` literals → none.

3. **Provider-neutral registry.** The uv lane never shells `npx`; the npx lane never shells `uv`; no
   provisioning code leaks a provider-only assumption across lanes. Proven by source-grep: the uv lane's
   plan argv[0] is `uv` and contains no `npx`; the npx lane's argv[0] is `npx` (it delegates to the
   untouched `frameworks.mjs`) and contains no `uv`; dispatch is on `descriptor.provider`.

4. **npx lane preserved (regression guard).** `frameworks.mjs`'s existing framework-install behaviour +
   lock/attempt semantics are unchanged — the registry's npx provider DELEGATES to the untouched planner.
   Proven by the existing milestone-01/GSD framework-install tests staying GREEN, plus a source-grep that
   `planFrameworkInstall`/`executeFrameworkInstallPlan`/`frameworkPlanFromLock`/`SAFE_NPM_EXEC_ENV` are
   still exported and the npx argv shape (`["npx", pkg, runtimeFlag, scopeFlag]`) is intact.

5. **Uninstall is store-scoped.** Removal targets ONLY `toolVersionDir(name, version)`
   (`~/.aof/tools/<name>/<version>/`) — never a global/system path, never an `rm -rf` of the store root or
   a PATH dir. Proven by importing the `uninstall`/`project:provision --uninstall` path with injected
   fs-remove and asserting the removed path is exactly the version dir under the store root (derived from
   `toolStoreRoot`), and source-grepping that no global/PATH/system path is the removal target.

These are structural (over the resolver, the store root, the lanes, the installer, the uninstall path) —
fitness functions, here, not task scenarios. Their observable counterparts are stories 01/02/03's
`.feature` files over real `uv` + the real tools.

**Alternatives considered.**
- *Fold these into the 08/09 bijection tests* — rejected: the 08/09 bijection is parameterised on the
  work/graph surface; the store/provider guards (resolution order, relocation, provider neutrality, npx
  preservation, store-scoped uninstall) are provisioning-specific structural facts that earn their own
  named tests so the fitness table indexes one reviewable contract per invariant (mirrors the 08/09 splits).
- *Make resolution-order / store-scoping runtime assertions (throw if PATH wins / if a non-store path is
  removed)* — rejected (same reasoning as 08/09): a runtime throw catches it late; an arch-test fails on
  the diff that introduces the drift. The source-grep + injected-seam import is the braces.
- *Enforce the no-hardcoded-home guard with a lint rule (no `os.homedir`)* — viable but rejected for house
  consistency: the codebase enforces these with `test/arch` source-greps, and an arch-test asserts the
  POSITIVE (the root DOES relocate under `AOF_GLOBAL_HOME`) as well as the negative, which a deny-list lint
  cannot.

**Consequences.** Story 04 authors all five arch-tests against the FROZEN store/registry (story 00) and
the lifecycle/retrofit (01/02/03); they are RED until those land, then GREEN and load-bearing. Story 04's
"contract" IS this ADR — it has no `.feature` pass of its own (mirrors `08/03` and `09/03`). Any future
change that makes a managed tool resolve PATH-first, hardcodes the store home, leaks a provider assumption
across lanes, regresses the npx lane, or widens uninstall beyond the version dir fails CI loudly.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is correct now: src/tool-store.mjs, the provider registry, the project:provision
     command, and the re-pointed 06/09 resolvers do not exist yet; the tests reference them and fail
     cleanly until stories 00/01/02/03 land. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Store-first resolution.** A managed tool resolves the store binary (`<store>/<name>/<version>/{Scripts\|bin}/<binary>[.exe]`) AHEAD of a PATH binary; a store miss falls back to PATH (06/09 behaviour); a total miss is a structured `{found:false,hint}`, never an opaque throw. Extends to the re-pointed `resolveGraphifyBinary` (09) and headroom lookup (06). | `test/arch/acd-tool-store-resolution-order.test.mjs` (import `resolveManagedBinary` + the re-pointed `resolveGraphifyBinary` / headroom lookup with injected store-hit AND PATH-hit; assert the store path wins; assert PATH-fallback on a store miss; assert the `{found:false,hint}` no-throw miss — the 09 `acd-graph-binary-absent` injected-seam idiom, extended) | RED until `src/tool-store.mjs`'s resolver + the 06/09 re-points land | ADR-001, ADR-004 (inv. 1) |
| **`AOF_GLOBAL_HOME` honoured / no hardcoded homedir.** The store root derives from `defaultGlobalWorkspaceDir` (relocatable via `AOF_GLOBAL_HOME`); no `os.homedir()` / `~/.aof` literal in the store/provision code. | `test/arch/acd-tool-store-global-home.test.mjs` (import `toolStoreRoot` with `AOF_GLOBAL_HOME` set → assert the root relocates under it; source-grep `tool-store.mjs` / `project-provision.mjs`, comments discounted, for `os.homedir(` / `".aof"` literals → none) | RED until the store helpers derive the root from `defaultGlobalWorkspaceDir` | ADR-001 (inv. 2) |
| **Provider-neutral registry.** The uv lane never shells `npx`; the npx lane never shells `uv`; dispatch is on `descriptor.provider`. No provisioning code leaks a provider-only assumption across lanes. | `test/arch/acd-provider-neutral-registry.test.mjs` (source-grep the registry + the uv lane: argv[0] is `uv`, no `npx`; the npx lane delegates to `frameworks.mjs`, argv[0] is `npx`, no `uv`; assert dispatch keys on `descriptor.provider`) | RED until the provider registry + the uv lane land | ADR-002 (inv. 3) |
| **npx lane preserved (regression guard).** `frameworks.mjs`'s framework-install behaviour + lock/attempt/`--force`/`SAFE_NPM_EXEC_ENV` semantics are unchanged — the registry's npx provider DELEGATES to the untouched planner; the npx argv shape stays `["npx", pkg, runtimeFlag, scopeFlag]`. | `test/arch/acd-npx-lane-preserved.test.mjs` (the existing milestone-01/GSD framework-install tests stay GREEN; source-grep `frameworks.mjs`: `planFrameworkInstall`/`executeFrameworkInstallPlan`/`frameworkPlanFromLock`/`SAFE_NPM_EXEC_ENV` still exported, npx argv shape intact) plus the existing framework tests as the byte-for-byte net | GREEN now (`frameworks.mjs` is intact) and must STAY green — a regression guard that the registry re-homes, not rewrites, the npx lane | ADR-002 (inv. 4) |
| **Uninstall is store-scoped.** Removal targets ONLY `toolVersionDir(name, version)` (`~/.aof/tools/<name>/<version>/`), never a global/system path, never the store root or a PATH dir. | `test/arch/acd-uninstall-store-scoped.test.mjs` (import the `uninstall` / `project:provision --uninstall` path with injected fs-remove; assert the removed path is exactly `toolVersionDir(name,version)` under `toolStoreRoot`; source-grep that no global/PATH/system path is the removal target) | RED until the uninstall path + `project:provision` land | ADR-002, ADR-003, ADR-004 (inv. 5) |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 08/09's split):
     - STORE-FIRST RESOLUTION, GLOBAL-HOME-HONOURED, PROVIDER-NEUTRAL, NPX-LANE-PRESERVED,
       UNINSTALL-STORE-SCOPED are structural invariants over the resolver / store root / provider lanes /
       installer / uninstall path → arch-tests (this table). They are the milestone's load-bearing
       deliverable (story 04 — no .feature pass of its own, mirroring 08/03 and 09/03).
     - The OBSERVABLE end-to-end behaviours — "`aof project provision graphify` installs a real uv venv
       into ~/.aof/tools/graphify/0.8.44/", "`aof project doctor` reports it present-and-versioned FROM THE
       STORE", "a tool driver resolves the store binary ahead of a global", "the temporary global graphify
       is removed and the store copy resolves", "`headroom-ai[all]` installs via the uv lane and the win32
       platform warning fires" — belong in task .feature files authored by stories 01/02/03 over REAL uv +
       the real tools, gated @manual where they need a live binary or a POSIX/Windows host
       (RESEARCH §A1/A2/A3/A4).
     - The command-core bijection for project:provision (it carries a `cli` adapter + dispatches via the
       registry with --json) is INHERITED from 08/ADR-004 — the existing acd-work-command-cli-bijection
       family extends to it; it is not re-litigated as a new fitness function here.
     - Path-display (CLI --json relativises storePath to cwd) is a FACE adapter (08/ADR-002), proven by the
       CLI --json contract, not a fitness function of its own. -->
