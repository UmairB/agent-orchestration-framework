---
type: story
number: 06
slug: explicit-repo-publish
title: "Explicit repo publish — `aof mesh repo publish` adds this repo to the machine-wide mesh store on demand and records it as a mesh repo (ADR-010)"
parent: 34
status: done
owner: product-owner
created: 2026-07-08
updated: 2026-07-08
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Added 2026-07-08 on operator order ("we obviously need a command for handling this"): until now a repo
  only entered the global store as a SIDE EFFECT of a work-mutating command, so a repo with no recent
  activity was invisible in `aof mesh ui` with no verb to add it. See ARCHITECTURE ADR-010.
-->
# 06 · Explicit repo publish — one command to make a repo mesh-visible

## User story

As an operator with several repos on my control machine, I want a command — **`aof mesh repo publish`** — that
**publishes the repo I am in into the machine-wide mesh store right now** and **records, in that repo's own
config, that it is a mesh repo**, so I can add a project to the fleet view without having to first run a
work-lifecycle command in it, and so the repo's future work keeps propagating automatically.

<!-- The direct remediation of the "is there a command for publishing a repo?" gap. ADR-010: a CLI-only
     nested `repo publish` verb (sibling of `aof mesh ui`), writing a local `mesh.repo.published` marker
     (read-merge-write, other keys preserved) and publishing through the ONE ADR-004 publisher seam; the
     marker is also a propagation-enable arm so future work auto-propagates. -->

## Tasks

- [x] `tasks/00_repo-publish.feature` — `@executable` — `aof mesh repo publish` writes a per-repo
  `mesh.repo.published` marker into the local `.aof/aof.config.json` (preserving every other key) AND lands a
  snapshot for the repo in the machine-wide global store, opting the repo in with no prior `mesh join`/enable;
  re-publishing is idempotent (refreshes `publishedAt`); the shared propagation predicate treats
  `mesh.repo.published === true` as enabled so future work mutations in the repo auto-propagate. Unknown verb /
  unknown flag / stray positional are clean single-envelope face errors.
