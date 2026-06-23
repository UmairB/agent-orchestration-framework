---
doc: retrospective
updated: 2026-06-23
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. Reference findings/ADRs/commits, never restate.
  Source: STATE ## Feedback (for retro) + VERIFICATION ## Findings + blocker stops.
  Clean findings with no process lesson stay in VERIFICATION — they are NOT retro entries.
-->
# 13 · External Milestone Import — Retrospective

## R1 — A network-boundary idiom that is safe for a CONSTANT URL is not verbatim-safe for USER input

- **Kind:** mistake · **Area:** security · **Stage:** build (caught at review) · **Owner:** developer · **Raised by:** security (review gate)
- **What happened.** `src/import/source.mjs`'s remote `git ls-remote` leg copied `planning-init`'s
  `spawnSync("git", […], { shell: process.platform === "win32" })` form verbatim. But `planning-init`'s
  ls-remote target is a STATIC constant, whereas import's `<repo>` is **user-supplied** — and on win32
  `shell:true` joins argv into a `cmd.exe` command line, so shell metacharacters in `<repo>` (e.g.
  `https://x/" & calc & "`) were interpreted: a command-injection vector on the remote leg.
- **Why.** The idiom was lifted as a whole without re-checking the trust level of the argument it now
  carries. "Reuse the house pattern" silently changed a constant into untrusted input.
- **Lesson.** When you reuse a spawn/network idiom, re-evaluate it against the **new argument's trust
  level**. A user-controlled arg must never reach a shell — drop the win32 `shell` (plain shell-less argv,
  as `recovery.mjs` does) or validate the URL. The pattern's safety is a property of its inputs, not the pattern.
- **Refs:** ADR-002; `src/import/source.mjs` (shell-less `git ls-remote`); fitness `acd-import-read-only-source`
  (the no-shell-string assertion); STATE §Feedback "Don't copy the planning-init win32 shell:true git-spawn idiom".

## R2 — `spawnSync("git", …, { shell: true })` word-splits a multi-word arg and silently no-ops

- **Kind:** blocker · **Area:** code · **Stage:** build · **Owner:** developer · **Raised by:** developer (build)
- **What happened.** A multi-word `git commit -m "<subject>"` under `shell:true` on Windows produced ZERO
  commits (then the dependent `git log` errored, empty) while reporting no failure — the test fixture that
  builds an arbitrary-repo git history silently made nothing.
- **Why.** Under `shell:true` the argv array is re-joined and word-split by the shell, so a quoted multi-word
  argument is torn apart; the no-op surfaces only downstream.
- **Lesson.** Never pass `shell:true` to a `git` spawn that carries a multi-word argument — the argv-array
  (shell-less) form is the safe one, and a shell-less `git` resolves on Windows CI here (proven by story 01's
  `git log` recovery + its fixture). Same root cause as **R1**, opposite symptom (silent corruption vs injection).
- **Refs:** `src/import/recovery.mjs` (shell-less `git log`); story 01 git-history fixture; STATE §Feedback
  "Windows git — shell:true word-splits a multi-word arg".

## R3 — A non-fatal `catch` must still emit a signal

- **Kind:** near-miss · **Area:** code (observability) · **Stage:** build (caught at review) · **Owner:** developer · **Raised by:** architect/QA (review gate)
- **What happened.** The import→`reindex` trigger's `catch {}` (ADR-003 resilience for a binary-absent
  graphify backend) swallowed ALL failures silently — a disk/backend error would leave `imported:true` with
  memory unindexed and **no signal** that recall was now stale.
- **Why.** "Make it non-fatal" was implemented as "make it silent." Resilience and observability were conflated.
- **Lesson.** A degrade-don't-crash `catch` stays non-fatal **and** logs — emit a `console.error` warning
  pointing at the recovery action (`aof work memory reindex`), mirroring the `work-memory.mjs` degraded-path
  convention. Silent success after a swallowed failure is the worst of both.
- **Refs:** ADR-003; `src/commands/import-milestone.mjs` (the reindex warning); STATE §Feedback
  "A non-fatal catch must still log".

## R4 — An "off-topic excludes X" test must assert on a TRUE-zero-scoring record, not on the top-N cut

- **Kind:** mistake · **Area:** contract (test design) · **Stage:** build (caught at review) · **Owner:** developer/QA · **Raised by:** architect (review gate)
- **What happened.** An `02/01` row meant to prove "an off-topic query excludes the import" keyed off the
  top-N cut plus fixture padding. But m05 recall is a ranked **top-N retriever, not thresholded**, and
  `TYPE_BOOST_LESSON` (0.15) gives ANY lesson a non-zero score regardless of query — so the test could pass
  for the wrong reason (padding), and its feature prose still slightly over-claims for the lesson leg (F13-2).
