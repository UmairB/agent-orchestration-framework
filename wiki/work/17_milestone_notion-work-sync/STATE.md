---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 17 · Notion Work-Board Sync — State

## Progress

- Framed `2026-06-25` by `aof:add-milestone` from the operator's request (push milestone + story status
  to an existing Notion board, opt-in, one-way aof → Notion, via the Notion CLI not the MCP server,
  driven by the PO as `aof work integrations notion sync-work <milestone>`). Status `not-started`;
  stories to be authored by `aof:refine 17`.
- **Refined `2026-06-25` (`aof:refine 17`) — Decide + Break-down complete.** `aof-researcher` wrote
  [RESEARCH.md](RESEARCH.md) (§A1–A8; the blocking Notion-CLI/auth unknowns resolved); `aof-architect` wrote
  [ARCHITECTURE.md](ARCHITECTURE.md) (5 ADRs + a 7-row fitness table). Broken into **four independent
  stories** (`00 → {01, 02} → 03`), listed in [SPEC.md](SPEC.md) `## Stories`. Status → `in-progress`.
  Contracts NOT yet authored (this was the break-down, not the Three Amigos pass) — each story's task
  `.feature` files come from `aof:refine 17/<SS>` or `aof:continue 17`.
- **Contracts authored `2026-06-25` (`aof:refine 17 --autonomous`) — Three Amigos pass complete.** Fanned
  out the contract stage in parallel across the three buildable stories (00/01/02 are independent by
  construction). PO authored the headline Scenarios; `aof-qa` filled the Examples tables + tagging +
  litmus; `aof-developer` vetted feasibility. **12 task `.feature` files, 45 scenarios** (38 `@executable`
  with the CLI/Notion spawn seam stubbed, 7 `@manual` for the live-token round-trips): **00** spine — 3
  features (command-registered, opt-in-no-op, mapping-sidecar-roundtrip); **01** projection-sync — 5
  features (projection-plan, dry-run-zero-calls, status-map/honest-skip `@executable`; first-run/resync,
  one-way-disk-wins `@manual`); **02** provisioning/doctor — 4 features (config-block-validates,
  descriptor-registered, auth-env-reference, doctor-surfaces-notion). **03** fitness stays `.feature`-less
  — its contract IS the `ARCHITECTURE.md` fitness table (7 arch-tests, RED-until-built; mirrors 08/03,
  12/04, 13/03). `aof work validate` **PASS** (closed-vocab tags, every scenario one verification lane).
  Developer verdict **BUILDABLE — no blockers**; two should-fix items resolved in-pass (see Feedback).
  All four stories → `in-progress`. **Next:** `aof:continue 17` to build the spine, then fan out 01/02,
  with 03's arch-tests going green as each module lands.
- **Built + reviewed `2026-06-26` (`aof:continue 17`).** Built sequentially `00 → 01 → 02 → 03` (serialised, not
  fanned out: stories share the single `scripts/test.mjs` aggregator and 01 fills the `run`-body of the command
  00 creates — concurrent edits to the shared aggregator would clobber). All four stories → `in-review`. Landed:
  `src/notion/{mapping,projection,sync,cli}.mjs`, `src/commands/notion-sync-work.mjs` (registered in
  `command-core.mjs`; `integrations notion sync-work` CLI dispatch in `cli.mjs`), `NOTION_DESCRIPTOR` in
  `tool-store.mjs`, the `work.integrations.notion` block in `aof.schema.json`, the `notion-auth` advisory in
  `config-inspect.mjs`, the sidecar gitignore entry, and the **seven `acd-notion-*` fitness functions** (all GREEN —
  no longer RED-until-built). Full suite **1310 ok / 0 not ok** (63 notion tests). **Review gate:** `aof-architect`
  (structural) → **CONFORMS** on all five ADRs, the seven fitness functions mutation-verified non-vacuous, the two
  shared-file touches (the m12 doctor `(version X)` suffix, the spawn-handle rename) non-regressing. `aof-qa`
  (behavioural) → sound + honestly scoped; one should-fix **NTN-1** (the signature create→record→patch-in-place
  idempotency was proven only by source-grep, not by execution, despite the injected spawn seam making it
  offline-provable) + two nice-to-haves — **all three applied** (3 new `@executable` apply-path tests over the spy;
  `01_first-run-creates-resync-updates.feature` re-split 3 `@executable` + 3 `@manual`; dry-run tautology + doctor
  at-most-warning tightened). No UI ⇒ no designer pass. **Next:** `aof:verify 17` (the `@manual` live-token lanes +
  sign-off).

