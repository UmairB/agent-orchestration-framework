---
doc: retrospective
ref: "11"
---
# 11 · Graphify Codebase Intelligence — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never renumber.
Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE. This milestone
had **no blocker stops**: the build held ADR-002 (zero production code) and both review lenses returned
CONFORMS/PASS. The lessons below come from the verify-gate findings (F11-1, F11-2) and the STATE
`## Feedback (for retro)` notes (now archived). The git-ignore root-vs-in-dir "vacuity trap" that drove
story 00 + the `acd-codebase-graph-derived` arch-test is the same lesson as **10/R3** (pin the ROOT, not
the generator's in-dir file) — resolved cleanly here via the repo-root `.gitignore:4` entry and an
arch-test that asserts `check-ignore -v` resolves to root, so it earns a cross-ref, not a duplicate entry.

## R1 — A "no-op when the tool is ABSENT" fallback is narrower than the capability it guards: a present tool can still FAIL, and the degradation clause must cover both

- **Kind:** gap · **Area:** contract · **Stage:** verify · **Owner:** PO/architect · **Raised by:** verify `@manual` (finding F11-2)
- **What happened:** the grounding convention's safety clause is "silent no-op **when graphify is absent**" — it pattern-matches the `graphify-missing` structured miss (binary not on PATH) and tells the agent to proceed on grep-and-infer. But at the live verify a different failure surfaced: graphify is **present** yet a cold `aof graph build src` **fails** because aof's source root carries 33 docs (`src/bundle/**/*.md` prompts) that need semantic extraction → "no LLM API key found" (exit 1, no `graph.json`). The convention does not tell the agent to swallow *that* — only the absent-binary miss. (A code-only corpus cold-builds keylessly; it is the docs interaction that fails.)
- **Why:** the clause was scoped to the one failure mode in view at refine (binary absent), not to the capability ("a usable graph") it actually guards. A present-but-failing build is a distinct path that no story exercised cold (every build ran against a warm `graphify-out/` cache).
- **Lesson:** scope a degradation clause to "**the capability is unavailable for ANY reason** — absent OR build/query failed," not to a single named miss. And when a convention targets a path (`src`), account for the corpus shape there: a docs-bearing source root needs `--backend` for a cold build, so either default the grounding build to a code-only scope or pass a backend. Deferred as a backlog prompt-refinement (advisory-only means the practical outcome is still the designed no-op — the agent proceeds on grep-and-infer — so it did not block acceptance).
- **Refs:** VERIFICATION F11-2; `src/bundle/agents/aof-architect.md` `<codebase-graph-grounding>` step 5; `src/bundle/commands/refine.md` step 2; `src/bundle/commands/code-review.md` step 3.

## R2 — A command that wraps a subprocess must check the subprocess's exit status before reading its expected output — reading the output file blind turns a real, guidance-bearing error into an opaque ENOENT

- **Kind:** bug · **Area:** architecture · **Stage:** verify · **Owner:** developer · **Raised by:** verify `@manual` (finding F11-1)
- **What happened:** `runGraphifyBuild` returns the spawn `status` (`src/graphify.mjs:142`), but `graph:build` never reads it — `src/commands/graph-build.mjs:119` goes straight to `normalizeGraph(readGraph(built.graphPath))`. So when graphify exits non-zero and writes no `graph.json` (R1's cold-docs case), the command throws a raw `ENOENT: … graph.json` instead of surfacing graphify's actual cause ("no LLM API key found … pass `--backend`"). The binary-*absent* path is guarded with a clear hint (`graphify-missing`, 424); the binary-*present-but-failing* path is not.
- **Why:** the build command treated the spawn as infallible-if-the-binary-exists — the only failure it modelled was "binary missing," handled before the spawn. A non-zero exit from a present binary fell through to the unconditional output-read.
- **Lesson:** gate the output-read on the subprocess exit status; on non-zero, surface the tool's own stderr/guidance (a structured error), never let the missing-output read stand in for the real cause. This is the 09 `graph:build`'s defect, surfaced by 11's "build src first" convention; deferred as a milestone-09 fast-follow (outside 11's zero-production-code scope).
- **Refs:** VERIFICATION F11-1; `src/graphify.mjs:135-144`; `src/commands/graph-build.mjs:107-119`.

## R3 — graphify's `graph:query` is similarity-seeded, not call-graph-precise: a consuming agent must phrase around concrete symbols + the seam, and treat the answer as advisory

- **Kind:** answer-quality · **Area:** architecture · **Stage:** build→verify · **Owner:** architect · **Raised by:** architect (build dogfood) / re-confirmed at verify
- **What happened:** the grounding mechanism delivers legible coupling output (confirmed live — the architect cited the `COMMANDS registry` hub, community membership, and explicit `--calls`/`--references` edges, and the single-spawn-site invariant held). But the BFS is **similarity-seeded**: terse/over-broad phrasings ("command-core invoke getCommand callers") collapse to one node or seed onto wiki RESEARCH/STORY doc nodes; the architect needed ~5 phrasings, landing only when it phrased around concrete symbols + the spawn seam ("which functions spawn the graphify binary", "what imports `src/graphify.mjs`").
- **Why:** graphify scores relevance by semantic similarity across the whole corpus (code + docs), not by literal call/import edges — so a doc node near the query text can out-seed the actual call site.
- **Lesson:** a consuming agent grounds best by querying around **concrete symbols and the specific seam**, not the verb/concept name, and by treating a fuzzy answer as one advisory input among others. The convention's advisory-only + no-op/grep-fallback posture is exactly the right hedge for this (and is CI-pinned by `acd-codebase-grounding-advisory`) — the wiring is correct; the relevance is a graphify trait, not an aof defect.
- **Refs:** STATE §Feedback (architect, graphify answer-quality note); VERIFICATION §Verification evidence (01/00 live review, 5 phrasings); `acd-codebase-grounding-advisory`.

## R4 — Verify a wrapped tool against its actual arg-mapping (and corpus shape) at refine — the developer-feasibility seat is what catches a contract that would otherwise lie

- **Kind:** near-miss · **Area:** contract · **Stage:** refine · **Owner:** developer · **Raised by:** developer-feasibility (Three Amigos)
- **What happened:** the original story-02 QA Examples assumed `aof graph triage --pr N` returned a ranked queue. The developer-feasibility pass read `src/graphify.mjs:180-187` and caught that the triage verbs are **mutually exclusive**: plain `aof graph triage` → `prs --triage` (the ranked queue), while `--pr N` → `prs N` (a single-PR drill-down, suppressing `--triage`). The Examples were corrected at refine before build — had it shipped, the contract would have lied about behaviour. (R1's cold-docs corpus shape is the same family of catch: the build target's *contents* — code vs docs — change the tool's behaviour, and only reading the tool's reality surfaces it.)
- **Why:** a contract drafted from the verb/flag name rather than the wrapper's actual arg-mapping (and the corpus the path points at) encodes an assumption the tool does not honour.
- **Lesson:** at refine, verify a wrapped tool's behaviour at the source — its arg-mapping and the shape of the data the path targets — not the verb name. The developer-feasibility seat in Three Amigos is the seat that does this; it earned its place twice this milestone (the `--pr N` arg-mapping; and, in hindsight, the docs-vs-code corpus shape that R1/F11-2 surfaced only at verify).
- **Refs:** STATE §Feedback (developer + QA process lessons); `src/graphify.mjs:180-187`; story-02 `00_code-review-triage-grounding.feature` Examples.
