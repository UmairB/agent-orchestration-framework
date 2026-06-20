---
type: milestone
number: 06
slug: headroom-plugin
title: "Headroom Plugin"
status: done
owner: product-owner
created: 2026-06-20
updated: 2026-06-20
depends: [00, 03]
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 06 · Headroom Plugin

## Objective

Give aof an **optional, config-gated plugin** that fronts the work-board terminal's AI agent CLIs
(`claude` / `codex`) with the open-source **headroom** context-compression layer
([github.com/chopratejas/headroom](https://github.com/chopratejas/headroom)), so a developer running
long agent sessions against work items spends materially fewer tokens for the same result — *without
aof taking on any dependency on headroom's Python/Rust/ONNX stack*.

headroom is a transport-layer concern, not a memory or work-stream concern: it sits between the
terminal's spawned provider CLI and the model API and compresses what flows through. It composes with
the existing terminal runner (milestone 03) at exactly one seam — the `CliProvider` that decides which
binary is launched and with what args/env — and changes nothing about the wire envelope, the board, or
the work stream itself.

The load-bearing constraints (what makes this a *plugin*, not a feature):

- **Absent ≡ off.** No `headroom` config ⇒ the terminal behaves exactly as it does today. The plugin
  is invisible until a developer opts in.
- **Honest-degrade.** With the plugin enabled but the `headroom` binary not installed, a session falls
  back to the raw provider — it never breaks the terminal. This reuses the existing missing-binary gate
  ethos of the provider seam (a missing CLI surfaces a control-frame / degrades, never a crash).
- **No-install invariant.** aof never bundles or installs headroom; it stays a PATH-detected external
  tool, like the provider CLIs themselves. aof's own dependency surface (`package.json`,
  supply-chain audit) gains nothing.

An outsider can verify the objective is met when: with headroom installed and the plugin enabled, a
work-board terminal session for `claude` or `codex` demonstrably routes its provider calls through
headroom (a proxy hit / measured token reduction); and with the plugin absent — or headroom not on
PATH — the same session runs byte-for-byte as it does today.

## Scope

In scope:
- **Plugin config block** — the opt-in selection a developer sets to turn the plugin on, shaped
  roughly `{ enabled, mode, providers, port, stateless }`. Placement is **`work.headroom`** (a peer to
  `work.ui`): headroom's only aof surface is the work-board terminal runner, which is a `work` concern,
  and the top-level `memory` precedent does not transfer (memory had an explicit SPEC mandate and a
  stream-wide scope; this has neither). The exact key set and placement are confirmed in the milestone
  ADR at refine.
- **Enable/disable surface** — `aof work init --with-headroom` (write the block on a fresh install) and
  `aof work use-headroom` / `aof work unuse-headroom` (toggle it on an existing repo), siblings of the
  existing `aof work memory` / `aof work board` subcommands. `use-headroom` checks for the `headroom`
  binary on PATH and, when absent, prints an install hint — but never installs it.
- **Wrap mode (the cheap-first default)** — the provider seam launches `headroom wrap <provider>` in
  place of the raw CLI for the configured providers; a missing `headroom` binary falls back to the raw
  provider. This is the whole runtime behaviour for v0.
- **Provider mapping + honest-degrade contract** — `claude` and `codex` are the routable providers;
  `gemini` is unsupported by headroom's proxy (Google GenAI is not OpenAI-compatible) and always passes
  through unchanged. Enabled-but-unavailable degrades to the raw provider.
- **The no-install / no-derived-state invariants enforced structurally** — a fitness function asserts
  aof never references headroom as a dependency; the plugin writes only config, never the lock.

Out of scope:
- **Proxy mode** — one shared `headroom proxy` child owned by the board server, with
  health-check-before-inject of `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` per session. It is *designed*
  here (an ADR records it as the graduation path) but **not shipped**: v0 proves wrap mode first and
  graduates to proxy only if it earns its keep — the same "prove the cheap thing first" discipline as
  milestone 05's ranking ADR. Deferred to a later milestone.
- **Installing or bundling headroom**, and any headroom *feature* tuning beyond on/off (output shaper,
  cross-agent memory, cache TTLs) — these are headroom's own knobs, set by the developer outside aof.
- **Routing anything other than the work-board terminal** (e.g. the host runtime aof's bundled commands
  run inside) — aof does not spawn those, so there is nothing to front.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: NN.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

- [x] **00 · headroom-config-contract** — freeze the `work.headroom` schema (ADR-001/002) + the pure honest-degrade resolver `resolveHeadroomLaunch` (ADR-003). The spine the other two build against.
- [x] **01 · headroom-toggle-cli** — `aof work use-headroom` / `unuse-headroom` + `aof work init --with-headroom`: config-only read-merge-write, PATH-check + install hint, never the lock (ADR-004).
- [x] **02 · headroom-wrap-routing** — wire `resolveHeadroomLaunch` into `handleConnection` so an enabled session spawns `headroom wrap <provider>` and degrades to raw when headroom is absent (ADR-003).

## Dependencies

- **00 · work-cli** — the plugin extends the `aof work` command surface (`use-headroom` /
  `unuse-headroom`) and the `--with-headroom` flag is threaded through `initWork`.
- **03 · work-board-ui** — the plugin fronts that milestone's terminal provider seam
  (`CliProvider` in `terminal-providers.mjs`); it has nowhere to attach without it.
- **05 · work-memory** *(precedent, not a hard dependency)* — the optional-subsystem config pattern
  (a `$defs` block, absent ≡ off, graceful no-op / honest-degrade) is the template this milestone
  reuses for `work.headroom`.