- **Verified (partial) + HELD `2026-06-26` (`aof:verify 17`).** Ran the automated + agent-runnable lanes,
  no `@uat` / no UI. **Green:** `@executable` suite 1310 ok / 0 not ok (63 notion tests); the seven
  `acd-notion-*` fitness functions; opt-in no-op live (`{configured:false, items:[], hint}`, zero egress);
  `aof project doctor` surfaces Notion advisory (managed-tool warning + tool-platform win32-x64 ok, exit 0,
  never errors); `npx ntn@0.17.0 --version` → `ntn 0.17.0` (binary installs + runs on win32). **Deferred
  (finding NTN-V1, non-blocker):** the four live-Notion `@manual` lanes (01 create/resync/patch-in-place,
  02 `ntn api` auth round-trip, 03 doctor present-and-versioned + auth-reachable, 04 one-way disk-wins) —
  no workspace/token on this host (RESEARCH §A2); each has a green offline `@executable` MECHANIC twin.
  `aof work validate 17` **PASS**. **Operator chose to HOLD `in-review`** rather than accept on the offline
  twins alone — see [VERIFICATION.md](VERIFICATION.md). Stories stay `in-review`; SPEC stays `in-progress`.
  **Next:** run the NTN-V1 lanes with a real `NOTION_API_TOKEN` against a live board, then re-run
  `aof:verify 17` to accept (and trigger the retrospective + memory ingest at that close).

## Notes & decisions — RESOLVED at refine (graduated to ADRs)

- **The aof-item ↔ Notion-page mapping → RESOLVED `ADR-001`: a git-ignored `.aof/notion.work-map.json`
  sidecar** keyed by aof ref, the SOLE identity store. Candidate (b) external-id-property-on-page was
  rejected — `RESEARCH §A5/A6`: it needs a writable id column aof can't create on the board AND ~doubles
  the request count (a resolve-query before every write) vs the sidecar; the milestone-13 `.aof/`
  derived-store precedent tilts it.
- **Which Notion CLI → RESOLVED `RESEARCH §A1` + `ADR-004`: the official `ntn` (`0.17.0`),** an **npx-lane**
  milestone-12 tool. Auth → the **`NOTION_API_TOKEN`** integration-token env-var reference (not OAuth,
  `RESEARCH §A2`); the config holds the env-var NAME, never the secret.