- **Why.** The assertion modelled exclusion as "falls below the cut," but the retriever has no zero floor for
  lessons — exclusion only truly holds for a record that scores a genuine 0 on the query.
- **Lesson.** To assert exclusion against a ranked top-N retriever, pick a record that scores a TRUE 0 (here
  an import `adr` on a non-architecture query), not one relying on the N-cut + fixture size. Know the
  retriever's scoring floor before writing an exclusion test.
- **Refs:** 05/ADR scoring (`TYPE_BOOST_LESSON`); `02/01` off-topic row; VERIFICATION F13-2 (residual prose nit);
  STATE §Feedback "m05 recall is a ranked top-N retriever, NOT thresholded".

## R5 — Promised real-world fixtures that never arrive slip real-shape validation to a generic substitute

- **Kind:** near-miss · **Area:** process · **Stage:** refine → build → verify · **Owner:** product-owner/developer · **Raised by:** autonomous refine (deferral) + verify
- **What happened.** The user offered real example source repos at framing to ground the recovery heuristics
  on real shapes; none reached the autonomous refine or the build, so story 01 was tuned to a generic
  aof-shaped fixture + a synthetic arbitrary-with-git-history fixture. At **verify**, the real-shape `@manual`
  (01/01) was satisfied against a generic real external repo (`octocat/Spoon-Knife`) instead — confidence
  raised, but not against the user's actual target shapes.
- **Why.** The breakdown correctly did not block on the missing fixtures (a documented default), but nothing
  re-collected them at build, so the real-shape check had no real target until verify improvised one.
- **Lesson.** When a real-world fixture is promised but absent, make collecting it an explicit build entry
  gate (not just a deferral note), or accept that real-shape validation lands at verify on a generic
  substitute — and say which target shapes remain unvalidated. Absence of the fixture is information; carry it forward.
- **Refs:** ADR-005; STATE §Default decisions + §Feedback "Example source repos not collected"; VERIFICATION
  01/01 (Spoon-Knife substitute), F13-1.

## R6 — A deferred transport leg should narrow its advertised surface, not 501 on what the help promises

- **Kind:** misunderstanding · **Area:** contract · **Stage:** verify (surfaced) · **Owner:** architect/developer · **Raised by:** verify (live-remote @manual)
- **What happened.** ADR-002 and the CLI describe `<repo>` as "a path **or URL**," and the remote leg was
  always tagged `@manual`/deferred — but a real `aof import milestone <url> …` returns
  `remote-source-unsupported` (501): the read-only `ls-remote` boundary is wired, yet the scratch-fetch +
  recovery over a fetched tree is an unfilled seam. The command advertises a capability it cannot perform.
- **Why.** The deferral was tracked in the docs and the seam comment, but the **user-facing surface** still
  promised the URL form, so the gap reads as a broken promise rather than an honest "not yet."
- **Lesson.** When a transport/lane is deferred, narrow the advertised surface to what ships (e.g. "local
  path in v0") or have the command say "remote import is not yet supported — clone locally and pass the path,"
  rather than accept the URL and 501. Match the promise to the delivered capability. The local-path lane fully
  delivers the SPEC objective; only the remote convenience is deferred.
- **Refs:** ADR-002; `src/import/source.mjs:86-89` (the deferred scratch-fetch seam); VERIFICATION F13-1.

## R7 — A category/exclusion boundary must not rest on a naming convention alone

- **Kind:** near-miss · **Area:** architecture · **Stage:** build (architect note) · **Owner:** architect · **Raised by:** architect (build)
- **What happened.** ADR-004's guarantee — an import is never a managed work item — could read as "because
  the folder is prefixed `import-…`." In fact it rests on **two independent facts**: the store lives OUTSIDE
  `workDir` (so `listItems` never enumerates it) AND `importMilestoneDir` runs the source slug through
  `slugifySource` (collapsing `_`→`-`), neutralising even a deliberately `NN_milestone_*`-shaped source name.
- **Why.** A single naming-prefix convention is fragile — one refactor of the prefix or one
  `ITEM_RE`-shaped source name could breach a boundary that the milestone's whole "knowledge, not managed
  work" thesis depends on.
- **Lesson.** Pin a category/security boundary with structural facts that hold independent of naming (store
  geometry + the slugger), and state the redundancy in the ADR's fitness narrative — so the guarantee
  survives a rename. `acd-import-not-a-work-item` proves it with a decoy `ITEM_RE`-shaped slug.
- **Refs:** ADR-004; `src/import/store.mjs` (`slugifySource`, `importMilestoneDir`); fitness
  `acd-import-not-a-work-item`; STATE §Feedback "the ADR-004 naming guarantee rests on slugifySource + store-outside-workDir".
