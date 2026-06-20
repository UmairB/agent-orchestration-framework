---
doc: verification
ref: "02"
verified: 2026-06-19
verdict: accepted
---
# 02 · Planning Init (the bought seam) — Verification

Verification lanes in scope: **`@executable`**, **`@manual`**, **`@uat`**. **ACCEPTED — 2026-06-19
(re-verify after the F3 fix).** All three prior blockers are resolved: **F1 (SSH clone)** and **F2
(sha-not-a-clonable-ref)** were cleared earlier (the live `aof planning init --runtime claude` registers
the marketplace over HTTPS at the clonable tag `#v2.0.0` and installs the planner), and the third
blocker **F3 (real-template read-out)** is now **RESOLVED**: `readSeam` was hardened to the real
create-prd 8-section template (ADR-010) and re-verified live at this pass — over the genuine captured
create-prd PRD it yields objective + **5 milestone chunks** (one per key feature) + **2-in / 1-out
scope** (was objective-only), with **no regression** on the two prior fixtures. The `@uat` live
round-trip's faithful sign-off (PO, prior pass) stands; with F3 closed the seam's read-out now
mechanically carries scope + milestones from the real producer (not just the PO reading prose). The
human gate was brokered inline at this verify and the PO **accepted on the F3-closed evidence**. Every
`@executable` + `@manual` + `@uat` lane is green and no blocker finding is open → **all three stories
`done`, milestone `done`.**

## Verification evidence

- **`@executable` suite — green (re-run 2026-06-19).** `node ./scripts/test.mjs` → 387 ok / 0 not-ok
  (exit 0); `node ./scripts/test-unit.mjs` → 408 ok / 0 not-ok (exit 0). The two planning modules
  `test/planning-init.test.mjs` and `test/planning-prd.test.mjs` are inside both suites and pass.
  verifies → story 00 `tasks/00–05` `@executable` lanes; story 01 `tasks/00_discover-prd.feature` +
  the `@executable` read-out scenarios in `tasks/01_seam-readout-and-origin.feature`; story 02
  `tasks/00–01` `@executable` lanes.
- **Fitness functions — green (re-run 2026-06-19), the networked clone-smoke RAN (not skipped).**
  `node --test` over the 8 milestone-touching arch tests → `# tests 8 / # pass 8 / # fail 0 /
  # skipped 0`: `acd-planning-install-commands`, `acd-planning-provenance-sha`,
  `acd-planning-lock-isolation`, `acd-planning-no-codex-install`, **`acd-planning-clonable-ref`**
  (the clone-smoke — 0 skipped means it actually resolved the emitted `#v2.0.0` upstream, not a
  loud-skip), `acd-unified-lock-sections`, `acd-install-manifest-contract`, `acd-no-clobber-without-force`.
  Independently confirmed live: `git ls-remote …/pm-skills.git refs/tags/v2.0.0` → `5042ff61…6a6de`.
  verifies → the structural invariants in ARCHITECTURE.md `## Fitness functions` (ADR-002/004/008/009).
- **`@manual` — F1+F2 live install (story 00 tasks 04 + 05, agent-run, live) — PASS.** The marketplace
  is registered in the real `~/.claude/plugins/known_marketplaces.json` as
  `{ source: git, url: https://github.com/phuryn/pm-skills.git, ref: v2.0.0 }` (HTTPS + clonable tag —
  F1's SSH form and F2's bare-sha form are both gone; no `Permission denied`, no
  `not found in upstream origin`). All 3 recommended plugins are enabled in `settings.json`
  (`pm-execution@pm-skills`, `pm-product-discovery@pm-skills`, `pm-product-strategy@pm-skills` = true;
  `pm-ai-shipping` correctly NOT installed), and pm-skills is cloned into the marketplace cache.
  A fresh live `aof planning init --runtime claude` in an isolated temp dir ran end-to-end (exit 0):
  idempotent marketplace re-add (`✓ already on disk`), 3 plugins confirmed, sha resolved live to
  `5042ff61…6a6de`, provenance written to the **`planning` section of `.aof/aof.lock.json`** (no
  separate `aof.planning.lock.json`).
  verifies → `stories/00_story_planning-init/tasks/04_https-marketplace-source.feature` (`@manual` HTTPS
  transport) + `tasks/05_clonable-marketplace-ref.feature` (`@manual` live marketplace add + plugins).
- **`@manual` — unified lock holds all states (story 02 tasks 00 + 01, agent-run, live) — PASS.** Into
  one isolated temp repo, run live in sequence: `aof planning init --runtime claude` (writes the
  `planning` section) → `aof work init` (preserves `planning`, adds `work`) → `aof assets apply`
  (preserves both). Then a populated asset domain was seeded and a real `aof work update` run: the lock
  ended with all three domains intact — asset (`version: 2`, `files[0] = CLAUDE.md`), `planning`
  (`sha: 5042ff61…`), `work` (34 files) — with exactly ONE `.aof/aof.lock.json` throughout (no
  `aof.planning.lock.json`, no `aof.work.lock.json`). Every writer preserved the sections it does not own.
  verifies → the `@manual` "one lock holds all states" scenarios in
  `stories/02_story_unify-project-lock/tasks/00_planning-provenance-section.feature` +
  `tasks/01_work-manifest-section.feature`.