- **The milestone-12 store tension → RESOLVED `ADR-004` (option ii).** `ntn` is npx-lane, and `12/ADR-002`
  did NOT wire the npx lane into the version-keyed store — so it is a `provider:"npx"` `NOTION_DESCRIPTOR`,
  a first-class managed tool the m12 registry + `aof project doctor` checks own, NOT store-resident.
  (See `## Feedback (for retro)` — the SPEC's "store-first" wording was an npx/uv-lane near-miss.)
- **Opt-in no-op (hard requirement) → RESOLVED `ADR-004` + `ADR-005 inv.3`:** absent
  `work.integrations.notion` ⇒ `{ configured:false, items:[], hint }`, zero CLI spawn, zero Notion calls —
  enforced by the `acd-notion-opt-in-noop` arch-test. A configured-but-unreachable Notion fails honestly
  (`ADR-005 inv.7`, `acd-notion-fail-honestly`).
- **Status vocabulary mapping → RESOLVED `ADR-003`:** a MANDATORY config `statusMap` (aof status → an
  EXISTING board option name; the API can't invent one, `RESEARCH §A4`); a missing entry (esp. `in-review`,
  no Notion default) is an honest per-item `skipped` + `reason`, never a half-write.
- Reuses the same `listItems` / `readMeta` traversal the `validate` / `list` / `doctor` (15) lane reads
  (`ADR-002`); no new traversal. Depends on **08** (command-core seam) and **12** (managed tool store).

## Open / deferred to build + verify

- **`@manual` live-Notion lanes.** The dev host has no Notion token/workspace (`RESEARCH §A2`), so the live
  `ntn` install, the real auth round-trip, the create-then-update-in-place idempotency, the 429/`Retry-After`
  pacing (`RESEARCH §A6`), and the win32 binary running are all `@manual` — built green where `@executable`
  (CLI/Notion stubbed), signed off at verify with a real token.
- **Board pre-reqs the operator supplies (config, not code).** The board must already have: one database
  holding the milestone + its stories, a self-relation "sub-tasks" property (`RESEARCH §A3`), a status/select
  property whose options cover the four aof statuses, and a `data_source_id` for the 2025-09-03 API
  (`RESEARCH §A7`). aof binds to these; it never creates them (`ADR-003`, `ADR-005 inv.5`).

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — 1310 ok / 0 not ok (63 notion tests), `2026-06-26`
- [x] Fitness functions green — the seven `acd-notion-*` arch-tests, mutation-verified non-vacuous
- [ ] `@manual` signed off — see `UAT.md` (live-token lanes; authored at `aof:verify`)

## Feedback (for retro)

- SPEC §Scope/§Dependencies promised the Notion CLI would be 'provisioned into ~/.aof/tools/notion/<version>/ and resolved store-first' — but RESEARCH §A1 + 12/ADR-002 make that impossible: ntn is an npx-lane tool and m12 deliberately did NOT wire the npx lane into the version-keyed store (project:provision even refuses a non-uv provider). The SPEC was written assuming any managed tool is store-resident; only uv-lane tools are. ADR-004 resolves it (npx-lane doctor-checked descriptor, store-residency NOT promised for npx), but the milestone SPEC's store-first language for the Notion CLI should be read as 'a first-class m12 managed-tool descriptor the registry+doctor own', not literal version-keyed-store residency. Retro: when a SPEC promises a milestone-12 capability, check whether it is a uv-lane or npx-lane capability before wording it as store-resident. — Raised by: architect
- ADR-004 says the `work.integrations.notion` block is 'read by validateConfig (config-inspect.mjs:140)', but the developer's feasibility read found `validateConfig` is hand-rolled per-key and does NO `work.*` subtree validation today — it would report a malformed block as valid. The `@executable` proof of schema acceptance/rejection therefore binds to the Ajv-2020 schema-compile seam (the milestone-06 `acd-headroom-config-schema` idiom), not `validateConfig`; the story-00 `00_config-block-validates.feature` was re-bound at refine accordingly. Retro: this is the same class as R4 from milestone 11 (verify a wrapped seam's ACTUAL shape at refine, not its name) — an ADR citing a validator by file:line should confirm the validator actually validates the subtree, not assume the name implies the behaviour. The architect may want to either reword ADR-004's 'read by validateConfig' or have the build extend `validateConfig` to be schema-aware (then the feature can re-point). — Raised by: developer (feasibility), resolved in-pass by PO
- ADR-004's frozen `NOTION_DESCRIPTOR.platforms` declares a single `win32: { supported:true, note:"x64 only (no win32-arm64)" }` entry, and the m12 `toolPlatformCheckFor` (config-inspect.mjs:488) keys on `process.platform` only — it has NO arch dimension. So a `win32-arm64 → warning` doctor row is not provable against the frozen descriptor (win32 of any arch resolves to the supported entry → ok). The `03_doctor-surfaces-notion.feature` tool-platform outline was re-scoped at refine: win32 reads ok with the x64-only caveat surfaced as an advisory note, and the warning path is demonstrated via an injected descriptor-unsupported platform (the m12 idiom). Retro: the x64-only constraint is real (RESEARCH §A1) but currently only ADVISORY (a note, not an enforced gate) — if a hard arm64 block is ever wanted, it needs an arch-aware m12 platform check + descriptor matrix (a superseding m12 ADR), out of scope here. — Raised by: developer (feasibility), resolved in-pass by PO
- **(build, story 00→01 handoff)** Task `00_command-registered-and-invokable.feature`'s Background mandates "the Notion-CLI spawn seam is stubbed to return an empty plan" and asserts a CONFIGURED non-dry-run `sync-work 17` exits 0 — but the spine test realised this through the **bin** (a child/registry CLI face that CANNOT inject the `ctx.notionSpawn` spy). While story 00's body was itself an empty stub the bin run trivially exited 0; once story 01 filled the run-body, a configured no-sidecar run produces `create` ops that reach `defaultNotionSpawn` (throws 501), breaking the spine test. Resolved in-pass: the spine test's configured fixture now seeds a sidecar where every item already `noop`s (zero spawns) — faithful to the Background's "stubbed ⇒ empty plan ⇒ zero egress" without changing the feature, command shape, or envelope. Retro: an `@executable` Background that mandates a stubbed/injected seam should be wired through an IN-PROCESS `invoke` face (where the spy injects), not the un-injectable bin — otherwise it is fragile across the spine→consumer handoff (same class as binding a proof to a face that can't honour the stub). — Raised by: developer (story 01)
- **(build, story 02 — shared m12 doctor message)** Feature `03_doctor-surfaces-notion.feature`'s managed-tool row requires the npx-lane "present on PATH via npx" state to read ok **naming the resolved version**, but the shared m12 `managedToolCheckFor` PATH-source branch historically emitted `"<tool> is present on PATH, not managed."` with NO version. The developer appended a `(version X)` suffix to that shared message (version was already in `details`), satisfying the Notion feature while keeping the existing graphify doctor assertions (`/present on PATH/`, `/not managed/`) green. A cosmetic, non-behavioural touch to a shared check — flagged because the frozen feature wording forced it. Retro: when a new tool's doctor feature asserts message CONTENT on a SHARED m12 check, confirm the shared message already carries that content or accept that satisfying it edits a cross-tool message (vs. asserting only severity, which would not). — Raised by: developer (story 02)
- **(build, story 02 — arch-test spawn-grep near-miss; relevant to story 03)** The new `src/notion/cli.mjs` spawn initially used a `resolved.path` handle whose call-form matched the existing m09/m12 spawn-guard source-greps (`acd-headroom-no-dependency` / the graph no-face-spawn idiom scan `src/notion/*`-adjacent egress). The developer resolved it by RENAMING the variable in their own new code — the frozen arch-tests were not edited. Heads-up for story 03 (fitness): its seven `acd-notion-*` source-greps scan `src/notion/*` + `notion-sync-work.mjs`; author the matchers against the AS-BUILT spawn egress (argv[0] = the provisioned binary; `pages create`/`pages update` verbs only) and self-check each matcher fires on a forbidden form so the greps are non-vacuous. — Raised by: developer (story 02)
