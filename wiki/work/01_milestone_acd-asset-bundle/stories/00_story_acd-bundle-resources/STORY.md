---
type: story
number: 00
slug: acd-bundle-resources
title: "The ACD bundle as shipped aof resources"
parent: 1
status: done
owner: product-owner
created: 2026-06-17
updated: 2026-06-17
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The ACD bundle as shipped aof resources

## User story

As an aof maintainer,
I want the ACD agents, commands, and milestone templates declared as a single built-in, content-addressed bundle that the installed CLI can enumerate,
so that there is one shippable, versioned source of truth for ACD — replacing the loose, gitignored, unmanaged `.claude/` actors — that `work init`/`update` can render into any repo.

<!-- This is the source-of-truth story the other two consume. It wires NO commands. It produces:
     the bundle root (migrated from the loose runtime), the descriptor that declares membership,
     the content-addressed bundle manifest, and the loader that resolves + reads the bundle from
     the CLI module path. See ARCHITECTURE.md ADR-001, ADR-002, ADR-006. -->

## Tasks

- [x] `tasks/00_bundle-source-tree.feature` — the full ACD actor set (8 agents, 14 commands, the milestone/story/task/uat templates) lives in one git-tracked, shippable bundle root; legacy `gsd-*` and unmanaged files are not members
- [x] `tasks/01_bundle-descriptor.feature` — a declarative descriptor declares every member with an id and kind (agent/command/template), agents and commands carrying capability-consistent target runtimes
- [x] `tasks/02_bundle-loader.feature` — the installed CLI loads the same descriptor-faithful member set from any working directory and the loaded bundle renders its members to runtime files
- [x] `tasks/03_bundle-manifest.feature` — the bundle ships a content-addressed manifest listing one `{path, runtime, resource, sha256 hash}` entry per rendered member plus a `bundleVersion`, deterministic across regeneration

## Notes

Inherits all ADRs from the milestone `ARCHITECTURE.md`. This story owns the bundle artifacts and the
loader only; it must not depend on `work init`/`update`. The membership set, the manifest hash
soundness, and cwd-independent location are guarded by fitness functions
(`acd-bundle-membership`, `acd-bundle-manifest-hashes`, `acd-bundle-location`).