- **`@manual` — shatter seam read-out + origin over the FIXTURE (story 01, agent-run) — PASS.**
  `discoverPrd`/`readSeam` over the checked-in `PRD-acme-notify.md` fixture: discovery auto-found the
  single `PRD-*.md`; the read-out yielded objective + 3-in/3-out scope + 3 milestone chunks; origin
  stamping holds.
  verifies → the three `@manual` scenarios in
  `stories/01_story_shatter-consumes-prd/tasks/01_seam-readout-and-origin.feature`.
- **`@manual` — F3 read-out over the REAL create-prd template (story 01 task 03, agent-run, re-verify
  2026-06-19) — PASS.** `readSeam` over the genuine captured create-prd output
  (`fixtures/PRD-oncall-compass.real-create-prd.md`, pm-skills v2.0.0 commit `5042ff61…`) now returns
  **objective ✓ / scope `{ in: 2, out: 1 }` / milestones `[5]`** — one chunk per key feature (schedule
  model, rotation engine, notifications & escalation, calendar sync, web UI), in-scope from the
  first-version/fast-follow Release leads, out-of-scope from the "later" lead — derived without any
  literal `## Scope` / `## Milestones` heading (ADR-010's additive Release / Key-Features fallbacks).
  Re-confirmed **no regression**: the two prior fixtures (`PRD-acme-notify.md`, `write-prd-output.md`)
  still read objective + 3 milestones + 3-in/3-out as before. This was objective-only at the prior verify
  — F3 is closed.
  verifies → the `@executable` + `@manual` scenarios in
  `stories/01_story_shatter-consumes-prd/tasks/03_real-template-readout.feature`.

## User sign-off

- **`@uat` live create-prd → shatter round-trip — SIGNED OFF (faithful framing), PASS.** The
  prerequisite (the bought planner installed) is now green, so the round-trip ran live in a scratch
  workspace: the installed pm-execution `create-prd` skill (pm-skills v2.0.0) authored a well-formed
  `PRD-oncall-compass.md` at the workspace root; `discoverPrd` auto-found it **with no path argument**;
  the PRD was shattered into **5 framed, `origin`-stamped milestone SPECs** (Schedule & Rotation Model →
  Automatic Rotation Engine → Notifications & Escalation / Calendar Sync → Web UI) with a valid acyclic
  `depends` graph (`aof work validate` → PASS). The product-owner judged the milestone boundaries +
  `depends` edges **faithful to the initiative and signed off** the acceptance judgment.
  **Caveat at the prior pass (now cleared):** the faithful framing had been produced by the PO reading
  the PRD prose, because `readSeam`'s structured read-out came back with empty scope + milestones on the
  real producer's output — Finding F3. **F3 is now RESOLVED** (read-out re-verified above), so the seam's
  pinned read-out genuinely carries the producer's structure; the sign-off no longer rests on prose alone.
  verifies → `stories/01_story_shatter-consumes-prd/tasks/02_live-roundtrip.feature`; UAT.md
  `## Live / environmental checks` (live round-trip) + `## Acceptance judgment`.   By: product-owner
  (brokered inline at aof:verify)   Date: 2026-06-19
- **`@uat` acceptance re-confirmed at the F3 re-verify — ACCEPTED.** With F3 closed (the read-out now
  carries objective + 5 milestone chunks + 2-in/1-out scope from genuine create-prd output) and every
  automated + agent-run lane green, the human gate was re-brokered inline and the PO **accepted milestone
  02 on the F3-closed evidence** — electing not to require a fresh live create-prd run, since the prior
  faithful sign-off stands and the fix is proven against real producer output.   By: product-owner
  (brokered inline at aof:verify)   Date: 2026-06-19

## Findings

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| F1 | `aof planning init --runtime claude` cloned the `owner/repo` shorthand over **SSH** → `Permission denied (publickey)` for HTTPS-only GitHub auth. | bug | blocker | fixed under ADR-007 (emit HTTPS `.git#<ref>` URL). | `aof:continue 02`, task `04_https-marketplace-source.feature`. | **resolved** — re-verified live 2026-06-19: marketplace registered over HTTPS, no SSH denial. |
| F2 | The HTTPS fix still failed for everyone: `claude plugin marketplace add …git#<40-hex-sha>` → `Remote branch <sha> not found in upstream origin`. `marketplace add` is `git clone --branch <ref>`, which resolves only a branch/tag name, not a bare commit sha. | bug | blocker | fixed under ADR-008 (pin the immutable tag `#v2.0.0`; record the resolved 40-hex commit as the audit anchor) + new clone-smoke fitness function. | `aof:continue 02`, task `05_clonable-marketplace-ref.feature`. | **resolved** — re-verified live 2026-06-19: marketplace registered at `…git#v2.0.0`, 3 plugins installed, provenance sha `5042ff61…`; the networked clone-smoke runs green. |
| F3 | The `@uat` live round-trip ran (F1/F2 cleared). The installed pm-execution `create-prd` skill authored a well-formed PRD and `discoverPrd` auto-found it, BUT `readSeam` over that real PRD returned **objective ✓ / scope `{in:[],out:[]}` / milestones `[]`**. Root cause: the real create-prd skill emits the **8-section template** (Summary / Contacts / Background / Objective / Market Segment(s) / Value Proposition(s) / Solution / Release) — there is **no `## Scope` and no `## Milestones` heading**, which is exactly what `extractScope`/`extractMilestones` title-match on. Both story-01 fixtures (`PRD-acme-notify.md`, `write-prd-output.md`) were hand-shaped WITH those headings, so the `@manual` read-out lane was green against a PRD shape the bought planner never produces. Same blind-spot class as F1/F2, one layer out: a fixture shaped to pass, masking the real producer — caught only by the live `@uat`. The seam still produced faithful SPECs (the PO read the prose), but the milestone's headline ("`aof:shatter` consumes the resulting `PRD-*.md` — objective/scope/milestone-chunks") is only half-true against the real planner. Genuine create-prd output captured at `stories/01_story_shatter-consumes-prd/fixtures/PRD-oncall-compass.real-create-prd.md`. | bug | **blocker** | **blocker** (PO, inline, 2026-06-19) — the bought seam is the milestone's reason for existing; a read-out that only carries the objective from the real producer does not prove it. | `aof:continue 02` via new `@bug @finding-F3` task `stories/01_story_shatter-consumes-prd/tasks/03_real-template-readout.feature`. **Fix direction:** harden `readSeam` to the real 8-section template (derive milestone chunks from `Solution → 7.2 Key Features` corroborated by `Release`; derive in/out scope from Solution + `7.4 Assumptions`/`Release` without requiring a literal `## Scope` heading; keep the existing fixture + `/write-prd` inline shapes working), replace/augment the fixtures with the captured genuine create-prd output as a first-class `test/planning-prd.test.mjs` case, and (architect) correct ADR-005's "representative create-prd-shaped fixture" claim + RESEARCH §7 (record the create-prd skill's actual section structure). | **resolved** — re-verified 2026-06-19: `readSeam` hardened to the real 8-section template (ADR-010); over the genuine create-prd fixture it now yields objective + 5 milestone chunks + 2-in/1-out scope (was objective-only), no regression on the two prior fixtures; suites green (full 523/0, unit 544/0). |
| F4 | Two orphaned atomic-write temp files (`.aof/.tmp-aof.lock.json-…`, dated 2026-05-16/22, old pre-ACD `gsd` lock shape) linger in the real repo's gitignored `.aof/`. Unrelated to milestone 02 (predate it). | housekeeping | non-blocker | **defer** — delete the orphans; optionally have the atomic lock writer clean its temp on a failed rename. Not in milestone 02's scope. | backlog (housekeeping). | open (deferred) |

