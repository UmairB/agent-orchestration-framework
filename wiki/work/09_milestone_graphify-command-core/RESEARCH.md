<!-- aof-generated: bundle -->

---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (ARCHITECTURE.md).
-->
# 09 · Graphify Command Core — Research

**Gathered:** 2026-06-21
**Method:** graphify upstream docs (`github.com/safishamsi/graphify` README + `docs/how-it-works.md`), the project site `graphify.net`, PyPI (`graphifyy`), DeepWiki (`deepwiki.com/safishamsi/graphify`), and upstream issues #277 / #514 / #756. No live binary was installed — every "exact subcommand" claim below is desk research and is flagged where docs conflict.
**Status:** Items pending live confirmation — the advertised CLI surface drifts from the installed binary across versions (see Finding A); verbs/version-check must be pinned live against a fixed version.

## A. CLI surface — skill slash-form vs. installed subcommand binary (CRITICAL)

- **Finding:** graphify has **two distinct surfaces** that do NOT match. (1) The *skill* slash-form documented everywhere as `/graphify ./raw`, `/graphify ./raw --obsidian`, `/graphify path A B`, `/graphify explain X`. (2) The *installed PyPI binary* (`graphifyy`) is **subcommand-only**: there is "no positional full-pipeline mode" — `graphify ./raw` returns `error: unknown command './raw'`. Real subcommands reported include `extract`, `query`, `path`, `explain`, `add`, `watch`, `update`, `cluster-only`, `prs`, `export`, `hook`, `merge-graphs`, `install`. But which subcommands/flags actually exist is **version-dependent**: issue #277 reports `path`/`explain`/`add` and `--update`/`--watch`/`--cluster-only` as documented-but-missing in some builds; issue #514 reports `--obsidian`/`--obsidian-dir` as not routed through the shell parser (export functions exist but aren't wired to the CLI).
- **Constraint:** aof's command core must bind to the **installed subcommand binary**, never the slash-form, and must **not** trust the README's verb list. The exact verb set (especially the build verb — likely `graphify extract <path>`, not confirmed) must be derived live from `graphify --help` against a **pinned graphify version** and re-verified on upgrade. Treat the verb mapping as version-gated, not static.
- **Source:** README/site command lists (graphify.net/graphify-cli-commands.html); issues https://github.com/safishamsi/graphify/issues/277 , https://github.com/safishamsi/graphify/issues/514

## B. Build / query / triage verbs (best-known, desk-level)

- **Finding:** Best-known installed-binary invocations: **build** — headless `graphify extract ./docs --backend <claude|gemini|...>` (also `--token-budget N`, `--max-workers N`, `--update` for changed-files-only, `--directed`, `--cluster-only`, `--no-viz`); **query** — `graphify query "<question>"` with `--dfs`/`--bfs` and `--budget N`; **path** — `graphify path "NodeA" "NodeB"`; **explain** — `graphify explain "Node"`; **PR triage** — `graphify prs` (dashboard), `graphify prs 42` (one PR), `graphify prs --triage` (AI-ranked review queue, "auto-detects backend"), `graphify prs --conflicts` (PRs sharing graph communities).
- **Constraint:** Each becomes one aof command verb. `extract` requires an LLM backend + API key for docs/media (network egress) — see Finding F; the aof command contract must thread the backend/key through and surface it. `prs --triage`/`prs --conflicts` are flag-selected modes of one `prs` verb, so the aof verb design must model them as a verb with mode flags, not separate top-level ops.
- **Source:** graphify.net/graphify-cli-commands.html; README command examples.

## C. Output is human/markdown — graph.json is the only stable machine contract

