---
doc: retrospective
---
<!--
  Milestone RETROSPECTIVE.md — distilled, carryable lessons from HOW execution went.
  One R<n> per lesson; append-only (never renumber). Reference refs, never restate them.
  Triaged from STATE ## Feedback notes + VERIFICATION Findings + blocker stops at aof:verify 41.
-->
# 41 · Work-item insertion & re-index — Retrospective

## R1 — Define the acceptance bar against what the tool ENFORCES, not the SPEC's prose list
- **Kind:** near-miss · **Area:** framing/contract · **Stage:** refine (caught by architect) · **Owner:** product-owner (SPEC) · **Raised by:** you + aof-architect
- **What happened:** the SPEC + STATE listed "milestone→story checklists" and "ROADMAP.md rows" as machine references the re-index must keep validate-green. But `validateWork` enforces **neither**: it checks folder↔frontmatter (number/type/slug), `parent` resolves to a milestone, and `depends` resolves to a driver + acyclic — it never parses the `## Stories` checklist and never reads ROADMAP.md (prose, not a number-keyed index; its only cross-ref tooling shipped dormant, 15/R5). ADR-003 resolved this by **tiering** the correctness surface: Tier 1 validate-green (guaranteed), Tier 2 `## Stories` bullets (best-effort), Tier 3 prose + ROADMAP (not touched).
- **Why:** the SPEC's prose broadened the correctness surface beyond what the acceptance tool actually validates, which would have set an unmeetable/unmeasured bar.
- **Lesson:** when a milestone's acceptance bar is "keep `aof work validate` green", scope the change to exactly what `validateWork` parses — enumerate the enforced surfaces before writing the SPEC, and tier anything the tool doesn't read as best-effort/out-of-scope rather than implying it's guaranteed.
- **Carry:** none — folded into ADR-003; the tiering held through build and verify.
- **Refs:** STATE ## Feedback (machine-reference overstatement); ARCHITECTURE ADR-003; `src/work.mjs` `validateWork`.

## R2 — The bundle-marker framework bug keeps birthing validate-broken record docs — root-fix it
- **Kind:** near-miss (recurring) · **Area:** framework/scaffolding · **Stage:** refine (hit here) + verify (recurred in m38) · **Owner:** scaffolder / `parseFrontmatter` · **Raised by:** aof-architect + aof:verify 41
- **What happened:** the bundled record-doc templates (`.aof/templates/work/*/{SPEC,STORY,…}.md`) ship a leading `<!-- aof-generated: bundle -->` comment as line 1. `parseFrontmatter` (src/work.mjs) anchors on `^---` with **no `/m` flag**, so any record doc whose first line is that comment parses to `{}` → `validate` reports "missing or empty record doc" and `work find` shows null status/title. m41's freshly-bundled SPEC/STATE + all three scaffolded STORY.md were **born validate-broken** and had to be hand-stripped at refine. It then **recurred during this very verify run**: whole-stream `aof work validate` flagged `38/03_.../STORY.md`, an untracked doc still carrying the marker (VERIFICATION environmental note).
- **Why:** the marker is emitted into the doc body but the parser can't see past it; every fresh bundle re-introduces the trap, so it recurs milestone after milestone (ironic given m41 is itself about keeping validate green).
- **Lesson:** a scaffolder that writes a marker the validator can't tolerate is a latent born-broken-doc factory — the fix belongs at the framework, not per-milestone hand-stripping. Either the scaffolder strips the leading marker before writing a record doc, **or** `parseFrontmatter` tolerates a leading HTML comment (add `/m` / skip leading comment lines before the `^---` anchor).
- **Carry:** a **`chore`** to root-fix — pick one of the two fixes above and add a regression (a doc with a leading bundle comment parses to real frontmatter). Also sweep existing born-broken docs (m38/03 STORY.md is one open instance) — out of m41's scope, flagged for the m38 owner.
- **Refs:** STATE ## Feedback (bundle-marker); VERIFICATION ## Environmental note; `src/work.mjs` `parseFrontmatter`; `.aof/templates/work/**/*.md`; `.gitattributes` (m41 pinned `.aof/templates/**/*.md` for CRLF, a related Windows hazard).

