---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 06 · Headroom Plugin — State

**Accepted 2026-06-20** (`aof:verify 06`). All three stories verified and accepted; milestone
`status: done`. Compacted at this close: the durable decisions have graduated to ADRs
([ARCHITECTURE.md](ARCHITECTURE.md) ADR-001…005); the review-gate process lessons + carried
follow-ups have graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R6) and the
`## Feedback (for retro)` section has been archived with them; the verification record lives in
[VERIFICATION.md](VERIFICATION.md). The blow-by-blow framing/refine/build/review narrative has been
archived; only the closure record and carried follow-ups remain below.

## Outcome

All three independent stories built, verified, and accepted — the optional, config-gated headroom
**wrap-mode** plugin that fronts the work-board terminal's `claude` / `codex` CLIs, with `absent ≡ off`,
honest-degrade, and the no-install invariant enforced structurally:

- [x] `00_story_headroom-config-contract` — the spine: the frozen `work.headroom` `$def` in
  `schemas/aof.schema.json` (ADR-001/002) + the pure honest-degrade resolver `resolveHeadroomLaunch`
  in `src/headroom.mjs` (ADR-003). (`status: done`)
- [x] `01_story_headroom-toggle-cli` — `aof work use-headroom` / `unuse-headroom` + `aof work init
  --with-headroom`: config-only read-merge-write, PATH-check + install hint, never the lock (ADR-004)
  → `src/work-headroom.mjs` (`readConfig` / `writeConfig` reused by `src/work-init.mjs`), CLI arms in
  `src/cli.mjs`. (`status: done`)
- [x] `02_story_headroom-wrap-routing` — `resolveHeadroomLaunch` wired into `handleConnection`
  (`src/terminal-ws.mjs`) so an enabled, routable session spawns `headroom wrap <provider>` and
  degrades to the raw provider when headroom is absent (ADR-003). (`status: done`)

Verification: `@executable` only (10 task features) — **774 ok / 0 fail**; all 5 fitness functions
(`test/arch/acd-headroom-*`) green; **zero `@manual`, zero `@uat`** (a config + transport-seam concern
with no human-judgement surface), no UI / `DESIGN.md`. Gate `aof:validate 06` → PASS. See
[VERIFICATION.md](VERIFICATION.md). Milestone 06 is a leaf — nothing `depends:` on it.

## Carried follow-ups

Open items deliberately deferred past this milestone (lessons live in RETROSPECTIVE.md):

- **Proxy mode — designed, not shipped.** ADR-002 records `mode:"proxy"` as the graduation path (one
  shared `headroom proxy` child owned by the board server, health-checked base-URL injection), but it
  is **rejected at the schema** in v0 — degrading proxy→wrap would fake a capability, the dishonest
  opposite of honest-degrade. v0 proves wrap mode first; proxy graduates to a later milestone only if
  it earns its keep (`port` / `stateless` schema knobs enter then). Deferred.
- **`work` settings-block seeding (RETROSPECTIVE R6).** No command writes the `work` settings block
  into `.aof/aof.config.json` today (`aof work init` writes only the lock; top-level `aof init` writes
  a config with no `work` block) — the repo's `work.*` settings were hand-added. Seeding the `work`
  settings/defaults (apart from headroom) is a **separate story's** responsibility. 06 is unaffected:
  `use-headroom` / `init --with-headroom` create-or-merge the config, and an absent config is
  plugin-off.
- **`defaultWhich` consolidation (RETROSPECTIVE R5).** `defaultWhich` is triplicated verbatim across
  `terminal-providers.mjs` / `headroom.mjs` / `work-headroom.mjs` — left local for self-containment +
  injectable testability. Extract a shared `whichBin` export the moment the three copies drift.

## Notes & decisions in flight

- **All five ADRs settled at refine** and carried through the build unchanged — see
  [ARCHITECTURE.md](ARCHITECTURE.md): ADR-001 `work.headroom` peer of `work.ui` (optional, absent ≡
  off, frozen `{ enabled, mode, providers }`); ADR-002 wrap-only v0, `mode:"proxy"` rejected at schema;
  ADR-003 a single pure resolver `resolveHeadroomLaunch`; ADR-004 enable/disable is config-only
  read-merge-write (never the lock, `unuse` keeps the disabled block); ADR-005 the no-install invariant
  as arch-tests only (no story). No ADR was reopened or superseded during the build.

## Feedback (for retro)

<!-- Archived at the milestone close (aof:verify 06, 2026-06-20). The review-gate catches and carried
     follow-ups have graduated into RETROSPECTIVE.md R1–R6; no VERIFICATION finding was raised (clean
     build). The section is retained empty as the record that the graduation happened, exactly as
     durable decisions graduate into ADRs. -->

_None — graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) R1–R6 (no VERIFICATION findings; clean build)._
