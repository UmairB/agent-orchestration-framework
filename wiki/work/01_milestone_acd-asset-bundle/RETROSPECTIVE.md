---
doc: retrospective
ref: "01"
---
# 01 · ACD Asset Bundle + work init/update — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never
renumber. Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE.
This milestone had **no blocker stops** and **no VERIFICATION findings**; the lessons below come from
the Story-00 build flags and the Review-gate craft findings recorded in STATE `## Feedback (for retro)`.

## R1 — "Requiring-grep" fitness tests penalise the correct refactor

- **Kind:** near-miss · **Area:** architecture · **Stage:** build→verify · **Owner:** architect · **Raised by:** architect (Review gate)
- **What happened:** `acd-capability-delegation` asserted the *token* `CAPABILITIES` literally appears
  in `work-init.mjs`. That forced a byte-identical duplicate of the synthesis/partition logic into
  `work-init.mjs` instead of importing the shared module, and bred a dead `CAPABILITY_SOURCE` export
  in `work-update.mjs`.
- **Why:** a "delegates to X" invariant was encoded as symbol-presence in one named file — coupling the
  test to an incidental implementation detail rather than the behaviour.
- **Lesson:** enforce "delegates to X" by following the call graph or behaviourally, never by asserting
  a symbol appears in a named file. *Forbidding*-greps (assert a pattern is **absent**) are safe;
  *requiring*-greps are the smell. Fixed at the gate: synthesis consolidated into
  `src/work-bundle-synthesis.mjs`, both arch-tests redesigned to assert behaviourally.
- **Refs:** ADR-003/ADR-006; fitness functions `acd-capability-delegation`, `acd-reuses-render-plan`.

## R2 — Content-addressed artifacts must pin line endings or cross-platform CI hashes diverge

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** developer (Story 00)
- **What happened:** the bundle manifest hashes rendered member bytes, which include migrated `.md`
  bodies. Without an EOL pin, git `autocrlf` checks the bundle out with platform-specific endings, so
  `acd-bundle-manifest-hashes` would pass on Windows and fail on Linux CI (or vice-versa).
- **Why:** content addressing is byte-exact; an unpinned working-tree EOL policy makes "the same file"
  hash differently per platform.
- **Lesson:** any content-addressed/shipped artifact must pin its bytes (`text eol=lf` in
  `.gitattributes`) and be normalised before hashes are generated. Added `src/bundle/** text eol=lf`;
  shipped `manifest.json` was generated against LF content.
- **Refs:** ADR-002; fitness function `acd-bundle-manifest-hashes`; `.gitattributes`.

## R3 — Pin the manifest grain in the contract ("member" vs "rendered file")

- **Kind:** misunderstanding · **Area:** contract · **Stage:** refine→build · **Owner:** contract authors (Three Amigos) · **Raised by:** developer (Story 00)
- **What happened:** ADR-002 said "one entry per RENDERED file"; the feature said "one entry per
  rendered member". A template member is a *directory* of files (milestone=8, uat=2, story/task=1), so
  the two readings diverge for templates (34 manifest entries = 8 agents + 14 commands + 12 template
  files, vs 4 template *ids* in the descriptor).
- **Why:** "member" was used at two grains — descriptor id vs rendered file — without the contract
  saying which the manifest counts.
- **Lesson:** when a term spans grains, the contract must pin which grain each artifact uses. Resolved:
  manifest grain == rendered file; descriptor grain == member id; they coincide except for templates.
  The install manifest (Story 01/02) inherits this grain.
- **Refs:** ADR-002/ADR-004; `03_bundle-manifest.feature`.

## R4 — A canonical renderer silently drops source frontmatter no scenario asserts

- **Kind:** near-miss · **Area:** contract · **Stage:** build · **Owner:** developer · **Raised by:** developer (Story 00)
- **What happened:** the loose `.claude/commands/aof/*.md` carry `argument-hint` and `allowed-tools`
  frontmatter; the shared command renderer (`renderResource`) emits only
  `aof-generated`/`description`/`aof-invocation`/`aof-runtime`, so those fields are **dropped** on
  render. No scenario asserted them, so the green build hid the loss. (Agent `tools` survived only
  because the loader transforms the CSV string into the array the renderer expects.)
- **Why:** migrating loose assets through a renderer built for a narrower field set drops anything the
  renderer doesn't know about — and a passing suite won't catch a field nothing asserts.
- **Lesson:** when migrating loose assets into a canonical renderer, audit field fidelity up front and
  assert the fields that must survive; a green build is not evidence of faithful passthrough. Carried
  follow-up: if consumer-installed commands must preserve `argument-hint`/`allowed-tools`, extend the
  shared renderer (a milestone-level decision, not bundle-local).
- **Refs:** `src/adapters.mjs` `renderResource`; STATE `## Feedback (for retro)`.