## R3 — Registering a new `work:*` command trips THREE registry-derived guards, not one — name all three up front
- **Kind:** near-miss · **Area:** contract/architecture · **Stage:** build (story 02) · **Owner:** architect (ADR) + product-owner (brief) · **Raised by:** aof-developer
- **What happened:** ADR-002 and the story brief cited only `acd-work-command-cli-bijection` ("covered by the existing guard"). But landing a new `work:*` id in `COMMANDS` fires **two more**: (1) `command-core-contract`'s `WORK_IDS` — a hand-maintained exact-membership list ("no more, no fewer") every prior work-command milestone (15/19/20) has had to extend; (2) `acd-work-command-route-coverage` — the BOARD `/api/work/<op>` route bijection, demanding either a served board route or an explicit `BOARD_DEFERRED` carve-out. Both were satisfied here (WORK_IDS extended; `insert-milestone`/`insert-uat` added to `BOARD_DEFERRED` with a documented CLI-only-scope rationale), suite stayed green — but the brief under-named the surface.
- **Why:** the "one guard" framing counted only the CLI bijection; the registry is guarded from three independent angles that all key off `COMMANDS` membership.
- **Lesson:** a story that adds a `work:*` command should expect the **trio** — CLI bijection, `WORK_IDS` exact-membership, and BOARD route coverage (served or `BOARD_DEFERRED`) — and name all three in the ADR/brief so the work is scoped honestly, not discovered at build.
- **Carry:** none — all three extended and green; carry is the naming convention for the next `work:*` command story.
- **Refs:** STATE ## Feedback (registry trio); ARCHITECTURE ADR-002; `test/command-core-contract.test.mjs` (`WORK_IDS`), `test/arch/acd-work-command-route-coverage.test.mjs`, `test/arch/acd-work-command-cli-bijection.test.mjs`.

## R4 — A shared placeholder token that means different things on different frontmatter keys can't be served by one blanket-replace
- **Kind:** near-miss · **Area:** scaffolding/templates · **Stage:** build (story 03) · **Owner:** developer · **Raised by:** aof-developer
- **What happened:** `.aof/templates/work/story/STORY.md` overloads the generic `NN` token with **two meanings** on adjacent lines — `number: NN` / `# NN ·` mean the story's own number, but `parent: NN  # the milestone's number` means the OWNING milestone's number (a different value on a nested insert). Story 02's shared `renderTemplate` (a blanket `out.replace(/\bNN\b/g, number)`) is correct for milestone/uat templates (no such second meaning) but would silently write the WRONG value into a scaffolded story's `parent:`. Fixed by **not** reusing it: `renderStoryTemplate` (src/commands/insert-shared.mjs) resolves the whole `parent:` line first (surgical), then runs the blanket `NN` substitution for the story's own identity. Confirmed clean via a live CLI smoke test.
- **Why:** a blanket token-replace assumes one token = one value; the story template violates that by reusing `NN` for two distinct frontmatter semantics.
- **Lesson:** before reusing a sibling's render helper, audit each template's placeholder **semantics** per frontmatter key — a token that means different things on different keys is a trap the same blanket-replace cannot safely serve twice; resolve the divergent key whole-line first, then blanket-substitute the rest.
- **Carry:** none — `renderStoryTemplate` isolates the nested axis; no shared-helper reuse hazard remains for stories.
- **Refs:** STATE ## Feedback (NN overload); `src/commands/insert-shared.mjs` (`renderStoryTemplate` vs `renderTemplate`); `.aof/templates/work/story/STORY.md`.

<!--
  Two deferred product findings (VERIFICATION F-4101 pad-width non-uniformity across a 2→3 digit
  boundary; F-4102 inline-only depends rewrite vs block-list) are edge-case backlog items, not process
  lessons — tabled in VERIFICATION, not carried as R-entries.
-->
