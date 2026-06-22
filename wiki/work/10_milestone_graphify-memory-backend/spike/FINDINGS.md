# Spike findings — all-local-within-Claude prose extraction for the memory backend

> Pre-refine SPIKE for milestone 10 (graphify-memory-backend). Goal: prove or refute that
> graphify's Pass-3 prose LLM extraction can run entirely through the user's existing Claude
> auth (`claude -p`, no separate `ANTHROPIC_API_KEY`) with zero egress to `api.anthropic.com`.
> Runnable code lives beside this file (`claude-shim.mjs`, `fixture/`, `run.sh`); the real
> `graph.json` it produced is committed under `graphify-out/`. Env: Windows 11 Git Bash;
> `claude` 2.1.183, `uv` 0.9.26, graphify **0.8.44** (pinned). Throwaway, not the deliverable —
> de-risks the privacy posture before `aof:refine 10`.

## Verdict: WORKS — end-to-end, two independent ways, with zero egress.

Both a shim-fronted path AND a graphify-native built-in path drive the prose pass through
`claude -p` on the existing subscription. The shim path is the one the brief asked for; the
native path is a better discovery that may make the shim unnecessary for aof.

---

## F1 — `claude -p` runs headless on the existing session with NO API key. (premise: TRUE)

With `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` unset, `claude -p "..."` returns text, and
`claude -p "..." --output-format json` returns a single result object. Parse contract:

```
echo "<prompt>" | claude -p --output-format json
  -> { "result": "<model text>",
       "usage": { input_tokens, output_tokens, cache_read_input_tokens, ... },
       "modelUsage": { "<model id>": {...} },
       "stop_reason": "end_turn", ... }
```

`.modelUsage` reported `claude-opus-4-8[1m]` by default — it used my Claude Code session/OAuth,
not a provisioned key. `--no-session-persistence` and `--system-prompt <s>` both work in `-p`
mode. `total_cost_usd` is reported but is plan usage, not pay-as-you-go API spend.

## F2 — The shim contract graphify's `--backend claude` requires (2 lines).

graphify's claude backend (`llm.py` `_call_claude`, 0.8.44) uses the **anthropic Python SDK**:
`anthropic.Anthropic(base_url=$ANTHROPIC_BASE_URL).messages.create(...)`, which issues **POST
`<base_url>/v1/messages`** with body `{ model, max_tokens, system, messages:[{role:"user",
content:<str|block-list>}] }`. graphify reads back exactly `resp.content[0].text`,
`resp.usage.input_tokens/output_tokens`, `resp.stop_reason` (`llm.py:1023-1031`).

> **Shim must:** answer `POST /v1/messages` -> `{ id, type:"message", role:"assistant", model,
> content:[{type:"text", text:<claudeOutput>}], stop_reason:"end_turn", usage:{input_tokens,
> output_tokens} }`. Non-streaming is fine (graphify does not pass `stream:true` for extraction);
> forward `body.system` as `claude -p --system-prompt` and the joined user content as stdin; the
> `model` field is echoed back, value irrelevant.

