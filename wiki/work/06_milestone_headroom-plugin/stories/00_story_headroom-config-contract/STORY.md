---
type: story
number: 00
slug: headroom-config-contract
title: "Headroom config contract — work.headroom schema + the honest-degrade resolver"
parent: 06
status: done
owner: product-owner
created: 2026-06-20
updated: 2026-06-20
schema: 1
aofVersion: 0.1.0
---
# 00 · Headroom config contract — `work.headroom` schema + the honest-degrade resolver

## User story

As a developer wiring headroom into the work-board terminal (and as the two sibling stories that build the toggle surface and the wrap routing),
I want one frozen `work.headroom` config shape and one pure `resolveHeadroomLaunch` function that decides — from config + a PATH probe — whether a session is wrapped and how,
so that the opt-in surface and the runtime seam both build against a single, validatable contract instead of scattering the off / gemini / degrade logic across the CLI and the terminal server.

<!-- This is the SPINE the milestone exists to make safe: it freezes the two contracts (the config
     block, the resolver signature) that the other two stories couple through. It owns no CLI and no
     terminal wiring — only the schema change and the pure decision function. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 06/00`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] `tasks/00_config-schema-shape.feature` — a `work.headroom` block `{enabled, mode:"wrap", providers}` validates; an absent block validates; `mode:"proxy"`, any other `mode`, an unknown key, or `gemini` in `providers` fails validation (ADR-001/002)
- [x] `tasks/01_resolve-launch-passthrough.feature` — `resolveHeadroomLaunch` returns the raw `{bin, args}` unchanged when the plugin is absent/`disabled`, when the provider is `gemini` (never routable) or not in the configured subset, and when `headroom` is not on PATH (degrade) (ADR-003 branches 1–3)
- [x] `tasks/02_resolve-launch-wrap.feature` — enabled + routable + `headroom` on PATH returns `{ bin: <headroom path>, args: ["wrap", <provider>, ...rawArgs], wrapped: true }` (ADR-003 branch 4)

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the
`$defs/work` → `headroom` schema change in [schemas/aof.schema.json](../../../../../schemas/aof.schema.json)
(ADR-001/002) and the pure resolver `resolveHeadroomLaunch` in `src/headroom.mjs` (ADR-003). No CLI
subcommand, no `terminal-ws` wiring.

**Independent because** it produces the two frozen contracts the other stories consume (the
`work.headroom` shape, ADR-001; the resolver signature, ADR-003) and consumes none of theirs. The
resolver is **pure** — its `headroom`-on-PATH lookup is the injected `which` (the same idiom
`terminal-providers.mjs` uses), so every decision-table branch is a unit test with a stubbed `which`
and no PTY. The schema change is its own deliverable, not implicit.

**Feasibility (developer amigo seat):** Buildable as written — no flags. I read the real seam. The
schema change is a one-object addition under `$defs/work` peer to `work.ui` (which already carries
`additionalProperties:false`), with `mode:{enum:["wrap"]}`, `providers:{type:"array",items:{enum:["claude","codex"]}}`,
`enabled:{type:"boolean"}`. I confirmed against the actual Ajv-2020 validator the schema tests use:
`mode:"proxy"` reports at `instancePath:"/work/headroom/mode"` keyword `enum`; an unknown key (`port`)
reports at the PARENT `instancePath:"/work/headroom"` keyword `additionalProperties` with
`params.additionalProperty:"port"`; and `providers:["gemini"]` reports at `"/work/headroom/providers/0"`
keyword `enum` — so rejecting gemini REQUIRES constraining the array items (`items:{enum:[…]}`), not
just typing the array. The `.feature` steps ("cites the work.headroom.mode enum / providers items enum /
additionalProperties keyword") are satisfiable exactly against these shapes. The resolver is a pure
function over the frozen decision table in `src/headroom.mjs`, mirroring `terminal-providers.mjs`'s
injectable-`which` idiom — every branch is a unit case with a stubbed `which`, no PTY. Confirmed live:
`acd-headroom-config-schema` is RED on the reject cases (the `$def` is missing) and `acd-headroom-honest-degrade`
is RED on a missing `src/headroom.mjs` — exactly the RED-until-built signal this story turns green.
