---
type: story
number: 02
slug: extraction-posture-and-fallback
title: "Extraction posture + graceful fallback — claude-cli default, honest egress, binary-absent degrade"
parent: 10
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
# 02 · Extraction posture + graceful fallback — opt-in, never silently networked, never crashing

## User story

As the operator turning graphify memory on,
I want the graph's extraction backend to **default to `claude-cli`** (my existing Claude subscription — no metered key, no third-party key, no shim) — surfaced with its **honest egress label**, classified correctly in `graph:build`, and the backend **degrading gracefully to un-graph-ranked 05 recall when the graphify binary is absent** rather than crashing,
so that enabling graph-grounded memory is a clear, **opt-in**, **never-silently-networked**, **never-crashing** act — and an operator can always tell whether recall is graph-grounded or has quietly fallen back to keyword ranking.

<!-- This story owns the PRIVACY/PROVISIONING posture + the resilience: the claude-cli default + its
     classification, and the binary-absent fallback across the four verbs. It owns no module shape
     (story 00), no re-ranker math (story 01), and no arch-tests (story 03). -->

## Tasks

<!-- Contract authored `2026-06-22` via Three Amigos (`aof:refine 10/02`): PO intent + aof-qa
     Examples/tagging. Classifier rows are pure-function @executable; degrade rows stub
     resolveGraphifyBinary {found:false} (09 idiom); the live keyless row is @manual (already evidenced
     in VERIFICATION.md by story 00's live run — referenced, not re-run). -->

- [x] **00 · [claude-cli-classified-and-surfaced](tasks/00_claude-cli-classified-and-surfaced.feature)** — `isNetworkBackend("claude-cli")` true + `classifyEgress("claude-cli")` "docs-media" (billed-to-plan ≠ on-box; the hop ran); `ollama` the only local backend (still docs-media); `status` surfaces the chosen extraction backend — never a silent network default. _@executable green (9, +1 @manual ref to VERIFICATION.md)._
- [x] **01 · [binary-absent-degrades-gracefully](tasks/01_binary-absent-degrades-gracefully.feature)** — binary absent: `recall`/`brief` return un-graph-ranked 05 recall + a visible diagnostic; `reindex` rebuilds records + skips the graph with the install hint; `status` reports the graph state; no verb throws. _@executable green (8)._

**Build + review (2026-06-22, `aof:continue 10/02`):** `claude-cli` classified by knowledge (added to `NETWORK_BACKENDS` + exported `isKnownNetworkBackend`) in `graph-build.mjs`; visible binary-absent degrade across the verbs in `graphify-backend.mjs` (`recall` carries a non-enumerable `graphSignal` + a text-view suffix so the frozen `RecallResult` byte-shape stays intact; `status` reports an enumerable `graphState` via the injectable `ctx.resolveGraphifyBinary` seam — surfaced in `status --json`; `reindex` skip carries `binaryAbsent`/`hint`/`reason`). **17 `@executable` green; full suite 1043 ok / 0 fail; 09 + 10/00 + 10/01 + 05 confirmed still green.** Review: **architect PASS** (all 5 checks — the non-enumerable diagnostic judged sound: degrade visible via the text view + `status`'s enumerable graph-state, the ADR-004-correct surface). **Done.**

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** the `claude-cli` default +
surfacing + the `graph-build.mjs` classification; **ADR-004** the binary-absent degrade). This story
**owns**: teaching [src/commands/graph-build.mjs](../../../../../src/commands/graph-build.mjs) the
`claude-cli` value (`isNetworkBackend("claude-cli") === true`, `classifyEgress("claude-cli") ===
"docs-media"` — the hop ran; billed-to-plan ≠ on-box; `ollama` stays the only data-resident option, still
`egress:"docs-media"`); the `claude-cli` extraction default, **surfaced** in the `BuildResult` and in
`status`/doctor (never a silent network default — `09/ADR-005` + PRD privacy); and the binary-absent
fallback across `recall`/`brief`/`reindex`/`status` (degrade to un-graph-ranked recall over the 05 records
via the reused 05 `rankRecords`, with a visible diagnostic — `recall`/`brief` stay live, `reindex` rebuilds
records + skips the graph, `status` reports the graph state + the `09/ADR-004` install hint), never throwing.

**The honest egress caveat this story surfaces (ADR-003):** `claude-cli` is **credential-local** (no
metered key; billed to the plan) but **NOT data-local — the prose is still sent to Anthropic for
inference**. `ollama` is the only fully on-box alternative, at a quality cost. aof states this plainly and
does not pretend `claude-cli` is on-box.

**Independent because** the classification is a pure-function change to `graph-build.mjs`; the fallback
REUSES the shipped 05 `rankRecords` and the 09 structured `resolveGraphifyBinary` miss; it consumes story
00's module surface and story 01's re-ranker only through their frozen signatures (it stubs the binary
absent and asserts the degrade — it never needs the live build).
