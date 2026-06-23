---
type: story
number: 01
slug: cli-face
title: "The CLI face — work doc/tasks/feedback added, list/validate/next rewired through the registry"
parent: 08
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
---
# 01 · The CLI face — a thin argv → command → result face over the core

## User story

As a developer (and any agent) driving aof from the terminal,
I want `aof work doc` / `work tasks` / `work feedback` as first-class subcommands, and `work list` / `validate` / `next` rewired to invoke the command registry — each a thin `argv → command → result → render`/`--json`,
so that every operation the board exposes is also runnable from the CLI (the command→CLI bijection), and the CLI is a thin face over the one core rather than a second, independent call site.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 08/01`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [new-read-subcommands](tasks/00_new-read-subcommands.feature)** — `aof work doc <ref> <DOC>` + `aof work tasks <ref>`, each argv→command→result→render/`--json`; absent-not-error, `invalid-doc`/`ref-not-found` rejections.
- [x] **01 · [feedback-subcommand](tasks/01_feedback-subcommand.feature)** — `aof work feedback <ref> --note … [--actor] [--refs]`: inherits the command's exact-only resolver (a non-exact ref fails, never writes the wrong item); default actor "you".
- [x] **02 · [rewire-byte-for-byte](tasks/02_rewire-byte-for-byte.feature)** — `work list`/`validate`/`next` rewired through the registry, output byte-for-byte unchanged (cwd-relative paths, validate's bare-array `--json`, pretty 2-space) — the committed CLI contracts stay green.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003**). This story **owns** the
`workCommand` dispatch in [cli.mjs](../../../../../src/cli.mjs) (~line 189): three NEW subcommands
`work doc` / `work tasks` / `work feedback` (each `argv → command → result`), and the **rewire** of
`work list` / `work validate` / `work next` to invoke the registry — their existing `--json` and human
renders become the command's **CLI face adapter** (cwd-relative paths, `validate`'s bare-array `--json`,
pretty 2-space), per ADR-002's CLI path-projection. It does **not** touch `board-ui.mjs`.

**Independent because** it consumes ONLY the frozen registry contract (story 00) and produces CLI
subcommands no sibling consumes. Its byte-for-byte target is **today's CLI output**, held by the existing
CLI `--json` tests (e.g. `acd-work-list-contract`) staying green — disjoint from the board's bytes
(story 02), so the two faces share zero code and have separate regression nets.

**Feasibility (developer amigo seat — confirmed at Contract):** the rewire is mechanical — the renderers
already exist (`workListCommand` / `workValidateCommand` / `workNextCommand`); they become the command's
CLI adapter. The three new subcommands map argv → the same `input` the board maps from query/body, so they
reuse the command bodies story 00 froze. `work feedback` resolves **exact-only** (the command's resolver,
ADR-003) — a partial/typo'd ref must fail, never write to the wrong item.