- **Finding:** There is **no documented `--json` flag** for `query`/`path`/`explain`/`prs`; their stdout is human-readable markdown/text. The only machine-readable artifact is **`graph.json`**. (Query *logging* is JSONL to `~/.cache/graphify-queries.log`, but that is a log, not a result contract.)
- **Constraint:** The aof↔graphify driver **cannot rely on parsing query stdout** for a stable result shape. The command result contract must be **derived from `graph.json`** (and, for `prs`, from the MCP tools' structured returns — Finding E — or by re-deriving from the graph), with the driver normalizing markdown stdout only as a human-facing secondary field. No stable JSON for live queries → result shape is graph-derived.
- **Source:** DeepWiki CLI reference ("only graph.json is machine-readable"); README (query log JSONL note).

## D. Output artifacts + graph.json schema (NetworkX node-link)

- **Finding:** Artifacts land in **`graphify-out/`**: `graph.json` (full queryable graph, relative paths, portable), `graph.html` (interactive viz), `GRAPH_REPORT.md` (highlights/god-nodes/suggested questions), plus `cost.json`, `cache/`, `converted/`, `<project>-callflow.html`. **`graph.json` uses NetworkX `node_link_data` format**: top-level arrays **`nodes`** and **`links`** (links remapped from edges for compatibility). **Node** fields: `id` (stable id), `label` (human name), `file_type` (`code`/`document`/`paper`/`image`/`rationale`), `source_file`, plus `community`, `norm_label` (search), and community-name (added in 0.8.40). **Edge/link** fields: `source`, `target` (node ids), `relation` (verb phrase: `calls`/`imports`/`implements`/`semantically_similar_to`), `confidence` (`EXTRACTED`/`INFERRED`/`AMBIGUOUS`), `confidence_score` (float, INFERRED only), `source_file`. Hyperedges (3+ nodes) live separately under `G.graph["hyperedges"]`, not in `links`.
- **Constraint:** The driver normalizer must read **`nodes`/`links`** (NetworkX key name `links`, NOT `edges`), key edges by `source`/`target`/`relation`, and preserve `confidence`/`confidence_score` so downstream consumers can filter inferred/ambiguous edges. It must separately handle `graph.hyperedges` (n-ary, not pairwise) — flattening them into `links` would corrupt the graph. `id` is the stable join key. Exact key spelling (`links` vs `edges`) is **load-bearing** and should be asserted in a contract test against a real `graph.json`.
- **Source:** docs/how-it-works.md; DeepWiki "Neo4j, GraphML & JSON Export" (https://deepwiki.com/safishamsi/graphify/3.4-neo4j-graphml-and-json-export).

## E. AST extraction — local/offline, 36 tree-sitter grammars

- **Finding:** Code is parsed **locally via tree-sitter AST — no API calls, fully offline**. ~36 built-in grammars: Python, TS/JS/JSX/TSX, Go, Rust, Java, C, C++, Ruby, C#, Kotlin, Scala, PHP, Swift, Lua, Zig, PowerShell, Elixir, Objective-C/C++, Julia, Vue, Svelte, Astro, Groovy, Gradle, Dart, Verilog/SystemVerilog, SQL, Fortran, Pascal, plus extras (`[dm]` DreamMaker, `[terraform]` HCL, Apex regex-based). Video/audio transcription is also local (`faster-whisper`).
- **Constraint:** The code-graph path imposes **no network egress and no backend key** — aof can run it in a sandboxed/offline lane. Only the *docs/media* extraction path needs a backend (Finding F). Grammars ship with the package, so no separate grammar provisioning step is required.
- **Source:** README "Supported languages / How it works"; graphify.net.

## F. Privacy boundary — code local, docs/media to a configured LLM

- **Finding:** Privacy split is explicit: **code (AST) and audio/video stay local**; **docs, PDFs, images are sent to a configured LLM** for semantic extraction. Backend is selected by `--backend` + an env API key: `ANTHROPIC_API_KEY`+`--backend claude`, `GEMINI_API_KEY`+`gemini`, `OPENAI_API_KEY`+`openai`, `MOONSHOT_API_KEY`+`kimi`, `DEEPSEEK_API_KEY`+`deepseek`, `OLLAMA_BASE_URL`+`ollama` (local), bedrock via IAM. Custom OpenAI/Anthropic-compatible base URLs supported (`OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL`). Stated "no telemetry, no usage tracking, no analytics." Query log to `~/.cache/graphify-queries.log` (disable via `GRAPHIFY_QUERY_LOG_DISABLE=1`).
- **Constraint:** aof must **surface and respect** this boundary and never widen it: the egress is exactly the docs/media→backend hop, configured via env. aof should expose backend choice + key as command inputs, must not silently default to a network backend (offline `ollama` exists), and should mention the local query log + its disable flag. The code path stays offline by construction.
- **Source:** README "Privacy"; graphify.net.

## G. Install / provisioning — Python tool, NOT npx

- **Finding:** PyPI package is **`graphifyy` (double-y)** — "temporarily named while the `graphify` name is being reclaimed"; the **CLI command is `graphify` (single-y)**. Latest desk-checked version **0.8.44** (2026-06-19); `requires-python >=3.10`. Install one-liners: `uv tool install graphifyy` (recommended, manages PATH), `pipx install graphifyy`, or `pip install graphifyy` (may need PATH setup). Extras: `graphifyy[pdf]`, `[video]`, `[all]`, `[anthropic]`, `[postgres]`, `[mcp]`, `[dm]`, `[terraform]`. Post-install: `graphify install [--platform claude|codex|cursor|...]` registers the skill. Tree-sitter grammars ship in the package; `faster-whisper` for media.
- **Constraint:** aof's installer (`src/frameworks.mjs`) is **npx-only — hardcodes `["npx", packageName, ...]`** (file `C:\Source\umair\aof\src\frameworks.mjs:66`, `installFramework`/`planFrameworkInstall`). graphify cannot be provisioned by that path. A graphify command core needs a **separate Python provisioning lane** (uv/pipx/pip) — the architect must decide whether to extend the framework installer with a non-npx provider or add a dedicated graphify installer. Also note **name asymmetry**: install spec = `graphifyy`, invoked binary = `graphify` — any doctor/lock entry must store both.
- **Source:** PyPI https://pypi.org/project/graphifyy/ ; README install section; `C:\Source\umair\aof\src\frameworks.mjs:63-67`.

## H. Distribution as skill + MCP server

- **Finding:** **Skill:** `graphify install` writes markdown skill files — `~/.claude/skills/graphify/SKILL.md` (user) or `.claude/skills/graphify/SKILL.md` (`--project`), and `.cursor/rules/graphify.mdc` (`alwaysApply: true`). The skill instructs the agent to run slash-form `/graphify ...` (the surface that diverges from the binary — Finding A). **MCP server:** launched as `python -m graphify.serve graphify-out/graph.json` (stdio default) or `--transport http --port 8080` (Starlette/Uvicorn, optional `--api-key`); needs the `[mcp]` extra. Example `.mcp.json`: `{"mcpServers":{"graphify":{"type":"stdio","command":".venv/bin/python3","args":["-m","graphify.serve","graphify-out/graph.json"]}}}`. **Exposed MCP tools (9, from serve.py reference):** `query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`, `list_prs`, `get_pr_impact`. (`triage_prs` appears in some README text but is **not** in the registered-tools table — unconfirmed.)
- **Constraint:** aof's *rendered faces* (skill + MCP) must call **`aof graph <verb>`**, never graphify's slash-form or graphify's own MCP — i.e. aof re-fronts these 9 capabilities through its own command core. The MCP server is **graph.json-bound** (you pass the graph path at launch), reinforcing that the graph must be built first and that the result contract is graph-derived (Finding C/D). Note the **upstream MCP read tools map cleanly to query/get/path/stats verbs but PR *triage* is NOT exposed as an MCP tool** — so the `prs --triage` aof verb must drive the CLI, not the MCP server.
- **Source:** README/site skill+MCP sections; DeepWiki MCP server (serve.py) reference (https://deepwiki.com/safishamsi/graphify/4.2-mcp-server-(serve.py)).

## I. Working-directory semantics (CRITICAL for the driver)

- **Finding:** `query`/`path`/`explain` **hardcode `graphify-out/graph.json` relative to the current working directory** and **ignore the `GRAPHIFY_OUT` env var** (issue #756: `GRAPHIFY_OUT=".graphify" graphify query ...` → `graph file not found: <cwd>/graphify-out/graph.json`). No path argument is accepted to point at an arbitrary graph.
- **Constraint:** The aof driver must **`cwd` into the project root that contains `graphify-out/`** before invoking query-family verbs (or build under `<cwd>/graphify-out/`); it cannot redirect the output dir via env. This couples the driver to a fixed on-disk layout per project. The MCP server is the only surface that takes an explicit graph path (Finding H). Confirm this is still hardcoded in the pinned version (PR #758 may change it).
- **Source:** issue https://github.com/safishamsi/graphify/issues/756 (+ PR #758).

## Assumptions to confirm

<!-- CI-testable assumptions vs. live-only / @manual (developer/doctor-run) ones. -->

- **A1 — graph.json is NetworkX node-link with top-level `nodes`/`links` and the node/edge fields in Finding D.** Confirm by asserting against a committed real `graph.json` fixture. **Testable in CI: yes (`@executable`)** — fixture-driven contract test on the normalizer.
- **A2 — The driver normalizer handles `graph.hyperedges` separately from `links`.** Confirm with a fixture containing a hyperedge. **Testable in CI: yes (`@executable`)** — fixture contract test.
- **A3 — The installed binary's real verb set for the pinned version (build verb is `extract`; `query`/`path`/`explain`/`prs --triage` all exist).** Docs drift from the binary (issues #277/#514). Confirm via `graphify --help` against the pinned version. **Testable in CI: no — live-only `@manual` / `project doctor`** (requires the installed Python binary).
- **A4 — A version/health check exists for `project doctor`.** Docs do not confirm `graphify --version` output (a `.graphify_version` file is mentioned). Confirm the exact command + exit behavior live. **Testable in CI: no — live-only `@manual` / doctor-confirmable.**
- **A5 — query/path/explain still hardcode `<cwd>/graphify-out/graph.json` (ignore `GRAPHIFY_OUT`) in the pinned version.** PR #758 may have changed it. Confirm live. **Testable in CI: no — live-only `@manual`** (drives the driver's cwd strategy).
- **A6 — The MCP server registers exactly the 9 tools in Finding H and `triage_prs` is NOT among them.** Confirm via the pinned `graphify.serve` (`tools/list`). **Testable in CI: no — live-only `@manual`** (needs the `[mcp]` extra running).
- **A7 — Provisioning lane: `uv tool install graphifyy` yields a `graphify` binary on PATH; `requires-python >=3.10` is satisfied.** Confirm on the target install host. **Testable in CI: no — live-only `@manual`** (environment-dependent; aof's npx-only installer cannot do this — Finding G).
- **A8 — Privacy: the code/AST path makes zero network calls; only `extract` of docs/media egresses to the configured backend.** Confirm by running `extract` on a code-only folder offline. **Testable in CI: partial** — can assert in an offline sandbox that a code-only build succeeds with no backend key (`@manual`/sandboxed).
