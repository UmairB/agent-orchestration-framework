---
doc: retrospective
ref: "06"
---
# 06 · Headroom Plugin — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never
renumber. Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE.
This milestone had **no blocker stops** and **no VERIFICATION findings** (the build was clean and the
Three Amigos feasibility notes held exactly). The lessons below come from the review-gate catches and
carried follow-ups recorded in STATE `## Feedback (for retro)` (now archived at the close): R1–R3 are
review-gate near-misses, R4 a process idiom to graduate, R5 a deliberate-debt watch-item, R6 a
scope-boundary surfaced at build.

## R1 — When help text advertises a positional, the arg-read must honour `options._[0]`, not just `--target`

- **Kind:** near-miss · **Area:** code · **Stage:** build · **Owner:** developer · **Raised by:** craft review (Review gate)
- **What happened:** `use-headroom` / `unuse-headroom` advertised a `[dir]` positional in their help
  text but read `options.target` only, ignoring `options._[0]` — so the documented positional form
  silently resolved to `process.cwd()` instead of the named dir. Fixed to
  `options.target ?? options._[0] ?? process.cwd()`, matching `workInitCommand`.
- **Why:** the command surface advertised a capability the arg parser didn't honour, and no
  `@executable` scenario exercised the positional invocation, so the suite stayed green over the gap.
- **Lesson:** when a command's help advertises a positional, the arg-read must honour `options._[0]`
  (not just `--target`), and ideally a scenario should cover the positional form so the advertised
  capability can't ship inert.
- **Refs:** STATE `## Feedback (for retro)`; `src/cli.mjs` `workUseHeadroomCommand` /
  `workUnuseHeadroomCommand` (now mirrors `workInitCommand`).

## R2 — Two surfaces that write the same config subtree must share one read/merge/write helper

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** build (self-caught)
- **What happened:** `init --with-headroom` wrote the config via `workspacePaths().configPath` (always
  `.aof/…`) while the toggle commands used `findProjectConfig` (legacy-fallback resolution) — two
  independent answers to "which config file is authoritative." Unified by exporting
  `readConfig` / `writeConfig` from `work-headroom.mjs` and reusing them in `work-init.mjs` (also
  removing the duplicated read/write and 3 now-dead imports).
- **Why:** two commands writing the same `work.headroom` subtree each resolved the target path on its
  own, so a fresh-`.aof` repo and a legacy-config repo could disagree on which file got written — a
  latent split-brain that no single-command test would catch.
- **Lesson:** when more than one command writes the same config subtree, route them through a single
  shared read/merge/write helper; divergent path resolution across write surfaces is a latent
  split-brain, not a style nit.
- **Refs:** STATE `## Feedback (for retro)`; `src/work-headroom.mjs` `readConfig` / `writeConfig`
  reused in `src/work-init.mjs`.

## R3 — An arch-test's assertion scope must match the ADR invariant's stated scope

- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** architect · **Raised by:** architect (Structural review)
- **What happened:** `acd-headroom-no-dependency` audited only `src/headroom.mjs`, but ADR-005 names
  "the plugin source *and any sibling*." Widened it to also audit `src/work-headroom.mjs`, and
  tightened the import regex to bare package specifiers so a relative `./work-headroom.mjs` import is
  not mistaken for a package dependency.
- **Why:** the test's audited file set was narrower than the invariant it claimed to guard, so a
  sibling source file could violate the no-install invariant undetected — the guard had drifted open.
- **Lesson:** an arch-test's assertion scope must match the ADR invariant's stated scope (and its
  matchers must distinguish a package specifier from a relative import), or the fitness function
  silently stops guarding part of the invariant it names.
- **Refs:** ADR-005; `test/arch/acd-headroom-no-dependency.test.mjs`.

## R4 — RED-until-built arch-tests must lazy-import the target inside `run()`, never at module top level

- **Kind:** near-miss · **Area:** process · **Stage:** refine · **Owner:** architect · **Raised by:** architect (retro candidate)
- **What happened:** the fitness functions for a not-yet-built module were authored RED-until-built. A
  *top-level* import of a missing module evaluates at suite **load** and crashes the entire run; a
  lazy `await import()` **inside `run()`** instead produces a scoped RED for just that test. The
  `acd-roundtrip-*` tests already used this idiom and it held again here for
  `acd-headroom-honest-degrade` and `acd-headroom-config-isolation` (each produced a scoped RED, not a
  suite-load crash, before story 00 landed `src/headroom.mjs`).
- **Why:** a top-level import runs before any test body, so a missing target takes down the whole suite
  rather than the one test that is intentionally RED.
- **Lesson:** graduate "lazy dynamic import inside `run()`" to the **documented default** for
  RED-until-built arch-tests, so a not-yet-built target always yields a scoped RED, never a suite-load
  crash.
- **Refs:** STATE `## Notes & decisions in flight` (architect retro candidate);
  `test/arch/acd-headroom-honest-degrade.test.mjs`, `acd-headroom-config-isolation.test.mjs`;
  precedent `test/arch/acd-roundtrip-*.test.mjs`.

## R5 — `defaultWhich` is now triplicated verbatim — a deliberate-debt watch-item

- **Kind:** near-miss · **Area:** code · **Stage:** build · **Owner:** developer · **Raised by:** craft review (carried, not fixed)
- **What happened:** the same `defaultWhich` PATH-lookup is duplicated byte-for-byte across
  `terminal-providers.mjs`, `headroom.mjs`, and `work-headroom.mjs`. Left local in each module — for
  self-containment and injectable testability — rather than extracted to a shared `whichBin` export.
- **Why:** each module wanted a self-contained, injectable PATH lookup and the three copies are small
  and currently identical; extracting now would couple them for little gain.
- **Lesson:** accepted as deliberate debt — fine while the three copies stay byte-identical; the moment
  one drifts, extract a single `whichBin` export. Recorded here as a watch-item so it survives STATE
  compaction.
- **Refs:** STATE `## Feedback (for retro)`; `src/terminal-providers.mjs` / `src/headroom.mjs` /
  `src/work-headroom.mjs` `defaultWhich`.

## R6 — Don't assume foundational `work` config scaffolding exists because the repo has it by hand

- **Kind:** misunderstanding · **Area:** process · **Stage:** build · **Owner:** product-owner · **Raised by:** build
- **What happened:** build surfaced that **no command writes the `work` settings block** into
  `.aof/aof.config.json` — `aof work init` writes only the lock, and top-level `aof init` writes a
  config with no `work` block; this repo's `work.*` settings were hand-added. Owner decision: seeding
  the `work` settings/defaults (apart from headroom) is a **separate story's** responsibility, not 06.
  06 is unaffected — `use-headroom` / `init --with-headroom` create-or-merge the config, and an absent
  config is plugin-off, so headroom is correct whether or not that future story exists.
- **Why:** the milestone treated a seeded `work` settings block as ambient context, but nothing in the
  shipped CLI creates one — it had been authored by hand in this repo.
- **Lesson:** don't assume foundational config scaffolding exists just because the working repo has it
  hand-authored. **Carried follow-up:** a separate story owns seeding the `work` settings object; a
  later milestone that needs a seeded `work` block must not depend on 06 to have created it.
- **Refs:** STATE `## Feedback (for retro)`; `src/cli.mjs` `initCommand`; `src/work-init.mjs`.
