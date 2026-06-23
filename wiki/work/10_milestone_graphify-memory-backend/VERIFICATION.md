---
doc: verification
ref: "10"
verified: 2026-06-22
verdict: "the one @manual lane verified live — `aof work memory reindex` under `memory.backend = graphify` rebuilt the derived records AND drove a REAL work-stream `graphify-out/graph.json` (275 nodes / 549 edges) through `invoke('graph:build')` with `--backend claude-cli` and NO `ANTHROPIC_API_KEY` set (the credential-local / billed-to-plan proof; graphify reported `est. cost (~claude-cli): $0.0000`). Records-half + selection/recall lanes are @executable (green in the suite); this gate covers ONLY the live graph-build half that cannot run in CI."
---
# 10 · Graphify Memory Backend — Verification

This milestone's acceptance lanes are mostly **`@executable`** (the backend module + the records-from-05-parsers
contract + selection/recall/scope) and the **fitness functions** (story 03 / ADR-006 — `acd-graphify-*`).
Those run green in `node ./scripts/test.mjs` / `node ./scripts/check.mjs` and are not re-evidenced here.

What this document records is the **one `@manual` scenario** the suite cannot automate: the live
work-stream graph build. It needs the provisioned graphify binary AND a logged-in extraction backend
(`claude-cli`), and it sends `wiki/work/**` to Anthropic for extraction — a real egress — so it is
deferred to `aof:verify` and run once, by hand, with the user's authorization. There are **zero `@uat`**
scenarios (a technical/derived-index milestone, no human-judgement surface) and **no `DESIGN.md`** (no
visual surface), so neither the human-acceptance step nor the design-conformance lens applies.

Environment for the live lane: `uv` tool dir `C:\Users\Umair\AppData\Roaming\uv\tools`; graphify
**0.8.44** resolves on PATH (installed earlier via `uv tool install graphifyy`); `claude` **2.1.183
(Claude Code)** present; Node **v22.22.2**; **`ANTHROPIC_API_KEY` UNSET throughout** (intended — graphify's
`--backend claude-cli` shells the logged-in `claude -p`, billed to the plan, no key). The repo's default
memory backend stays `none`; `memory.backend = graphify` was enabled **temporarily** for this run (config
backed up and **restored byte-for-byte** afterwards — see Cleanup).

## Verification evidence

