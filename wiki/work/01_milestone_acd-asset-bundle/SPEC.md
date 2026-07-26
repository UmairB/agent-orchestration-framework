---
type: milestone
number: 01
slug: acd-asset-bundle
title: "ACD Asset Bundle + work init/update"
status: done
owner: product-owner
created: 2026-06-16
updated: 2026-06-17
depends: [00]
schema: 1
aofVersion: 0.1.0
---
# 01 · ACD Asset Bundle + work init/update

## Objective

Self-host ACD in aof and ship it to others: bundle the ACD agents / commands / milestone templates as
aof assets, with `aof work init` rendering them into a repo's runtime (`.claude` / `.codex`) and a
manifest enabling drift-checked `aof work update` (how bugfixes reach users).

## Scope

In scope:
- The ACD agents (product-owner, researcher, architect, designer, developer, qa, security, compliance)
  + commands (refine/continue/verify/validate/feedback/retrospective/code-review/autonomous/shatter/…)
  + milestone templates, as aof resources.
- `aof work init` — render + stamp `aof-generated` + write a manifest.
- `aof work update` — manifest-diff re-render.

Out of scope: the planning layer (02); the board UI (03).

## Stories

Broken down into three independent stories that couple only through the **locked shared contract**
(install-manifest schema + `aof-generated` stamp) in [ARCHITECTURE.md](ARCHITECTURE.md) (ADR-004/005)
and Story 00's bundle — so `work-init` and `work-update` parallelise. See ARCHITECTURE.md for the ADRs
and fitness functions.

- [x] `00_story_acd-bundle-resources` — the 8 ACD agents + ACD commands + milestone templates as a built-in, content-addressed aof bundle the installed CLI can enumerate (the source of truth the other two consume)
- [x] `01_story_work-init` — `aof work init`: render the bundle into a repo's runtime(s), stamp each file `aof-generated`, write the `.aof/aof.work.lock.json` install manifest
- [x] `02_story_work-update` — `aof work update`: manifest-diff re-render — create/update/skip/drift/delete vs. the install manifest + on-disk hashes; never clobber user edits without `--force`

## Dependencies

- **00 · Work CLI** — the installed commands call `aof work find` / `validate` / `next`.
- **04 · Round-trip Proof** depends on this milestone (it `aof work init`s a fresh repo and runs a milestone through the bundled actors).
