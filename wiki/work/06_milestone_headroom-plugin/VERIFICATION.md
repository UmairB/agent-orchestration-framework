---
doc: verification
ref: "06"
verified: 2026-06-20
verdict: "milestone accepted — all three stories (00 config-contract, 01 toggle-cli, 02 wrap-routing) done; @executable suite + 5 fitness functions green; no blocker finding open"
---
# 06 · Headroom Plugin — Verification

Verification lanes in scope: **`@executable` only** (all 10 task features across the three stories,
including every Scenario Outline row). There are **zero `@manual`** scenarios (the plugin is a
config + transport-seam concern with no agent-runnable live procedure beyond the automated harness)
and **zero `@uat`** scenarios — headroom is a foundational CLI/transport subsystem with no
human-judgement surface — so neither the agent `@manual` lane nor the human sign-off lane applies and
the user is not pulled in. No UI / `DESIGN.md`, so no design-conformance lens.

## Verification evidence

- **`@executable` suite — green.** `node ./scripts/test.mjs` → **774 ok / 0 not-ok (exit 0)**. The
  three traceability modules cover all 10 task features end-to-end:
  `test/headroom-config-contract.test.mjs` (story 00 — `schemas/aof.schema.json` `work.headroom`
  `$def` + the pure `resolveHeadroomLaunch` branch table), `test/headroom-toggle-cli.test.mjs`
  (story 01 — `use-headroom` / `unuse-headroom` / `init --with-headroom` read-merge-write), and
  `test/headroom-wrap-routing.test.mjs` (story 02 — `resolveHeadroomLaunch` wired through the real
  `handleConnection` with an injected stub spawn + stub PATH lookup). Every Scenario Outline row is
  traced: story 02/00's two named scenarios and its outline rows are the same observable case over
  `{claude, codex}` and are discharged by one parametrised test per provider (documented in the test).
  verifies → all 10 `@executable` task features under `stories/*/tasks/*.feature`.
- **Fitness functions — green.** All 5 `test/arch/acd-headroom-*` arch-tests pass (13 assertions):
  `acd-headroom-config-schema` (ADR-001 frozen v0 block validates / closed / gemini rejected; ADR-002
  `mode:"proxy"` rejected at the enum), `acd-headroom-honest-degrade` (ADR-003 absent/disabled/gemini/
  headroom-absent → raw unchanged; enabled+routable+PATH → `headroom wrap <provider>`),
  `acd-headroom-config-isolation` (ADR-004 use/unuse preserve every other config key and leave the
  install lock byte-intact), `acd-headroom-no-dependency` (ADR-005 headroom absent from
  `package.json`/`package-lock.json`; the plugin source — `src/headroom.mjs` + `src/work-headroom.mjs`
  — never imports a headroom package nor invokes an installer), `acd-headroom-no-proxy-runtime`
  (ADR-002 no v0 source spawns a `headroom proxy` child or injects `ANTHROPIC_BASE_URL` /
  `OPENAI_BASE_URL`).
  verifies → the structural invariants in [ARCHITECTURE.md](ARCHITECTURE.md) `## Fitness functions`.
- **No-install invariant — independently spot-checked.** Beyond the green arch-test, a direct grep
  confirms `headroom` appears in neither `package.json` nor `package-lock.json`, and neither
  `src/headroom.mjs` nor `src/work-headroom.mjs` imports a headroom package or shells out to an
  installer. aof's dependency / supply-chain surface gains nothing from the plugin, exactly as the
  objective requires.

## Validate gate

`aof:validate 06` → **PASS**. The CLI keystone `aof work validate 06` exits 0 and the whole-stream
`aof work validate` exits 0 (folder↔frontmatter, the closed tag vocabulary, the `depends` graph
[00, 03] resolving and acyclic). Agent layer clean: every `@executable` scenario (and every Scenario
Outline row) is backed by a green test registered in `scripts/test.mjs`; no `@manual` evidence row or
`@uat` sign-off row is owed; no dangling `@finding-<id>` and no `verifies →` to resolve (no findings
raised); no `uat` session in scope. Litmus advisory-clean — the transport-seam `Then` steps observe
the injected-stub spawn's binary/args and the control-frame stream (the accepted ACD observable
surface for this seam, explicitly defended in each feature's narrative), and the config/schema steps
assert validity and written bytes — neither asserts internal call ordering, resolver purity, nor any
visual fidelity.

## Accept decision

**Accepted — 2026-06-20.** Gate `aof:validate 06` is PASS, the `@executable` + fitness lanes are
green (774 ok / 0 fail; 5/5 fitness functions), and **no blocker finding is open** (none were raised —
the build was clean; the craft-review bug, the config-path divergence and the arch-test-scope nit were
all caught and resolved *before* this gate and are carried into [RETROSPECTIVE.md](RETROSPECTIVE.md)).
All three stories are `done`, so the milestone is accepted: `SPEC.md status: done`, its `## Stories`
boxes ticked, `STATE.md` compacted. No human `@uat` lane existed, so no user sign-off was required.
Milestone 06 is a leaf — **no milestone `depends:` on it** — so accepting it unblocks nothing
downstream; it delivers the optional, config-gated headroom wrap-mode plugin (absent ≡ off,
honest-degrade, no-install) with the proxy-mode graduation path designed but deferred.