## Validate gate

`aof:validate 02` → **PASS**. CLI `aof work validate 02` exits 0 (folder↔frontmatter, closed tag
vocabulary, depends graph) — full-stream `aof work validate` also PASS. Agent layer: every `@executable`
scenario is backed by a green test module; `@manual`/`@uat` rows carry `verifies →` pointers; litmus
clean (no UI surface; the `.feature` files keep visual fidelity out of scope). With validate PASS **and
no blocker finding open**, the acceptance gate is cleared.

## Accept decision

**Accepted — 2026-06-19 (re-verify after the F3 fix).** All three blockers are resolved: **F1** (SSH
transport) and **F2** (sha-not-clonable) were cleared at earlier passes (live install works end-to-end),
and **F3** (the real-template read-out gap) is now closed — `readSeam` hardened to the create-prd
8-section template (ADR-010) and re-verified live: over the genuine producer fixture it yields objective
+ 5 milestone chunks + 2-in/1-out scope (was objective-only), with no regression on the two prior
fixtures. Every `@executable` + `@manual` + `@uat` lane is green; suites green (full 523/0, unit 544/0);
8/8 fitness functions pass with **0 skipped** (the networked clone-smoke ran). The `@uat` faithful
sign-off stands and the PO **accepted on the F3-closed evidence** (human gate brokered inline). Per the
gate (accept when validate passes **and** no blocker finding is open), all three stories are marked
`done` and **milestone 02 is `done`**. The one non-blocker (F4: orphaned pre-ACD `.aof/.tmp-…lock`
temp files) stays deferred to backlog. `STATE.md` is compacted and `RETROSPECTIVE.md` is written at this
close (the lessons graduate); the `## Feedback (for retro)` section is archived into the retrospective.