`claude-shim.mjs` (Node, no deps) implements exactly this and logs every request. The end-to-end
run (`graphify extract ./fixture --backend claude` with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`,
`ANTHROPIC_API_KEY=dummy-local`) **SUCCEEDED**: graphify made ONE `POST /v1/messages` extraction
call (40,379 in / 2,328 out tokens), the shim shelled to `claude -p`, and graphify wrote a valid
5-node/5-edge graph. Evidence: `requests.log`, `last-extraction-prompt.txt`, `graphify-out/graph.json`.

## F3 — BLOCKER (resolved): the anthropic SDK is NOT in the base graphifyy package.

`uv tool install graphifyy` installs graphify + tree-sitter grammars but NO `anthropic` and NO
`openai` SDK (confirmed: `ModuleNotFoundError` in the tool venv). So `--backend claude` raises
`ImportError` until the extra is present. Fix that worked: **`uv tool install graphifyy --with
anthropic`** (pulls anthropic, httpx, pydantic, ...). For aof: the graphify provisioning lane
(milestone-12 `~/.aof/tools` store) must install `graphifyy[anthropic]` / `--with anthropic` IF
it drives the shim path — but F4 sidesteps this entirely.

## F4 — DISCOVERY: graphify 0.8.44 ships a native `claude-cli` backend — no shim, no SDK, no key, no base URL.

`BACKENDS["claude-cli"]` (`llm.py:154-166`) routes the prose pass through `claude -p --output-format
json --no-session-persistence --system-prompt <extractionPrompt>` ITSELF (`_call_claude_cli`,
`llm.py:1074-1183`), authenticating via the Pro/Max subscription. It is NOT auto-detected
(`detect_backend` excludes it, `llm.py:2084`), but is selectable explicitly and the key-gate exempts
it: `if not key and backend not in ("bedrock", "claude-cli")` (`llm.py:1341, 1863`). Run confirmed:

```
graphify extract ./fixture --backend claude-cli --out ./native-run   # NO env vars set
-> semantic extraction on 2 files via claude-cli... -> 11 nodes, 13 edges, est. cost $0.0000
```

`GRAPHIFY_CLAUDE_CLI_MODEL=haiku|sonnet|<id>` picks a cheaper model (default is the CLI's Opus).
graphify's CLI parser already handles `claude.cmd` on Windows (`llm.py:1095-1099`, issue #1072).
This is the cleanest all-local-within-Claude path and removes the entire shim + anthropic-extra
surface — the spike's shim remains valuable as the proof-of-contract for the generic
`ANTHROPIC_BASE_URL` route (e.g. a LiteLLM gateway) and as a fallback if a future graphify drops it.

## F5 — Prose extraction produced a genuinely useful graph. (usable graph? YES)

Over the 2 fixture `.md` files, the shim run yielded 5 nodes / 5 edges; the native run 11/13. The
LLM correctly broke each file into per-section entities — a `document` node per file PLUS a
`rationale` node per `## R1` / `## R2` / `## ADR-001` block (it even pulled `author` "dev" /
"architect" from the Owner meta line into the node). Edges are meaningful: `references` (EXTRACTED,
score 1.0) doc->entry, and `conceptually_related_to` (INFERRED, score 0.55-0.6) R1/R2->ADR-001 — it
inferred the lessons relate to the derived-index ADR. Communities cluster by file (retro=0, arch=1).
aof's frozen normalizer (`src/graphify.mjs` `normalizeGraph`) parsed the REAL `graph.json` cleanly:
5 nodes via the `links` key, `confidence`/`confidenceScore` preserved, no fabricated scores.

## F6 — Provenance is FILE-LEVEL only — `source_file`, `source_location: null`. (Q2; 10-RESEARCH C CONFIRMED on real data)

Every document/rationale node carries `source_file` = a bare filename (`"ARCHITECTURE.md"`,
`"RETROSPECTIVE.md"`) and `source_location: null` — across BOTH runs, ZERO nodes carried a non-null
line. The LLM-path node schema is `{ label, file_type, source_file, source_location(=null),
source_url, captured_at, author, contributor, id, community, norm_label }`. `source_location` EXISTS
in the shape but is only ever populated by the code AST path (`extract.py` sets `"L<n>"` from
`node.start_point`); for LLM doc nodes it is always `null`. A node knows it is "R1" but cannot tell
you the line R1 lives on.

> **Decisive for the architect:** confirms 10-RESEARCH C/F exactly. Option (b) "map graph nodes ->
> MemoryRecords" stays BLOCKED — the record `source` would degrade to `<file>:1` and fail
> 05/ADR-005's "resolves to a per-R-entry line" invariant. Option (a) (records from the 05 markdown
> parsers; the graph as a file-level relatedness/ranking signal joined by `source_file`) remains the
> only path that keeps `source:line` unconditionally safe. The graph is a ranking layer, never the
> record source.