- **`@manual` — reindex builds a real work-stream graph through the `graph:build` command — PASS.**

  **Procedure (from the repo root):**
  1. Confirmed preconditions: `graphify --version` → `graphify 0.8.44`; `claude --version` → `2.1.183
     (Claude Code)`; `ANTHROPIC_API_KEY` unset (asserted before the run, did not proceed otherwise).
  2. Probed that graphify 0.8.44 accepts `--backend claude-cli` (it is functional but **not advertised**
     in `graphify --help`, which lists only `gemini|kimi|claude|openai|deepseek|ollama`): a 1-file temp
     fixture built in 18s, graphify reporting `semantic extraction on 1 files via claude-cli` and
     `est. cost (~claude-cli): $0.0000` with no key — i.e. the credential-local lane is live (probe dir
     removed afterwards).
  3. Backed up `.aof/aof.config.json` (sha256 `4dfc9a17…aecfb5`), added `"memory": { "backend": "graphify" }`,
     and confirmed selection: `aof work memory status` → `memory: backend=graphify records=0`.
  4. Ran `node bin/aof.mjs work memory reindex --json` over `wiki/work` (123 `.md`, ~1.2 MB ≈ 300K tokens).
     This rebuilds the graphify record store AND calls `invoke("graph:build", { path: <workDir>,
     backend: "claude-cli" }, …)` → `graphify extract <workDir> --out <projectRoot> --backend claude-cli`.

  **Result — exit 0; wall-clock 1610 s (~26.8 min).** The reindex `--json` summary:
  `{ backend:"graphify", recordCount:120, store:"…\.aof\aof.memory.graphify.index.json", version:1,
  graph:{ built:true, backend:"claude-cli", graphPath:"…\graphify-out\graph.json", egress:"docs-media" } }`.
  - **(a) exits 0** — confirmed (`EXIT=0`).
  - **(b) `<projectRoot>/graphify-out/graph.json` exists and is a real NetworkX node-link graph** —
    302,626 bytes; top-level keys `directed, multigraph, graph, nodes, links, hyperedges, built_at_commit`;
    **275 nodes / 549 edges** (`links`, not `edges`); 0 hyperedges; `built_at_commit f5b3e96…`. Node/edge
    `source_file`s point into the work stream (e.g. `wiki/work/05_milestone_work-memory/…`), so it is a
    graph **over `wiki/work`**, driven through `graph:build` (not a direct spawn — the backend imports
    neither `src/graphify.mjs` nor `child_process`; the structural invariant is the story-03 arch-test).
  - **(c) the graphify record store was (re)built** — `.aof/aof.memory.graphify.index.json`,
    `backend:"graphify"`, `version:1`, **120 MemoryRecords** (51 lessons + 69 ADRs), each with a resolving
    `source` (`<path>:<line>`, e.g. `00_milestone_work-cli/ARCHITECTURE.md:11`). Built from the 05 parsers,
    alongside the graph (the records half is the `@executable` contract; green in the suite).
  - **(d) extraction ran via `claude-cli` with NO `ANTHROPIC_API_KEY`** — the run asserted the key unset
    before proceeding and the probe showed graphify reporting `via claude-cli` / `~claude-cli: $0.0000`.
    This is the credential-local proof: the work-stream egress went through the logged-in `claude -p`
    session, keyless and billed-to-plan. `egress:"docs-media"` in the BuildResult honestly records that a
    doc/media extraction hop ran (the privacy-honest label, ADR-005), as expected for a `--backend` build.
  - **Calls / boundary:** one `graph:build` invocation; graphify chunked `wiki/work` to its 60K-token/chunk
    budget and made a bounded number of `claude -p` extraction calls under that one build (the spawn ran to
    completion; chunk-by-chunk progress is collected into the BuildResult `stdout`, not streamed). The full
    `wiki/work` build was run (the scenario), not a toy fixture.
  - **`graphify-out/` is git-ignored (derived, disposable).** The build's `ensureGraphifyOutGitignore`
    wrote `graphify-out/.gitignore` (`*` + `!.gitignore`); `git check-ignore graphify-out/graph.json` → hit,
    and `git add -n graphify-out/` would stage **only** `.gitignore`. `graph.json`, `.graphify_analysis.json`,
    and `cache/` are all ignored. The artifact is left on disk as evidence.

  verifies → [stories/00_story_graphify-backend-module/tasks/01_reindex-rebuilds-records-and-graph.feature](stories/00_story_graphify-backend-module/tasks/01_reindex-rebuilds-records-and-graph.feature)
  `@manual` "reindex builds a real work-stream graph through the graph:build command".

## Findings

- **F-01 — the graphify record store was not git-ignored by name.** *Observed:* `.aof/.gitignore` ignored
  `aof.memory.index.json` (the local store) but NOT `aof.memory.graphify.index.json`, so the graphify
  store surfaced as `?? .aof/aof.memory.graphify.index.json` — a derived store that could be committed as
  an authoritative second copy. *Type:* derived-index-invariant gap (10/ADR-005). *Severity:* blocker
  (story 00 owns the git-ignore discipline for BOTH derived artifacts — the graph AND the store; the
  story-03 `acd-graphify-derived-index` fitness would have gone red on it). *Triage (PO):* fix in place,
  no new `@bug` task needed — a one-line baseline addition. *Routed to / status:* **FIXED 2026-06-22** —
  added `aof.memory.graphify.index.json` to `AOF_GITIGNORE_ENTRIES` (`src/aof-gitignore.mjs`, the
  single-owner `.aof/.gitignore` baseline), mirroring the local store. Full suite re-run **1013 ok / 0
  fail**; `git check-ignore .aof/aof.memory.graphify.index.json` now hits. *verifies →* the ADR-005
  git-ignore discipline (story 00) and pre-greens the story-03 `acd-graphify-derived-index` store check.

## Observations (non-blocking — recorded, deferred)

- **`--backend claude-cli` is undocumented in graphify 0.8.44's `--help`** (functional, but not listed
  alongside `gemini|kimi|claude|openai|deepseek|ollama`). It works as the credential-local default, but a
  graphify version bump should re-confirm the value is still accepted (it is the contract's extraction
  backend — `GRAPHIFY_EXTRACTION_BACKEND` in `src/memory/graphify-backend.mjs`).
- **Wall-clock.** ~27 min for the full `wiki/work` build over `claude-cli` (the keyless lane is slower than
  an API-key backend, and the work stream is non-trivial). Acceptable for an at-verify manual lane; not a
  hot-path the agent flow blocks on (reindex is an explicit operator action).
