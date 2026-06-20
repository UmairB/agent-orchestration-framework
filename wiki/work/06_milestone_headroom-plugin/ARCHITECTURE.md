---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 06 · Headroom Plugin — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope) and `STATE.md` (the four open ADR topics +
> the known integration facts from pre-framing research). ADRs cite these as `SPEC §…` / `STATE §…`.
> The integration seam is milestone 03's `src/terminal-providers.mjs` (the `CliProvider`) and its
> consumer `src/terminal-ws.mjs` `handleConnection`; the optional-subsystem config pattern is borrowed
> from milestone 05's `$defs/memory` (ADR-002 there). headroom is an external PATH-detected tool
> (github.com/chopratejas/headroom), never an aof dependency.

## ADR-001: The plugin config block is `work.headroom` — a peer of `work.ui`; OPTIONAL, and absent ≡ off (the plugin is invisible)

**Status:** Accepted
**Date:** 2026-06-20

**Context.** headroom's only aof surface is the work-board terminal runner (milestone 03) — a `work`
concern — so its config belongs under `work`, not at top level (`STATE §Notes`: placement "settled at
framing as `work.headroom`, reversing an initial top-level suggestion"). The milestone-05 top-level
`memory` precedent (ADR-002 there) does **not** transfer: memory had an explicit SPEC mandate for a
top-level key and a stream-wide scope; headroom has neither (`SPEC §Scope`). The schema today
(`schemas/aof.schema.json`) has `$defs/work` with `additionalProperties: true`, and a sibling
`work.ui` object with `additionalProperties: false` — the exact precedent for a small, closed,
optional sub-object. The load-bearing SPEC constraint is **absent ≡ off**: no `work.headroom` config
⇒ the terminal behaves exactly as it does today (`SPEC §Scope`, "the plugin is invisible until a
developer opts in"). STATE settled this at framing — this ADR records it; it is not relitigated.

**Decision.** The plugin config lives at **`work.headroom`**, a new object under `$defs/work`, peer to
`work.ui`. It is **OPTIONAL**; its absence — and `enabled: false` — are both equivalent to the plugin
being off (the terminal launch is byte-for-byte unchanged). The block carries
`additionalProperties: false` (like `work.ui`), so an unknown key fails validation. The v0 key set is
frozen below (`mode`/`providers`/`port`/`stateless` discipline is settled in ADR-002). The work
*directory* and the provider vocabulary are **not** re-declared under `work.headroom` — providers are
the existing `PROVIDER_IDS` from `terminal-providers.mjs`, read where the seam already resolves them.

**The locked shared contract — `work.headroom` config block (frozen 2026-06-20):**

```jsonc
// .aof/aof.config.json  →  work.headroom  (OPTIONAL; absent ≡ off; enabled:false ≡ off)
{
  "work": {
    "headroom": {
      "enabled": true,                 // bool — the master switch. Absent block OR false ⇒ raw passthrough.
      "mode": "wrap",                  // enum: "wrap" ONLY in v0. "proxy" is rejected at schema (ADR-002).
      "providers": ["claude", "codex"] // OPTIONAL subset of the ROUTABLE providers to front.
                                       // Absent ⇒ default = both routable (["claude","codex"]).
                                       // "gemini" is NOT a valid member (ADR-003 — never routable).
    }
  }
}
```

`enabled` is the only required-by-meaning key (an enabled block with no `mode` defaults to `"wrap"`;
the schema's `enabled` is the gate the resolver reads first). `port` and `stateless` are **deliberately
absent from the v0 schema** — they are proxy-mode knobs (ADR-002), and admitting them now would let a
config assert intent the runtime cannot honour. They enter the schema in the proxy milestone, not here.

**Alternatives considered.**
- *Top-level `headroom` (mirror milestone 05's `memory`)* — rejected: `STATE §Notes` records this was
  considered and reversed; headroom is scoped to the work-board runner, and a top-level key would
  advertise a first-class subsystem with surfaces beyond `work` that do not exist.
- *Fold into `work.ui`* — rejected: `work.ui` is design-review settings (`baseUrl`); headroom is a
  transport concern on the terminal runner, not a UI concern. Distinct closed objects keep each
  self-documenting and independently validatable.
- *Include `port`/`stateless` now as reserved keys* — rejected: with `additionalProperties: false`,
  reserved-but-unused keys are dead schema that imply shipped behaviour (proxy) that v0 does not have.
  Add them in the milestone that uses them (ADR-002's graduation path).

**Consequences.** The only schema change is one new object under `$defs/work` (no root-ref change —
`work` is already referenced). The seam reads `config.work?.headroom` where `loadWorkspace(projectDir)`
already runs in `handleConnection` (`STATE §Known integration facts`) — no new config read site. Adding
proxy keys later is a localised, reviewable schema diff.

**Invariant.** `work.headroom` is the *only* config surface that turns the plugin on; it is OPTIONAL,
closed (`additionalProperties: false`), and an absent block or `enabled:false` leaves the terminal
launch unchanged. A `mode` outside the v0 enum, or any unknown key, fails schema validation. (Enforced
by `acd-headroom-config-schema`.)

## ADR-002: Wrap mode is the entire v0 runtime; proxy mode is designed here as the graduation path but NOT shipped — the schema rejects `mode: "proxy"`

**Status:** Accepted
**Date:** 2026-06-20

**Context.** headroom offers two integration shapes (`SPEC §Scope` / `§Out of scope`): **wrap** —
launch `headroom wrap <provider>` in place of the raw CLI per session; and **proxy** — one shared
`headroom proxy` child owned by the board server, injecting `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`
per session after a health check. Wrap is the cheap thing: a per-session argv rewrite at the existing
seam, no shared process, no lifecycle, no health-check race. Proxy is strictly more capable
(cross-session cache, shared memory) but introduces a long-lived child + readiness gating. The SPEC
explicitly mirrors milestone 05's "prove the cheap thing first" discipline: ship wrap, design proxy,
graduate only when it earns its keep (`SPEC §Out of scope`, "v0 proves wrap mode first and graduates
to proxy only if it earns its keep — the same discipline as milestone 05's ranking ADR"). The seam is
ready for proxy already: `buildEnv(sessionId, baseEnv, _opts = {})` carries an unused `_opts` param
"reserved for proxy-mode env injection later" (`STATE §Known integration facts`).

**Decision.** v0 ships **wrap mode only**. `mode` is an enum whose *only valid member in v0 is
`"wrap"`*; `mode: "proxy"` **fails schema validation** (it is rejected at the schema, not
accept-and-degraded). Rejecting-at-schema (rather than accept-and-degrade) is chosen because proxy is
a *different runtime topology*, not a tuning of wrap: silently degrading `proxy → wrap` would let a
developer believe the shared-proxy benefits (cross-session cache) are active when they are not — a
dishonest state, the opposite of the honest-degrade ethos (ADR-003). A loud schema failure with a
clear message ("proxy mode is not yet available; use mode: wrap") is the honest signal. Proxy is
*designed here* as the documented graduation path and the `_opts` env-injection seam is preserved
untouched, so the later milestone is additive (one enum member + the proxy lifecycle + reading
`_opts`), not a rewrite.

**The graduation trigger (recorded, not shipped).** Proxy mode earns its keep — and a follow-on
milestone is justified — when wrap mode is in real use and at least one of: (a) cross-session context
reuse (a cache/memory shared across terminals) is demonstrably needed, which wrap (one headroom child
per session) structurally cannot provide; or (b) per-session `headroom wrap` spawn cost / duplicated
warmup is measured as material. Until that evidence exists, wrap is the whole runtime. (Mirrors
milestone 05 ADR-006's "the day filter+keyword stops surfacing the right record" graduation signal.)

**Alternatives considered.**
- *Accept `mode: "proxy"` and degrade to wrap* — rejected: degrading proxy→wrap fakes a capability the
  runtime does not have (shared cache), which is dishonest; schema rejection is the honest signal. Note
  this is the *opposite* call to ADR-003's missing-binary degrade — because there the fallback (raw
  provider) is an honest, complete behaviour, whereas wrap-standing-in-for-proxy is not.
- *Ship proxy now* — rejected by the SPEC (`§Out of scope`): it is explicitly deferred; v0's thesis is
  that wrap suffices until proven otherwise.
- *Omit `mode` entirely in v0 (wrap is implicit)* — rejected: recording the enum (with proxy rejected)
  is what makes the graduation path a reviewable one-line diff and documents the design decision in the
  schema itself.

**Consequences.** The wrap-mode story builds the per-session argv rewrite against the frozen resolver
(ADR-003) with no proxy lifecycle to mock. The schema's `mode` enum is the single touchpoint the proxy
milestone widens. The `_opts` param stays untouched, reserved. The cost is that a developer who sets
`mode: "proxy"` gets a validation error rather than a working session — intentional: it tells the truth.

**Invariant.** v0 accepts `mode: "wrap"` only; `mode: "proxy"` (or any other value) fails schema
validation, and no v0 source path spawns a long-lived `headroom proxy` child or injects
`ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`. (Enforced by `acd-headroom-config-schema` for the enum, and
`acd-headroom-no-proxy-runtime` for the no-proxy-spawn assertion.)

## ADR-003: The honest-degrade contract is a single pure resolver `resolveHeadroomLaunch({...}) → { bin, args }` — the frozen seam ↔ runtime contract two stories share

**Status:** Accepted
**Date:** 2026-06-20

**Context.** This resolver is the spine of the milestone: it is the *one* function where "should this
session be wrapped, and if so how" is decided, and it is what the config/schema story and the
wrap-routing story couple through. The SPEC's load-bearing behaviours all live here (`SPEC §Scope`,
`§Objective`): **absent ≡ off** → raw; **gemini always passthrough** (headroom's proxy is OpenAI +
Anthropic-compatible only; Google GenAI is not OpenAI-compatible, `STATE §Known integration facts`);
**enabled + routable but `headroom` not on PATH → degrade to raw**, never break the terminal (the same
honest-degrade ethos as the existing missing-provider-binary gate in `handleConnection`, which emits
an error control-frame / runs raw rather than crashing). The seam consumer already has everything the
resolver needs at the call site: it resolves the provider, computes the raw `bin` via
`resolveBinaryPath(baseEnv)`, and the raw `args` via `buildArgs()`, and it has `config` in scope via
`loadWorkspace(projectDir)` (`STATE §Known integration facts`). So the resolver is a *pure decoration*
of an already-computed raw launch — it takes the raw `{bin, args}` and the config and returns either
the same launch untouched or a headroom-wrapped one. Making it pure (no PATH/spawn side effects of its
own; the `headroom`-on-PATH check is injected) is what lets the wrap story test every degrade branch
with a stubbed `which` and no PTY — exactly how the provider seam injects `which` today.

**Decision.** A single pure function **`resolveHeadroomLaunch`** is the frozen contract. It lives in a
new module **`src/headroom.mjs`** (the plugin runtime; built by the wrap-routing story). Its signature
and decision table are frozen below. It performs no spawn and no real PATH walk: the `headroom` binary
lookup is the **injected `which`** (default: the same `defaultWhich` idiom the provider seam uses), so
the resolver is total and side-effect-free. `handleConnection` calls it *after* computing the raw
`bin`/`args` and *before* `spawn`, passing the resolved `config.work?.headroom`. The return is always
a valid launch — on every "off / not-routable / degrade" branch it returns the raw `{ bin, args }`
**unchanged** (object-identical fields), so an absent-or-degraded plugin is byte-for-byte today's
behaviour.

**The locked shared contract — `resolveHeadroomLaunch` (frozen 2026-06-20):**

```js
// src/headroom.mjs — the plugin's whole runtime decision. PURE: no spawn, no real
// PATH walk (the headroom lookup is the injected `which`). Returns a launch that is
// EITHER the raw provider launch unchanged OR a headroom-wrapped one.
//
// resolveHeadroomLaunch({
//   providerId,        // string — one of PROVIDER_IDS ("claude" | "codex" | "gemini")
//   config,            // the loaded aof config object (reads config.work?.headroom only)
//   rawBin,            // string — the provider's resolved absolute binary (resolveBinaryPath result)
//   rawArgs,           // string[] — the provider's raw args (buildArgs result)
//   env,               // env for the headroom PATH lookup (defaults handled by the seam)
//   which              // OPTIONAL injected (binName, env) => absolutePath|null  (default: real PATH)
// }) => { bin, args, wrapped }
//
// DECISION TABLE (first match wins):
//   1. config.work?.headroom absent OR enabled !== true   → { bin: rawBin, args: rawArgs, wrapped: false }
//   2. providerId not in the routable set                 → { bin: rawBin, args: rawArgs, wrapped: false }
//        routable set = (headroom.providers ?? ["claude","codex"]) ∩ {"claude","codex"}
//        (gemini is NEVER routable — it can never enter the set, even if listed)
//   3. routable, but `which("headroom", env)` === null    → { bin: rawBin, args: rawArgs, wrapped: false }
//        (enabled-but-unavailable DEGRADES to raw — never breaks the terminal)
//   4. enabled + routable + headroom on PATH              → {
//          bin: <resolved headroom path>,
//          args: ["wrap", providerId, ...rawArgs],   // `headroom wrap <provider>` then the raw args
//          wrapped: true
//        }
```

The wrapped form is `headroom wrap <providerId>` followed by the provider's own raw args — headroom
runs the provider as its child, so the raw `bin`/`args` flow through unchanged underneath. The seam
spawns `result.bin` with `result.args`; nothing else in `handleConnection` changes.

**Alternatives considered.**
- *Branch inside `handleConnection` / `CliProvider` directly* — rejected: scatters the off/gemini/
  degrade logic across the consumer and the provider, couples the two stories, and makes every branch
  require a PTY to test. A single pure function is one test surface and one frozen contract.
- *Make the resolver do its own PATH walk + spawn-probe* — rejected: impure, untestable without a real
  `headroom`, and duplicates the provider seam's injectable-`which` pattern. Inject `which`; keep it
  pure (matches `terminal-providers.mjs`).
- *Throw / emit an error control-frame when enabled-but-headroom-absent* — rejected: that breaks the
  terminal for a plugin the developer opted into, violating the SPEC's honest-degrade constraint
  (`SPEC §Scope`). Degrade silently to raw; surface the absence only at enable-time (ADR-004's hint).

**Consequences.** The config/schema story freezes the `work.headroom` shape (ADR-001) and the
wrap-routing story builds `resolveHeadroomLaunch` against this signature and wires the one call in
`handleConnection`; they couple only through this frozen function. Every degrade branch is a pure unit
test with a stubbed `which`. A future proxy mode adds a branch here (or a sibling) that reads
`mode: "proxy"` and returns env-injection via the seam's reserved `_opts` — additive, behind the same
contract.

**Invariant.** `gemini` is never wrapped (it can never enter the routable set); an absent/`disabled`
`work.headroom` returns the raw launch unchanged; an enabled+routable provider with `headroom` absent
from PATH degrades to the raw launch (never an error, never a spawn failure). The resolver is the only
place the wrap decision is made, and it is pure (no spawn, real PATH walk only via injected `which`).
(Enforced by `acd-headroom-honest-degrade`.)

## ADR-004: The enable/disable surface is a config-only read-merge-write of `work.headroom` — it NEVER touches the lock, and `use-headroom` PATH-checks (hint, never install)

**Status:** Accepted
**Date:** 2026-06-20

**Context.** The plugin is turned on three ways (`SPEC §Scope`): `aof work init --with-headroom` (write
the block on a fresh install), `aof work use-headroom` / `aof work unuse-headroom` (toggle on an
existing repo) — siblings of the existing `aof work memory` / `aof work board` subcommands dispatched
by `workCommand` in `src/cli.mjs`. There is **no existing precedent** for a CLI subcommand that toggles
a config *block* in `aof.config.json` (`STATE`: memory was enabled by hand-editing) — so this
read-merge-write-config mechanism is a NEW pattern this ADR specifies. The codebase already has the
*ingredients*: `cli.mjs` reads config with `readJson(configPath)` and writes it with
`writeText(configPath, JSON.stringify(config, null, 2) + "\n")` (the resource enable/disable commands
at `src/cli.mjs:~785-808`), and `findProjectConfig` / `loadWorkspace` resolve the path. The critical
separation: config (`aof.config.json`, developer intent) and the lock (`.aof/aof.lock.json`, derived
install provenance) are distinct artifacts — the plugin is *intent*, so it writes config and **never
the lock** (mirrors milestone 05's derived-state discipline and milestone 02's lock-section
isolation). `use-headroom` checks for `headroom` on PATH and, when absent, prints an install hint — but
never installs (the no-install invariant, ADR-005).

**Decision.** The enable/disable surface is **config-only read-merge-write**. The mechanism:
read `aof.config.json` (or the init template), set/clear **only** `config.work.headroom` (preserving
every other key in `work` and at the root via a shallow merge), and write it back with the project's
existing 2-space + trailing-newline JSON style. `use-headroom` sets `work.headroom.enabled = true` (and
`mode: "wrap"`, default providers if absent); `unuse-headroom` sets `enabled: false` (it does **not**
delete the block — toggling preserves the developer's `providers` choice; absent ≡ off and
`enabled:false` ≡ off are equivalent per ADR-001, so disabling by flag is honest and reversible).
`--with-headroom` threads through `initWork` to write the block on a fresh install. `use-headroom`
PATH-checks `headroom` (the injectable `which` from ADR-003) and, when absent, prints a one-line
install hint pointing at github.com/chopratejas/headroom — it **never** runs an installer. None of
these three paths reads or writes `.aof/aof.lock.json`.

**The locked behaviour — config-only mutation (frozen 2026-06-20):**

```
use-headroom    : config.work.headroom = { enabled: true, mode: "wrap",
                                           providers: <existing or default ["claude","codex"]> }
unuse-headroom  : config.work.headroom.enabled = false   (block kept; providers preserved)
init --with-headroom : same write as use-headroom, applied to the fresh config
ALL THREE       : write ONLY aof.config.json (work.headroom subtree); read/write of
                  .aof/aof.lock.json is FORBIDDEN on these code paths.
use-headroom + headroom-not-on-PATH : still writes the config (intent is honoured),
                  AND prints an install hint; NEVER installs (ADR-005).
```

**Alternatives considered.**
- *`unuse-headroom` deletes the `work.headroom` block* — rejected: deletion loses the developer's
  `providers` selection; `enabled:false` is the honest, reversible off-state (ADR-001 makes the two
  equivalent for the runtime), and a kept-but-disabled block documents that the plugin was considered.
- *Toggle by writing the lock (treat the plugin as installed state)* — rejected: the plugin is
  developer *intent*, not derived install provenance; writing the lock would conflate the two artifacts
  and is the exact isolation the milestone-02 lock-section ADR defends. Config is the only writer.
- *`use-headroom` installs `headroom` when absent* — rejected by the SPEC's no-install invariant
  (`SPEC §Scope`, ADR-005): aof never installs headroom. A hint is the whole obligation.

**Consequences.** The CLI story owns these three entry points and the read-merge-write helper; it
couples to the config-shape story only through the frozen `work.headroom` shape (ADR-001), not through
the runtime resolver. The lock stays untouched, so a no-clobber fitness function can prove a seeded
lock survives an enable/disable byte-intact (mirrors `acd-planning-lock-isolation`). The cost is one
new read-merge-write helper — the pattern future block-toggles (e.g. a `use-memory`) would reuse.

**Invariant.** `use-headroom` / `unuse-headroom` / `init --with-headroom` write **only** the
`work.headroom` subtree of `aof.config.json` (every other config key survives byte-intact) and **never**
read or write `.aof/aof.lock.json`; `use-headroom` with `headroom` absent from PATH still writes the
config and prints an install hint but runs no installer. (Enforced by `acd-headroom-config-isolation`.)

## ADR-005: aof never references headroom as a dependency or installs it — headroom is a PATH-detected external tool, enforced structurally

**Status:** Accepted
**Date:** 2026-06-20

**Context.** What makes this a *plugin* and not a feature is that aof's own dependency surface gains
nothing (`SPEC §Objective` / `§Scope`): headroom stays a PATH-detected external tool, "like the
provider CLIs themselves" (`claude` / `codex` are resolved off PATH by `terminal-providers.mjs`, never
npm deps). headroom carries a Python/Rust/ONNX stack aof must never take on. aof's dependency surface
is `package.json` (`dependencies` / `devDependencies`) and `package-lock.json`, audited by
`scripts/supply-chain-audit.mjs` (an `allowedInstallScripts` allowlist + a deps audit). The plugin
runtime resolves `headroom` the same injectable-`which` way the provider seam resolves `claude` (ADR-003).

**Decision.** `headroom` appears **nowhere** in aof's dependency surface: not in `package.json`
`dependencies`/`devDependencies`, not as a package node in `package-lock.json`, and the plugin source
(`src/headroom.mjs` and any sibling) **never** `import`s a headroom package nor shells out to install
one (`npm install` / `pip install` / `cargo install` / a headroom installer). headroom is resolved
**only** as a binary on PATH via the injected `which` (ADR-003). This is purely a structural invariant
(no behavioural runtime to gate): it is a **fitness function**, not a story of its own — exactly as
milestone 05's derived-index invariant was arch-tests only, not a build story (`memory` ARCHITECTURE
fitness-function note). The supply-chain audit's allowlist is untouched: headroom is never an install
script because it is never a dependency.

**Alternatives considered.**
- *Vendor a headroom client / SDK as a dependency* — rejected by the SPEC: it pulls headroom's
  Python/Rust/ONNX surface into aof's audited dependency tree, which the milestone exists to avoid.
- *Make no-install a build story* — rejected: there is no behaviour to build (the absence of a
  dependency is purely structural); a fitness function over `package.json` + the plugin source is the
  whole enforcement, GREEN now for the manifest assert and RED-until-source for the import assert.

**Consequences.** The no-install guarantee is CI-enforced and cheap: a manifest grep plus a source
grep, no runtime. Adding headroom as a dep (or an installer shell-out) in any future change fails CI
loudly. The plugin's only coupling to headroom is the PATH-resolved binary name — swappable, auditable,
and zero supply-chain weight.

**Invariant.** `headroom` is absent from `package.json` `dependencies`/`devDependencies` and from
`package-lock.json` package nodes, and the plugin source neither imports a headroom package nor invokes
any installer (`npm/pip/cargo install`, etc.) — headroom is referenced only as a PATH binary name.
(Enforced by `acd-headroom-no-dependency`.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: the plugin runtime (src/headroom.mjs) and the CLI
     toggle surface do not exist yet; the tests reference them so they fail cleanly until built. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| `work.headroom` is OPTIONAL + closed (`additionalProperties: false`); `enabled:true`/`mode:"wrap"`/`providers:["claude","codex"]` validates; an absent block validates; `mode:"proxy"`, any other `mode`, an unknown key, or `providers:["gemini"]` fails validation on the `$defs/work` → `headroom` subtree | `test/arch/acd-headroom-config-schema.test.mjs` (compile `schemas/aof.schema.json` with Ajv-2020; validate the positive/negative configs above; assert the proxy/unknown-key failures point at the `work.headroom` enum/additionalProperties keywords) | GREEN once the schema change lands; RED until then (the `work.headroom` `$def` does not exist yet) | ADR-001, ADR-002 |
| `resolveHeadroomLaunch` is the only wrap decision and it is total + honest-degrade: absent/`disabled` → raw unchanged; `gemini` → raw unchanged (never wrappable); enabled+routable but `headroom` not on PATH (injected `which` → null) → raw unchanged; enabled+routable+on-PATH → `{ bin: <headroom>, args: ["wrap", providerId, ...rawArgs] }` | `test/arch/acd-headroom-honest-degrade.test.mjs` (import `resolveHeadroomLaunch` from `src/headroom.mjs`; drive all four decision-table branches with a stubbed `which` reporting headroom present/absent and assert the exact returns; assert `gemini` is never wrapped even when listed in `providers`) | RED until `src/headroom.mjs` exports `resolveHeadroomLaunch` (the import resolves to a missing module) | ADR-003 |
| The enable/disable surface writes ONLY the `work.headroom` subtree of `aof.config.json` (every other config key survives byte-intact) and NEVER reads/writes `.aof/aof.lock.json`; `unuse` keeps the block with `enabled:false` | `test/arch/acd-headroom-config-isolation.test.mjs` (seed a temp project's `aof.config.json` with foreign `work.ui` + root keys AND seed `.aof/aof.lock.json` with foreign sections; run the `use-headroom`/`unuse-headroom` toggle; assert `work.headroom` is set/cleared, every seeded config key survives deep-equal, and the seeded lock is byte-identical — adapted from `acd-planning-lock-isolation`'s seed-and-prove-survival idiom, config vs lock) | RED until the toggle entry point (`useHeadroom`/`unuseHeadroom` in `src/work-headroom.mjs`) exists | ADR-004 |
| `headroom` is absent from `package.json` deps/devDeps and from `package-lock.json` package nodes; the plugin source never imports a headroom package nor invokes an installer | `test/arch/acd-headroom-no-dependency.test.mjs` (parse `package.json` → assert no `headroom` dep/devDep; parse `package-lock.json` → assert no `headroom` package node; once `src/headroom.mjs` exists, grep it (comments stripped) for `import ... headroom`/`npm install`/`pip install`/`cargo install` → none) | The manifest asserts are GREEN now (headroom is not a dep); the source-import assert is conditionally skipped until `src/headroom.mjs` exists, then enforced (documented in the header) | ADR-005 |
| No v0 source path spawns a long-lived `headroom proxy` child or injects `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` (proxy is designed, not shipped) | `test/arch/acd-headroom-no-proxy-runtime.test.mjs` (grep `src/*.mjs` with comments stripped for `headroom proxy`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` as code literals → none in v0; the `buildEnv` `_opts` param stays reserved/unused) | GREEN now (no proxy code exists) and must STAY green through v0 — a regression guard; the wrap-routing story must not smuggle proxy code in | ADR-002 |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 05's split):
     - ADR-003's degrade table is a TRUE structural invariant over a pure function → arch-test
       (acd-headroom-honest-degrade). The OBSERVABLE end-to-end "a wrapped session actually spawns
       `headroom wrap claude`" belongs in a task .feature for the wrap-routing story (it exercises the
       real handleConnection + a stubbed spawn), not here.
     - ADR-005's no-install is arch-tests ONLY (no story) — there is no behaviour to build, exactly as
       milestone 05's derived-index invariant was arch-tests only.
     - The install-hint TEXT of `use-headroom` is a behavioural CLI scenario (a task .feature on the CLI
       story), not a fitness function — only "writes config, not lock, never installs" is structural. -->
