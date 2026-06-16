---
type: milestone
number: 01
slug: acd-asset-bundle
title: "ACD Asset Bundle + work init/update"
status: not-started
owner: product-owner
created: 2026-06-16
updated: 2026-06-16
depends: [00]
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

<!-- to be broken down — `aof:refine 01` -->

## Dependencies

- **00 · Work CLI** — the installed commands call `aof work find` / `validate` / `next`.