(Also observed: top-level `graph.json` keys here are `nodes` / `links` / `hyperedges` /
`built_at_commit`, with `hyperedges` at TOP LEVEL — not under `graph.hyperedges` as 09-RESEARCH D
assumed. The normalizer reads `raw.graph.hyperedges`, so on THIS shape it found `hyperedges:[]` —
harmless when empty, but the hyperedge key location must be re-confirmed on a graph that actually
has hyperedges; see Open questions.)

## F7 — Cost / volume posture: one LLM call per CHUNK, not per file; egress is unavoidable.

graphify batches files into chunks (`--token-budget` default 60000; `--max-concurrency` default 4).
The 2 fixture files extracted in 1 chunk = 1 LLM call (~40k in / 2.3k out). So N markdown files ~=
ceil(total_tokens / token_budget) calls, NOT N calls — the real `wiki/work` tree is larger but
still bounded to a handful of chunked calls, parallelised 4-wide (claude-cli serialises to 1 unless
`GRAPHIFY_CLAUDE_CLI_PARALLEL=1`, since parallel `claude -p` sessions conflict). This is why the
brief said not to point it at the real tree — confirmed prudent. Critically (10-RESEARCH A
reconfirmed): building the prose graph IS an egress event — the full retrospective/ADR text is sent
to the model. All-local-within-Claude means the egress terminates at YOUR OWN Claude session/plan,
not a third-party API key — but the work-stream prose still leaves the process to the model. There
is no `egress:none` build that yields prose nodes (a keyless `--backend`-absent build does
AST-only, ~nothing on a `.md` corpus).

## F8 — No call reached `api.anthropic.com`. (locality proven three ways)

(1) `ANTHROPIC_API_KEY` was `dummy-local` and `ANTHROPIC_BASE_URL` was `http://127.0.0.1:8787` — a
real API call with a dummy key would 401; instead the shim returned 200 from `claude -p`. (2) The
shim's `requests.log` shows the extraction POST hitting `127.0.0.1`. (3) `grep -rl api.anthropic.com
graphify-out/` -> nothing. The native `claude-cli` run set NO Anthropic env at all and reported est.
cost $0.0000. Locality holds.

---

## Open questions for `aof:refine 10`

- **Native `claude-cli` vs the shim — which does aof adopt?** F4's built-in backend is strictly
  simpler (no shim process, no anthropic extra, no env wiring) and is the recommended primary. The
  shim (the generic `ANTHROPIC_BASE_URL` route) is worth documenting as the fallback/gateway path.
  aof's `graph:build` already threads `--backend <name>` (`src/graphify.mjs:113-122`); adding
  `claude-cli` as a backend value is a one-token change — but aof must then classify its egress as
  `docs-media` (the hop ran), same as `claude`/`ollama`.
- **Provisioning:** if the shim path is ever used, the graphify store install must be
  `graphifyy[anthropic]` (F3). The native path needs only the base package + an authed `claude` on
  PATH — confirm the milestone-12 store lane can express "also ensure `claude` is present" as a
  doctor check, not a provisioning step (it is the user's own CLI).
- **Hyperedge key location (F6):** this graph put `hyperedges` at top level and had none; 09-RESEARCH
  D / the normalizer expect `graph.hyperedges`. Build a graph that actually yields hyperedges and
  re-confirm where 0.8.44 writes them, or the normalizer may silently miss real hyperedges.
- **Determinism of node IDs:** the LLM assigns ids (`retrospective_r1`, `architecture_adr_001`) from
  a documented `{stem}_{entity}` rule; they came out stable and sensible — but model-produced, so a
  `source_file`-keyed join (option a) is safer than an `id`-keyed one across rebuilds.
- **Model choice:** default claude-cli model is Opus (overkill); `GRAPHIFY_CLAUDE_CLI_MODEL=haiku|
  sonnet` trades graph richness (5 vs 11 nodes here) for speed/plan-budget. The contract should
  expose this knob.
