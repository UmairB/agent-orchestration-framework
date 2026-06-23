---
type: story
number: 02
slug: board-face
title: "The board face — /api/work* reduced to route → invoke → projection, envelope byte-for-byte, zero operation logic"
parent: 08
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
---
# 02 · The board face — a thin HTTP → command → result face over the core

## User story

As the work board UI (whose `/api/work` envelope was frozen at milestone 03),
I want every `/api/work*` route reduced to a thin `HTTP → invoke → board-projection` adapter, with all bespoke operation logic and the direct `work.mjs` / `feature-parse.mjs` imports removed,
so that the board returns **byte-for-byte what it does today** while carrying **zero** operation logic of its own — it only invokes registered commands, proving the contract end-to-end on a real surface.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 08/02`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [routes-byte-for-byte](tasks/00_routes-byte-for-byte.feature)** — each `/api/work*` route → invoke → board-projection (projectRoot-rel + slashed); the milestone-03 success envelopes byte-for-byte (the committed board-api net is the oracle).
- [x] **01 · [error-envelope-and-status](tasks/01_error-envelope-and-status.feature)** — the `{ok:false,error,code}` envelope, status mapping (400/404/413), unknown-route 404, empty/malformed-JSON 400 — all preserved through the migration.
- [x] **02 · [resolver-distinction-preserved](tasks/02_resolver-distinction-preserved.feature)** — read (slug-fallback) vs feedback-write (exact-only) preserved *because the resolver moved into the command*; a non-exact ref reads but never writes.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003**). This story **owns**
[board-ui.mjs](../../../../../src/board-ui.mjs): each `/api/work*` route becomes
route → `invoke(id, input, { workspace })` → **board projection** (relativise-to-`projectRoot` +
forward-slash + compact JSON, ADR-002). It **strips** the direct `loadWorkspace, listStream, findWork,
validateWork, nextWork` import (`board-ui.mjs:16`), the `parseFeature` import (`:17`), and ALL bespoke
logic (`handleDoc` / `handleTasks` / `handleFeedback` / `appendFeedbackBullet` — moved to commands in
story 00). The error envelope `{ ok:false, error, code }`, the status-code mapping, the unknown-route 404,
and the **read (`resolveItem`, slug-fallback) vs feedback-write (`resolveItemExact`, exact-only)** resolver
distinction are preserved by routing through the commands (the resolver moved *into* the command, so the
face cannot weaken it). It does **not** touch `cli.mjs`.

**Independent because** it consumes ONLY the frozen registry contract (story 00) and produces nothing 01 /
03 consume — its bytes are milestone-03's frozen wire. Its byte-for-byte target is **milestone-03's board
envelope**, held by the existing [test/board-api.test.mjs](../../../../../test/board-api.test.mjs) +
`test/arch/acd-board-write-isolation.test.mjs` staying green — disjoint from the CLI's bytes (story 01).

**Feasibility (developer amigo seat — confirmed at Contract):** `handleWorkApi` keeps its routing shell;
only the per-route bodies change to `invoke` + project. The milestone-03 board tests are a **free
regression net** proving the re-home is observably inert — if a byte moves, they go red.
