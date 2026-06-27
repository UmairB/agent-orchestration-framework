---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 17 · Notion Work-Board Sync — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the `notion sync-work` command, the
> aof→Notion projection, idempotent identity/mapping, opt-in config + the managed Notion CLI,
> `--dry-run`; the out-of-scope list: no two-way, no auto-trigger, no provider abstraction, never
> creates the board schema, no MCP server) and `STATE.md` (`§Notes & decisions in flight` — the
> load-bearing mapping ADR sidecar-vs-external-id, the auth/secrets env-var-reference point, the
> opt-in-no-op hard requirement "worth an arch-test", the status-vocabulary map). ADRs cite these as
> `SPEC §…` / `STATE §…`, and cite the researcher's `RESEARCH.md` as `RESEARCH §A1…A8`.
>
> The seams this milestone EXTENDS / CONSUMES (all read at authoring; cited file:line, NOT
> re-litigated):
> - milestone-08 command core — `src/command-core.mjs` (the frozen Command `{ id, input, run, cli }`
>   registry + `invoke`/`getCommand`/`listCommands`, lines 67–108; basis-neutral results, the CLI a thin
>   `argv→invoke→render`/`--json` face). The sync op registers here as a NEW command (the m08 "new ops
>   arrive as commands first" rule, `08/ADR-002`), inheriting the bijection (`08/ADR-004`) + `--json`.
>   Pattern read from `import:milestone` (`src/commands/import-milestone.mjs:34–198` — the `cli.argv/render/json`
>   adapter + raw-absolute basis-neutral result) and `project:provision` (`src/commands/project-provision.mjs:34–202`).
> - the shared traversal — `src/work.mjs` `listItems(workDir)` (line 57; a milestone item +, for a
>   milestone, its `stories/<NN_story_slug>` children, each `{ number, type, slug, name, dir, ref, parent }`),
>   `readMeta(item)` (line 124; `parseFrontmatter` of the item's record doc — `SPEC.md` for a milestone,
>   `STORY.md` for a story, line 89–94), `parseFrontmatter(text)` (line 102), `loadWorkspace` (line 32 →
>   `{ configPath, config, projectRoot, workDir }`). The same model `work:validate`/`work:list`/`work:doctor`
>   already read — NO new traversal.
> - milestone-12 managed tool store — `12/ARCHITECTURE.md` (`ADR-001` the store-first `resolveManagedBinary` +
>   `~/.aof/tools/<name>/<version>/`; `ADR-002` the frozen descriptor `{ name, provider:"npx"|"uv", packageSpec,
>   version, binaries[], extras?, platforms? }` + the `{ npx, uv }` registry — and the load-bearing tension:
>   `ADR-002` "the npx lane installs a node framework as today; it does NOT target the version-keyed store");
>   `src/tool-store.mjs` (`TOOL_DESCRIPTORS` line 357, `descriptorFor` line 369, `PROVIDERS={uv,npx}` line 254,
>   `planNpxProvision` delegating to `frameworks.mjs` line 242, `resolveManagedBinary` store-then-PATH);
>   `src/paths.mjs` `toolStoreRoot`/`toolVersionDir`; `src/config-inspect.mjs` `doctorConfig` `checks[]` (line 236)
>   with the `managed-tool`/`provider-prereq`/`tool-platform` checks (lines 311–313) over `toolDescriptors()`
>   (and `project:provision`'s live path REFUSES a non-uv provider, `project-provision.mjs:125`).
> - config + schema — `schemas/aof.schema.json` (`work` `$ref` line 77 / `$defs.work` line 350 — currently NO
>   `integrations` key); `src/dsl.mjs` `loadConfig` (line 26); `src/config-inspect.mjs` `validateConfig` (line 140).
> - the `.aof/` git-ignored store precedent — `src/aof-gitignore.mjs` (`ensureAofGitignore` + `AOF_GITIGNORE_ENTRIES`,
>   line 25; the nested-`.gitignore` discipline) and milestone-13's import store (`13/ADR-001`, `.aof/` is already a
>   git-ignored derived-artifact home aof owns).
> - CLI dispatch — `cli.mjs` `workCommand` (line 248; the `aof work <sub-noun>` switch) and the per-command
>   `argv→invoke→render`/`--json` helper idiom (`workListCommand` line 758, `workDoctorCommand` line 813).
>
> This milestone does NOT re-litigate the m08 boundary/registry model (`08/ADR-001/002`), the m12 store
> geometry / resolver / descriptor (`12/ADR-001/002`), or the doctor seam shape (`12/ADR-003`,
> `15/ADR-001`) — it registers a NEW command into the SAME core, defines a NEW descriptor + a config block
> the SAME validator reads, and adds checks to the SAME `doctorConfig.checks[]`.
>
> **Prior-lesson recall.** `aof work memory recall "notion integration external sync command config opt-in
> mapping" --area architecture --block` returned an EMPTY block — no near-miss to honour or depart from.
> Decisions below stand on SPEC/STATE/RESEARCH + the 08/12/13/15 contracts alone.

## ADR-001: The aof-item ↔ Notion-page mapping is a git-ignored `.aof/` SIDECAR keyed by aof ref, NOT an external-id property on the page; the sidecar is the SOLE mapping store, an aof-owned derived artifact resolved deterministically before any Notion call

**Status:** Accepted
**Date:** 2026-06-25

**Context.** This is the milestone's load-bearing decision (`STATE §Notes — Load-bearing ADR for refine`):
re-syncs must update in place, never duplicate, so the first sync must record, per aof item, which Notion
page it owns. STATE names the two candidates: (a) a `.aof/` **sidecar** recording each aof item's Notion
page id; (b) an **external-id property written on the Notion page** (resolve-by-query). `RESEARCH §A5`
establishes (b) is technically feasible — a `rich_text`/`number` property is writable AND filterable
(`filter: { property, rich_text: { equals: "<ref>" } }`), so resolve-by-query round-trips — BUT it requires
a **writable id property to pre-exist on the board's schema**, which aof never creates (`SPEC §Out of scope`:
"never creates databases, properties, or views"), so (b) adds a board pre-req AND a config field naming that
property. `RESEARCH §A6` makes the cost decisive: resolve-by-external-id-property costs an extra
database-query before EVERY write (`≈ 2 + 2M` requests for a milestone with M stories) and "roughly DOUBLES
the request count" versus a sidecar that already holds the page id (`≈ 1 + M`), against Notion's ~3 req/s
rate limit (`RESEARCH §A6`). The tilt STATE asked about: aof **already owns** a git-ignored `.aof/` store —
milestone-13's import store lives there (`13/ADR-001`), `src/aof-gitignore.mjs` already establishes the
nested-`.gitignore` discipline for derived artifacts (`AOF_GITIGNORE_ENTRIES`, line 25). A sidecar is not a
new kind of thing; it is one more derived, git-ignored, aof-owned file in a home aof already keeps honest.

**Decision.** The mapping is a **`.aof/` sidecar**, the SOLE mapping store. It binds each aof item's stable
ref to the Notion page id the sync created/resolved for it, scoped per board so two boards do not collide,
and is a **derived, git-ignored artifact** (added to the `aof-gitignore.mjs` baseline, the milestone-13/
F-02 nested-`.gitignore` idiom). The sync resolves a page id from the sidecar BEFORE any Notion call: a
sidecar HIT means the page is known (the sync PATCHes it, no resolve-query); a MISS means create (then
record the new page id back into the sidecar). aof never writes an external-id property on the page and
never issues a resolve-by-query — the sidecar is the identity, so the board needs no aof-owned id property
and every sync costs at most one Notion call per item.

**The frozen mapping-store contract (frozen 2026-06-25):**

```js
// src/notion/mapping.mjs — the SOLE aof-item↔Notion-page identity store. A derived,
// git-ignored .aof/ artifact (aof-gitignore.mjs baseline). NOT an external-id property
// on the page; NOT a resolve-by-query. Keyed by aof ref, scoped per board/data-source.
//
//   <projectRoot>/.aof/notion.work-map.json   // the git-ignored sidecar (one per project)
//   shape: { version, dataSourceId, entries: { "<aofRef>": { pageId, lastStatus, lastSyncedAt } } }
//     <aofRef>  — the aof item ref: "17" (milestone) / "17/01" (story). The traversal key
//                 from listItems()/readMeta(), NOT a synthesised id.
//     pageId    — the Notion page id the first sync created/resolved for that ref.
//     dataSourceId — the board data-source this map binds to (RESEARCH §A7); a config change
//                 to a DIFFERENT data-source does NOT silently re-bind stale page ids.
//
//   readMapping(projectRoot, dataSourceId)            → { entries } (empty on absent file — never throws)
//   resolvePageId(mapping, aofRef)                    → pageId | null   (HIT → patch; null → create)
//   recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta)  → persist the binding back
//
//   - The sidecar is the ONLY mapping store; no Notion id property is written, no resolve-query issued.
//   - It is DERIVED + git-ignored (rebuilt by re-resolving on a cleared sidecar would re-create pages —
//     so it is honest-by-record, the known trade vs (b)'s statelessness; ADR accepts it for the ~halved
//     request cost + zero board pre-req).
```

**Alternatives considered.**
- *(b) External-id `rich_text` property on the page + resolve-by-query (`RESEARCH §A5`)* — REJECTED on two
  grounds. (1) It requires a writable id property to PRE-EXIST on the board (aof never creates properties,
  `SPEC §Out of scope`), making the integration depend on an operator having hand-added a board column — a
  pre-req a sidecar avoids entirely. (2) It costs a resolve-query before every write (`RESEARCH §A6`,
  "roughly DOUBLES the request count") against a ~3 req/s ceiling, so a many-story milestone pays a real
  rate-limit tax the sidecar does not. Its only edge — surviving a cleared sidecar — is outweighed: a
  cleared sidecar is recoverable (re-resolve / re-create is the operator's explicit action), whereas the
  board pre-req + doubled cost are paid on every sync forever.
- *A hybrid: sidecar primary, external-id fallback on a sidecar miss* — REJECTED for this milestone: it
  builds the (b) machinery (id-property write + filtered query) to serve a rare path, contradicting
  `SPEC §Out of scope` "builds no provider abstraction ahead of a second consumer" — the same restraint
  applies to a second resolution path. The sidecar alone is the minimal honest mapping; a future milestone
  may add (b) as a superseding ADR if board-statelessness ever becomes a requirement.
- *Store the mapping inside `aof.config.json`* — REJECTED: the config is a TRACKED, hand-authored file
  (`SPEC §opt-in config`); a churning page-id map is a derived artifact that belongs in the git-ignored
  `.aof/` home with the other derived stores (`aof-gitignore.mjs`), never in the committed config.

**Consequences.** The SPINE story builds `src/notion/mapping.mjs` + the `aof-gitignore.mjs` baseline entry;
the contract above is frozen the moment the spine lands, and the projection/sync story consumes
`resolvePageId`/`recordPageId` without renegotiation. The sidecar's git-ignored, derived status is enforced
by the fitness table (ADR-005, the `notion-mapping-sidecar` guard). Because identity is the sidecar, the
projection story's create/patch decision is a pure local lookup, not a Notion query — which keeps the
one-call-per-item cost and the `--dry-run` zero-call promise (ADR-003) achievable.

**Invariant.** The aof↔Notion mapping lives ONLY in the git-ignored `.aof/` sidecar keyed by aof ref; no
code path writes an aof-identity property onto a Notion page and no code path issues a resolve-by-query to
find a page (the mapping is the sole resolver). Enforced by `acd-notion-mapping-sidecar` (ADR-005 inv. 1).

## ADR-002: `notion:sync-work` registers as a NEW command-core command under the `integrations notion` namespace — input `{ milestone, dryRun? }`, a per-item `--json` envelope (`created`/`updated`/`unchanged`/`skipped`/`no-op` + the Notion page ref), reusing `listItems`/`readMeta`; CLI face `aof work integrations notion sync-work <milestone>`

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Scope` requires the operation be "a registered command-core command (the milestone-08
contract) — a stable input (`{ milestone }`) and a `--json` result envelope reporting, per item, what was
pushed (`created`/`updated`/`unchanged`/`skipped` + the Notion page ref), reusing the same `listItems`/
`readMeta` traversal". `SPEC §Dependencies (08)` fixes the rule: "new ops arrive as commands first" — so the
sync is a registered command (the same way `import:milestone` and `project:provision` registered, `08/ADR-002`),
inheriting the bijection (`08/ADR-004`) + `--json`, and any future board/MCP face gets it free. The command
core is `src/command-core.mjs` (the `{ id, input, run, cli }` shape, lines 7–17; basis-neutral `run` results,
the CLI a thin face). The traversal is `listItems(workDir)` (`work.mjs:57`) + `readMeta(item)` (`work.mjs:124`)
— the SAME model `work:validate`/`work:list`/`work:doctor` read; the sync MUST reuse it, not parse milestone
folders itself. `SPEC §Out of scope` namespaces the command `integrations notion` so "a future provider
(Linear, Jira, …) is a sibling" — but builds NO provider abstraction now.

**Decision.** Register one NEW command into `src/command-core.mjs`'s `COMMANDS` (a new module
`src/commands/notion-sync-work.mjs`, the house one-per-command idiom), id **`notion:sync-work`**. Its `run`
reads the milestone + its stories via `listItems`/`readMeta` (NO new traversal), computes the projection
(ADR-003) against the sidecar mapping (ADR-001) + the config (ADR-004), and returns a **basis-neutral**,
per-item result envelope. The CLI face is dispatched through a NEW `integrations` sub-noun on `workCommand`
(`cli.mjs:248`): `aof work integrations notion sync-work <milestone> [--json] [--dry-run]`, routing through
`invoke("notion:sync-work", …)` (the registry door, never a direct path). `integrations notion` is the
namespace segment so a sibling provider registers as `aof work integrations <provider> …` without touching
this command — the namespace is the seam, not a built abstraction (`SPEC §Out of scope`).

**The frozen command + envelope contract (frozen 2026-06-25):**

```js
// src/commands/notion-sync-work.mjs — registers into command-core.mjs COMMANDS (08/ADR-002).
//   id:    "notion:sync-work"
//   input: { milestone: string, dryRun?: boolean }   // required: ["milestone"]; additionalProperties:false
//   run(input, ctx) → SyncResult                      // basis-neutral; no displayPath inside run (08/ADR-002)
//
//   SyncResult {
//     milestone,                  // the milestone ref synced
//     configured: boolean,        // false ⇒ the opt-in no-op fired (ADR-004); items: [], no Notion call
//     dryRun: boolean,            // --dry-run computed the plan with ZERO Notion calls (ADR-003)
//     items: [ ItemResult, … ],   // one per aof item (milestone + each story), traversal order
//     hint?: string,              // present iff !configured — the setup hint (ADR-004)
//   }
//   ItemResult {
//     ref,                        // "17" / "17/01" (the listItems()/readMeta() ref)
//     type,                       // "milestone" | "story"
//     status,                     // the aof on-disk status read via readMeta
//     action,                     // "created" | "updated" | "unchanged" | "skipped" | "no-op"
//     pageId: string | null,      // the Notion page ref (null on no-op / a dry-run create-plan)
//     reason?: string,            // skipped/no-op explanation (e.g. "no status-map entry for in-review")
//   }
//
//   cli: aof work integrations notion sync-work <milestone> [--json] [--dry-run]
//     argv(positionals, options) → { milestone: positionals[0], dryRun: !!options.dryRun }
//     render(result) → human per-item lines; json(result) → the envelope verbatim (refs are not paths,
//                      so no relativise step — unlike storePath/artifacts in provision/import).
```

**Alternatives considered.**
- *A direct CLI dispatch (like `project show`/`validate`) instead of a registry command* — REJECTED by
  `SPEC §Dependencies (08)` (the "new ops arrive as commands first" rule): a new operation registers into
  the core so it inherits the bijection + `--json` and a future face reuses it. The existing direct-dispatch
  `project` subcommands predate the core; the NEW sync is a registry command, exactly as `project:provision`
  (`12/ADR-003`) and `import:milestone` (`13/ADR-002`) are.
- *Register on the `work:*` prefix (so it joins the `/api/work` bijection)* — REJECTED: the m08/m15
  `/api/work` bijection (`acd-work-command-route-coverage`) requires EVERY `work:*` command to have a served
  board route; the sync is a PO terminal command, not a board operation (`SPEC §Objective`: "the PO's tool,
  run when a story finishes"). It takes the `notion:*` prefix (like `graph:*`/`project:*`/`import:*`), so it
  is correctly EXCLUDED from the `/api/work` bijection while still inheriting the generic command-cli
  bijection (`08/ADR-004`).
- *Build a generic `integrations` provider registry now (a `{ notion, … }` lane object)* — REJECTED
  (`SPEC §Out of scope`: "builds no provider abstraction ahead of a second consumer"). `integrations notion`
  is a CLI NAMESPACE (a dispatch segment), not a built abstraction; the second provider is a sibling command
  + sibling namespace branch, added when it exists, not a framework now.
- *Take a free `{ milestone }` plus per-item overrides in the input* — REJECTED: the input is the minimal
  `{ milestone, dryRun? }` the schema validates; all binding (board ids, status map, relation property) lives
  in config (ADR-004), not the per-call input — so the call site stays the SPEC's stable `{ milestone }`.

**Consequences.** The SPINE story builds `src/commands/notion-sync-work.mjs` (the registration + the frozen
envelope) + the `cli.mjs` `integrations notion sync-work` dispatch branch; the projection/sync story fills
`run`'s create/patch logic. The command inherits the `08/ADR-004` command-cli bijection — the existing
`acd-work-command-cli-bijection` family extends to it (it carries a `cli` adapter + dispatches via the
registry with `--json`), so that is NOT re-litigated as a new fitness function; ADR-005 adds only the
sync-specific structural guards (no-MCP, one-way, opt-in, never-touch-schema, fail-honestly).

## ADR-003: The aof→Notion projection is milestone→board page + story→a same-database sub-task (the §A3 self-relation set by page-id), aof status→a board option via the MANDATORY config status-map (§A4, fail-honestly on a missing option), addressed by `data_source_id` (§A7); `--dry-run` computes the diff with ZERO Notion calls; the sync is ONE-WAY (disk→Notion) and NEVER reads Notion state as authoritative

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Scope` fixes the projection: "milestone maps to its board page; each story maps to a
**sub-task** of that page; aof status maps to the board's status property; title + a stable identity are
carried". `RESEARCH §A3` resolves the sub-task mechanism: a Notion sub-task is a **self-relation property in
the SAME database**, set via the API by the parent page's id (`"<RelationProp>": { "relation": [{ "id":
"<parentPageId>" }] }`) — so milestone + stories MUST live in one database and the relation property is
board-defined (configurable). `RESEARCH §A4` is decisive for status: option values are board-defined and the
API can only set an EXISTING option — aof's four statuses (`not-started`/`in-progress`/`in-review`/`done`)
MUST map to the board's existing option names via a config map, `in-review` has no Notion default, and a
missing option must fail honestly (`SPEC §scope`: "fail honestly, never half-write"). `RESEARCH §A7` requires
addressing the board by a **`data_source_id`** (the 2025-09-03 API moved query/create off bare `database_id`).
`SPEC §Scope` requires `--dry-run` to "compute and print the projected diff WITHOUT calling Notion".
`SPEC §Objective` fixes direction: "one-way, aof→Notion only; aof never treats Notion state as authoritative;
on any divergence aof overwrites Notion from disk", and `SPEC §Out of scope` excludes two-way/reverse sync.

**Decision.** The projection is a pure function of the on-disk traversal + the config + the sidecar mapping,
computed BEFORE any Notion write:
- **milestone → board page** in the configured `data_source_id` (`RESEARCH §A7`); the page id is the sidecar
  entry for the milestone ref (ADR-001).
- **story → a sub-task page** in the SAME `data_source_id`, with the configured self-relation property
  (`RESEARCH §A3`) set to the milestone page's id — milestone + its stories share one data-source (the
  self-relation cannot cross databases; this is a config + board pre-req the sync asserts honestly).
- **aof status → a board option** via the MANDATORY config status-map (`work.integrations.notion.statusMap`,
  ADR-004): each of the four aof statuses maps to an existing board option NAME; the sync sets the configured
  status/select property to that name (`RESEARCH §A4`). A status with NO map entry (or a mapped option the
  board does not have) is an **honest per-item failure** (`action:"skipped"`, `reason` naming the missing
  mapping) — the sync NEVER invents a board option (`RESEARCH §A4`: the API cannot create one) and NEVER
  half-writes a page with a fabricated value.
- **`--dry-run`** runs the WHOLE projection (traversal + sidecar lookup + status-map resolution + the
  create/patch decision per item) and prints the diff, issuing ZERO Notion calls — the create/patch decision
  is a local sidecar lookup (ADR-001), so the dry-run is exact, not an estimate.
- **One-way.** Every Notion call the sync issues is a WRITE derived from disk (create-page / patch-page) or a
  metadata read needed to ADDRESS a write (e.g. the data-source's property TYPE — `status` vs `select`,
  `RESEARCH §A4` — whose JSON key differs); the sync NEVER reads a Notion page's status/title and copies it
  onto disk, and NEVER lets a Notion value win on divergence — disk always overwrites Notion. There is no code
  path that treats a Notion field as the source of truth for an aof item.

**The frozen projection contract (frozen 2026-06-25):**

```js
// src/notion/projection.mjs — PURE: (items, config, mapping) → a plan of per-item ops. No Notion call here.
//   projectMilestone({ items, config, mapping }) → SyncPlan
//     SyncPlan { dataSourceId, ops: [ Op, … ] }     // ops in traversal order (milestone first, then stories)
//     Op {
//       ref, type, status,
//       op: "create" | "patch" | "noop" | "skip",   // create: no sidecar pageId; patch: sidecar HIT;
//                                                    //   noop: status already matches lastStatus; skip: no map
//       pageId: string | null,                       // null on a create (assigned after the POST)
//       properties: { title, statusOption, relation? },  // statusOption is a BOARD OPTION NAME (§A4)
//       relation?: { property, parentPageId },       // story → milestone page id (§A3 self-relation)
//       reason?: string,                             // skip explanation (e.g. "no statusMap['in-review']")
//     }
//
// src/notion/sync.mjs — APPLIES the plan via the Notion CLI (ADR-004's spawn seam). Per-op:
//   create → POST a page (parent = data-source, relation set, status set); record pageId (ADR-001)
//   patch  → PATCH the page's status/title properties by id
//   noop/skip → no Notion call.
//   --dry-run → return the plan, apply NOTHING (ZERO Notion calls — the projection is the preview).
//
//   ONE-WAY guarantee: sync.mjs only ever issues create/patch (disk→Notion) + an addressing metadata read;
//   it has NO read-page-status→write-disk path. Notion is never the source of truth (SPEC §Objective).
//   NEVER-HALF-WRITE: a missing status-map option is a per-item skip BEFORE the write, not a page written
//   with a bad value; there is no atomic txn (RESEARCH §A6), so the unit of honesty is the per-item op.
```

**Alternatives considered.**
- *Model the story as a child SUB-PAGE (page-children) rather than a sub-item relation* — REJECTED by
  `RESEARCH §A3`: Notion "sub-tasks" on a board are a self-relation property, not sub-pages; a child page is
  a different mechanism and would not surface as a board sub-task. The milestone FIXES the self-relation
  model (the config names the relation property); if a board models sub-tasks as sub-pages it is out of this
  milestone's binding (a superseding ADR's problem).
- *Derive the board option from the aof status by a built-in convention (e.g. titlecase)* — REJECTED by
  `RESEARCH §A4`: option names are board-defined and the API cannot create one; `in-review` has no Notion
  default. A config-supplied status-map is MANDATORY, and a missing entry is an honest skip, never a guessed
  value pushed (which the API would reject mid-sync, half-writing the milestone).
- *Address the board by a bare `database_id`* — REJECTED by `RESEARCH §A7`: the 2025-09-03 API routes
  query/create through `data_source_id`; a bare `database_id` breaks on a multi-source board. The config
  names a `data_source_id` (ADR-004); the sync addresses writes by it.
- *Let `--dry-run` issue read-only Notion queries to show the live diff* — REJECTED by `SPEC §Scope`
  ("WITHOUT calling Notion") AND ADR-001: because the sidecar holds the create/patch decision locally, the
  dry-run is exact with zero calls; a "live diff" dry-run would re-introduce the resolve-query cost ADR-001
  rejected and break the zero-call promise (and the opt-in-no-op's zero-call guarantee, ADR-004).
- *Reconcile divergence by reading Notion and merging* — REJECTED by `SPEC §Objective`/`§Out of scope`
  (one-way only; aof is the source of truth): on divergence disk OVERWRITES Notion. No read-Notion-as-truth
  path exists — that is the one-way invariant (ADR-005 inv. 2).

**Consequences.** The PROJECTION/SYNC story builds `src/notion/projection.mjs` (pure) + `src/notion/sync.mjs`
(the apply layer over ADR-004's CLI spawn seam) and the `run` body of `notion:sync-work` (ADR-002). The
one-way + never-half-write + never-touch-schema invariants are enforced by ADR-005 (inv. 2/5/6). The live
Notion round-trip (real `ntn api` against a workspace, the 429/`Retry-After` pacing of `RESEARCH §A6`) is
`@manual` (no token on the dev host, `RESEARCH §A2`); the projection STRUCTURE (plan shape, status-map
resolution, the create/patch decision, the zero-call dry-run) is `@executable` with the CLI stubbed.

## ADR-004: Opt-in via a `work.integrations.notion` config block (absent ⇒ honest no-op + setup hint, ZERO Notion calls); auth is an env-var REFERENCE (`tokenEnv`), never a committed secret (§A2); the Notion CLI is provisioned as an npx-lane DOCTOR-CHECKED tool (NOT into the version-keyed store — the m12 npx-lane decision is honoured, not extended), surfaced by `aof project doctor`; a configured-but-unreachable Notion fails honestly, never half-writes

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Scope` requires a `work.integrations.notion` config block (board/database ids, the
status-property mapping, how auth is supplied) that, "when absent, makes the command an honest no-op + setup
hint"; `STATE §Notes — Opt-in no-op is a hard requirement` makes the absent⇒no-op a hard requirement "worth
an arch-test", and adds that a configured-but-unreachable Notion must "fail honestly, never half-write".
`RESEARCH §A2` resolves auth: the head-less model is an internal integration token in the `NOTION_API_TOKEN`
env var (Notion's own convention), NOT OAuth (`ntn login` needs a browser + keychain — wrong for a
hook-runnable sync, `SPEC §CLI-not-MCP`); the config holds the env-var NAME, never the secret
(`SPEC §opt-in`: "token must never be committed"). The schema currently has NO `integrations` key
(`schemas/aof.schema.json` `$defs.work` line 350); the config loads via `loadConfig` (`dsl.mjs:26`) and
validates via `validateConfig` (`config-inspect.mjs:140`). The Notion CLI must be "provisioned through the
managed tool store (milestone 12) and surfaced by `aof project doctor`".

**The m12 tension, resolved.** `RESEARCH §A1` + `12/ADR-002` are the load-bearing tension: the recommended
CLI `ntn` (`RESEARCH §A1`: official, MIT, `bin: ntn`, Node 22+/win32-x64) is a **node/npm package → the m12
`npx` lane** — and `12/ADR-002` deliberately did NOT wire the npx lane into the version-keyed
`~/.aof/tools/<name>/<version>/` store (`12/ADR-002`: "the npx lane installs a node framework as today; it
does NOT target the version-keyed store"). `src/tool-store.mjs` confirms this: `planNpxProvision` (line 242)
delegates to `frameworks.mjs` (the npx scope model), `project:provision`'s live path even REFUSES a non-uv
provider (`project-provision.mjs:125`: "executes the uv lane only"), and `resolveManagedBinary` only resolves
store-then-PATH — an npx-lane tool is never in the store, so it resolves via the PATH fallback. Three options
were on the table (`RESEARCH §Recommendation Q1`): (i) generalize/extend the m12 npx lane INTO the store;
(ii) a doctor-checked npx tool (global / `npx -y`); (iii) the self-contained Go-binary fallback
`@coastal-programs/notion-cli` (`RESEARCH §A8`, which IS store-resident but unofficial).

**Decision.** **Option (ii) — a doctor-checked npx-lane tool, honouring the m12 npx-lane decision rather than
extending it.** A frozen m12 tool descriptor for the Notion CLI is added to `src/tool-store.mjs`'s
`TOOL_DESCRIPTORS` with `provider:"npx"` — so it is a FIRST-CLASS managed tool the registry knows, the
`managed-tool` doctor check (`config-inspect.mjs:341`) enumerates, and the npx lane provisions exactly as it
provisions any node framework today (`12/ADR-002`, NOT the version-keyed store). The descriptor carries the
`platforms?` matrix `RESEARCH §A1` requires (win32-x64-only, Node 22+/npm 10+ prereq). This is the minimal,
non-regressing resolution: it touches NO m12 frozen contract — it does NOT generalize the npx lane into the
store (option i, which would re-open `12/ADR-002` and risk the npx lock/attempt regression guard
`12/ADR-005 inv. 4`), and it does NOT trade the official CLI for an unofficial one for store-residency's sake
(option iii). The Notion CLI being npx-lane means "provisioned, version-pinned, doctor-surfaced" is exactly
what an npx-lane managed tool gets under m12 — the store-residency the uv tools get is NOT part of the npx
lane's m12 contract, so the SPEC's "provisioned through the managed tool store" is honoured as "a managed-tool
descriptor the m12 registry + doctor own", which is what m12 gives an npx tool. The doctor surface is
**`aof project doctor`** (the m12 `managed-tool`/`provider-prereq`/`tool-platform` checks, `config-inspect.mjs:311–313`)
— it already enumerates `toolDescriptors()`, so adding the Notion descriptor surfaces present-and-versioned +
platform support for free; an auth-reachability advisory is added as a sibling check there (NOT in `work:doctor`,
which is the work-stream health lane, `15/ADR-001`).

**Opt-in + auth + fail-honestly.** Absent `work.integrations.notion` ⇒ the command is an honest NO-OP:
`run` returns `{ configured:false, items:[], hint }` and issues ZERO Notion calls and spawns NO CLI (the hard
requirement, `STATE §Opt-in no-op`). Auth is an env-var REFERENCE: the config holds `tokenEnv` (the env-var
NAME, default `"NOTION_API_TOKEN"`, `RESEARCH §A2`), never the token; the sync reads the named env var at run
time and passes it through to the spawned CLI (and sets `NOTION_KEYRING=0` to keep `ntn` head-less,
`RESEARCH §A2`). A configured-but-unreachable Notion (token absent/invalid, network, a 429 storm,
`RESEARCH §A6`) is an HONEST failure — a structured per-item/whole-sync error, never a half-written page and
never a silent success (`STATE §Opt-in no-op`; `SPEC §scope` "fail honestly, never half-write").

**The frozen config-block contract (frozen 2026-06-25):**

```jsonc
// schemas/aof.schema.json — $defs.work gains "integrations" (currently NO such key, line 350).
// work.integrations.notion (ABSENT ⇒ the opt-in no-op; PRESENT ⇒ all binding lives here, never the secret):
{
  "work": {
    "integrations": {
      "notion": {
        "dataSourceId": "<data_source_id>",   // RESEARCH §A7 — NOT a bare database_id (2025-09-03 API)
        "tokenEnv": "NOTION_API_TOKEN",        // RESEARCH §A2 — the env-var NAME; the token is NEVER in config
        "statusProperty": "Status",            // the board's status/select property name (type read at run, §A4)
        "statusMap": {                         // MANDATORY (§A4): aof status → an EXISTING board option NAME
          "not-started": "Not started",
          "in-progress": "In progress",
          "in-review":   "In review",          // §A4 — no Notion default; operator MUST supply
          "done":        "Done"
        },
        "relationProperty": "Sub-tasks"        // RESEARCH §A3 — the board's self-relation property name
      }
    }
  }
}
```

```js
// src/tool-store.mjs — a NEW frozen m12 descriptor (12/ADR-002 shape), provider:"npx" (NOT the store).
//   NOTION_DESCRIPTOR = {
//     name: "notion", provider: "npx", packageSpec: "ntn", version: "0.17.0", binaries: ["ntn"],
//     platforms: { win32: { supported: true, prereqs: ["node>=22","npm>=10"],
//                           note: "x64 only (no win32-arm64)" } },   // RESEARCH §A1
//   }
//   (Fallback, a superseding ADR's call if `ntn`'s Node-22 floor bites:
//    { name:"notion", provider:"npx", packageSpec:"@coastal-programs/notion-cli", version:"6.4.1",
//      binaries:["notion-cli"] } — env var NOTION_TOKEN, RESEARCH §A8. NOT chosen now: `ntn` is official.)
//
// Honoured: this is provider:"npx" → the m12 npx lane provisions it as a node framework (12/ADR-002),
// NOT the version-keyed store. resolveManagedBinary resolves it via the PATH fallback; the managed-tool
// doctor check reports it "present on PATH" (the npx-lane reality, config-inspect.mjs:380). No m12 frozen
// contract is edited — the npx lane / store boundary (12/ADR-002) stands.
```

**Alternatives considered.**
- *(i) Generalize the m12 npx lane to install into the version-keyed store* — REJECTED: it re-opens
  `12/ADR-002`'s deliberate npx-lane/store boundary and risks the npx lock/attempt regression guard
  (`12/ADR-005 inv. 4` — the npx lane must DELEGATE to the untouched `frameworks.mjs`). The SPEC's "provisioned
  through the managed tool store" is satisfied by the tool being a first-class m12 managed-tool descriptor the
  registry + doctor own — which is precisely what the npx lane gives a node tool — without re-homing the lane.
  That re-home is its own milestone if ever wanted; this milestone does not force it.
- *(iii) Pick the store-resident Go-binary `@coastal-programs/notion-cli`* — REJECTED for THIS milestone: it
  trades the official, Notion-maintained `ntn` (`RESEARCH §A1`, Notion's own `NOTION_API_TOKEN` convention) for
  an unofficial tool purely to land in the store — and it is STILL the npx lane (`RESEARCH §A8`), so it would
  not be version-keyed-store-resident under m12 either. Recorded as the named fallback (above) a superseding ADR
  takes if `ntn`'s Node-22 floor proves a blocker (`RESEARCH §A1`).
- *Store the token in `aof.config.json` (or the tool store)* — REJECTED by `SPEC §opt-in` / `STATE §Auth`: the
  token must never be committed; the config holds only the env-var NAME (`tokenEnv`), the sync reads the secret
  from the environment at run time (`RESEARCH §A2`). OAuth (`ntn login`) is rejected too — it needs a browser +
  keychain, defeating the head-less, hook-runnable requirement (`SPEC §CLI-not-MCP`, `RESEARCH §A2`).
- *Surface CLI-present/auth-reachable in `work:doctor` (m15) instead of `project doctor`* — REJECTED: managed
  tool presence/version is already a `project doctor` concern (the m12 `managed-tool`/`tool-platform` checks,
  `config-inspect.mjs:311`); `work:doctor` is the work-STREAM health lane (`15/ADR-001`, cross-item content
  health), not a tool-binary surface. The Notion descriptor rides the SAME `doctorConfig.checks[]` the graphify
  tool does; the auth-reachability advisory is a sibling there.
- *Make absence a hard ERROR (or a half-run that pushes what it can)* — REJECTED by `STATE §Opt-in no-op`: an
  unconfigured project is HEALTHY; the command is a no-op + hint, ZERO Notion calls, and "every other `aof work`
  command behaves exactly as before" (`SPEC §Objective`).

**Consequences.** The PROVISIONING/DOCTOR/CONFIG story adds the `NOTION_DESCRIPTOR` to `TOOL_DESCRIPTORS`, the
`work.integrations.notion` block to `schemas/aof.schema.json` + `validateConfig`, the env-var-reference auth
read, and the auth-reachability advisory check on `doctorConfig.checks[]`. The SPINE story owns the
config-LOAD + the opt-in-no-op gate in `notion:sync-work` (the absent⇒no-op is the spine's, since the command
shape includes `configured`). The opt-in-no-op, env-var-reference (no committed secret), and fail-honestly
invariants are enforced by ADR-005 (inv. 3/4/7). The live CLI presence/version + auth round-trip is `@manual`
(`RESEARCH §A2` — no token on the dev host); the descriptor registration, the schema/validate acceptance, the
no-op gate, and the doctor-check WIRING are `@executable` with the CLI/Notion stubbed.

## ADR-005: The structural guarantees are SEVEN fitness functions — mapping-sidecar-only, one-way, opt-in-no-op, auth-env-ref-no-secret, never-touch-board-schema, CLI-not-MCP, fail-honestly/never-half-write — each a `test/arch/acd-notion-*.test.mjs` arch-test, RED until built

**Status:** Accepted
**Date:** 2026-06-25

**Context.** This is the load-bearing deliverable, mirroring `08/ADR-004` / `12/ADR-005` / `13/ADR`s: the
mapping (ADR-001), the registered command (ADR-002), the projection (ADR-003), and the opt-in config + managed
CLI (ADR-004) are durable only if ENFORCED. STATE explicitly names the opt-in-no-op as "worth an arch-test",
and `SPEC §Out of scope` names invariants — no two-way, never touch the board schema, no MCP server, no
provider abstraction — that are STRUCTURAL facts over the sync code, so they are fitness functions HERE, NOT
Gherkin scenarios in a task `.feature`. Any structural assertion a story might be tempted to write as a
scenario ("the sync never reads Notion as authoritative", "absent config spawns no CLI", "no create-database
call") is MOVED here per the m08/m12 discipline. The house idiom is the m12/m13 one: source-grep with the
call-form-not-comment strip (`stripCommentsAndStrings`/`stripCommentsOnly`, `acd-import-read-only-source`
lines 45–75) + a registry/driver import with injected seams. **RED-until-built is correct now**:
`src/notion/mapping.mjs`, `src/notion/projection.mjs`, `src/notion/sync.mjs`, `src/commands/notion-sync-work.mjs`,
and the `NOTION_DESCRIPTOR` do not exist yet; the tests reference them and fail cleanly until the stories land
(then they are wired into `scripts/test.mjs`'s aggregator, the m13 import-digest pattern).

**Decision.** Seven invariants, seven arch-tests under `test/arch/`:

1. **Mapping-sidecar-only (ADR-001).** The aof↔Notion mapping lives ONLY in the git-ignored `.aof/` sidecar
   keyed by aof ref; no code writes an aof-identity property onto a Notion page, and no code issues a
   resolve-by-query to FIND a page. Proven by: importing `readMapping`/`resolvePageId`/`recordPageId` and
   asserting a HIT→pageId / MISS→null round-trip with injected fs; a source-grep of `src/notion/*` that the
   sidecar path is git-ignored (in `AOF_GITIGNORE_ENTRIES`) and that no Notion `filter` query against an
   identity property and no page-property write of an aof ref appears (the only page writes are status/title/
   relation). Self-checked non-vacuous.

2. **One-way / Notion-never-authoritative (ADR-003).** Every Notion call is disk→Notion (create/patch) or an
   addressing metadata read; NO code path reads a Notion page's status/title and writes it to disk, and on
   divergence disk overwrites Notion. Proven by a source-grep of `src/notion/sync.mjs`/`projection.mjs`: the
   Notion-CLI spawn argv only ever names create/patch (POST/PATCH) page verbs + a property/data-source read;
   there is no write to `item.dir`/`STORY.md`/`SPEC.md`/frontmatter from a Notion-derived value (no fs-write
   import reachable from a Notion read). Self-checked.

3. **Opt-in-no-op (ADR-004, `STATE §Opt-in no-op`).** Absent `work.integrations.notion` ⇒ `notion:sync-work`
   returns `{ configured:false, items:[], hint }`, spawns NO CLI, and issues ZERO Notion calls. Proven by
   invoking `notion:sync-work` with a workspace whose config has no `integrations.notion`, with the CLI-spawn
   seam injected as a spy; assert the spy is never called, the result is the no-op envelope, and a hint is
   present. (The hard-requirement arch-test STATE called for.)

4. **Auth-env-ref / no-committed-secret (ADR-004).** The config carries `tokenEnv` (an env-var NAME), never a
   token; the sync reads the secret from the named env var at run time. Proven by: the schema accepts
   `tokenEnv` and has NO `token`/secret field; a source-grep that the sync reads `process.env[<tokenEnv>]`
   (or the injected env) and that no Notion token literal / `token:` config read appears; the schema's
   `work.integrations.notion` has no property that holds a secret value.

5. **Never-touch-board-schema (ADR-003, `SPEC §Out of scope`).** The sync NEVER creates a database, a data
   source, a property, or a view — it only creates/patches PAGES and reads metadata. Proven by a source-grep
   of `src/notion/*`: no Notion API path/verb that creates schema (`databases` POST, `data_sources` POST,
   `update-data-source-properties`, create-property) appears in any spawn argv / `ntn api` path; the only
   create is a PAGE create. Self-checked the matcher fires on a forbidden schema-create form.

6. **CLI-not-MCP (`SPEC §Out of scope`, the explicit MCP exclusion).** The Notion integration imports / depends
   on NO Notion MCP server or MCP client for Notion anywhere; it reaches Notion ONLY via the provisioned CLI
   spawn. Proven by a source-grep of `src/notion/*` + `src/commands/notion-sync-work.mjs`: no import of an MCP
   SDK / `@modelcontextprotocol` / a Notion MCP package, no `mcp` server stand-up; the sole Notion egress is a
   CLI spawn (argv[0] is the provisioned binary). Mirrors `acd-headroom-no-dependency` / the graph
   no-face-spawn idiom.

7. **Fail-honestly / never-half-write (ADR-003/ADR-004, `SPEC §scope`).** A status with no `statusMap` entry
   (or a configured-but-unreachable Notion) is a STRUCTURED per-item/whole-sync failure — `action:"skipped"`
   with a `reason`, computed BEFORE the write, never a page written with a fabricated/absent value and never a
   silent success. Proven by: the pure `projectMilestone` over a fixture milestone with an unmapped status →
   that item's op is `skip` with a `reason` (no `create`/`patch` op emitted for it); a source-grep that the
   apply layer skips an op flagged `skip`/`noop` (no write for it). The live unreachable-Notion path is
   `@manual`; the projection-level honesty is `@executable`.

These are structural (over the mapping store, the sync's Notion egress, the no-op gate, the auth read, the
schema-write absence, the MCP absence, the per-item honesty) — fitness functions, here, not task scenarios.
Their OBSERVABLE counterparts — "`aof work integrations notion sync-work 15` makes the milestone's Notion page
+ story sub-tasks match the on-disk statuses, creating on first run and updating in place thereafter",
"`--dry-run` previews the diff without touching Notion", "an unconfigured project changes nothing and says so"
— are task `.feature` files over a real (or recorded) Notion workspace, authored by the projection/sync story
and gated `@manual` where they need a live token (`RESEARCH §A2/A6`).

**Alternatives considered.**
- *Fold these into the m08/m12 bijection tests* — REJECTED: the bijection is parameterised on the command
  surface; the Notion-specific guards (sidecar-only, one-way, opt-in-no-op, schema-untouched, CLI-not-MCP,
  honest-failure) are integration-specific structural facts that earn their own named tests so the fitness
  table indexes one reviewable contract per invariant (the m08/m12/m13 split). The command-cli bijection for
  `notion:sync-work` is INHERITED from `08/ADR-004` (it carries a `cli` adapter + dispatches via the registry),
  so it is NOT re-litigated here.
- *Make one-way / never-half-write runtime assertions (throw if a Notion read feeds disk)* — REJECTED (the
  m08/m12 reasoning): a runtime throw catches it late; an arch-test fails on the diff that introduces the drift.
  The source-grep + injected-seam import is the braces.
- *Skip the opt-in-no-op arch-test (cover it only behaviourally)* — REJECTED by `STATE §Opt-in no-op` ("worth
  an arch-test"): the zero-Notion-call-on-absent-config is a hard, structural promise that must fail CI loudly
  if a future change makes the command touch Notion before checking config.

**Consequences.** The FITNESS story authors all seven arch-tests against the FROZEN mapping/command/projection/
config (the spine) and the projection/provisioning logic; they are RED until those land, then GREEN and
load-bearing, and are wired into `scripts/test.mjs`'s aggregator (the m13 import-digest pattern). The fitness
story's "contract" IS this ADR — it has no `.feature` pass of its own (mirrors `08/03`, `12/04`, `13/03`). Any
future change that adds a second mapping store / a resolve-query, reads Notion as authoritative, touches Notion
before checking config, commits a secret, creates board schema, pulls in an MCP dependency, or half-writes on a
missing mapping fails CI loudly.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is correct now: src/notion/mapping.mjs, src/notion/projection.mjs,
     src/notion/sync.mjs, src/commands/notion-sync-work.mjs, and the NOTION_DESCRIPTOR do not
     exist yet; the tests reference them and fail cleanly until the stories land (then wired into
     scripts/test.mjs's aggregator, the milestone-13 import-digest pattern). -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Mapping-sidecar-only.** The aof↔Notion mapping lives ONLY in the git-ignored `.aof/` sidecar keyed by aof ref; no code writes an aof-identity property onto a Notion page and no code issues a resolve-by-query to find a page (the sidecar is the sole resolver). | `test/arch/acd-notion-mapping-sidecar.test.mjs` (import `readMapping`/`resolvePageId`/`recordPageId` with injected fs → HIT→pageId / MISS→null; source-grep `src/notion/*` that the sidecar path is in `AOF_GITIGNORE_ENTRIES` and no identity-property write / `filter`-by-id query appears — only status/title/relation page writes) | RED until `src/notion/mapping.mjs` + the gitignore baseline entry land | ADR-001 (inv. 1) |
| **One-way / Notion-never-authoritative.** Every Notion call is disk→Notion (create/patch) or an addressing metadata read; NO path reads a Notion page's status/title and writes it to disk; on divergence disk overwrites Notion. | `test/arch/acd-notion-one-way.test.mjs` (source-grep `src/notion/sync.mjs`/`projection.mjs`: the CLI spawn argv only names page create/patch + a property/data-source read; no fs-write of `STORY.md`/`SPEC.md`/frontmatter from a Notion-derived value; self-checked the matcher fires on a forbidden read→disk form) | RED until `src/notion/sync.mjs` + `src/notion/projection.mjs` land | ADR-003 (inv. 2) |
| **Opt-in-no-op.** Absent `work.integrations.notion` ⇒ `notion:sync-work` returns `{ configured:false, items:[], hint }`, spawns NO CLI, issues ZERO Notion calls. | `test/arch/acd-notion-opt-in-noop.test.mjs` (invoke `notion:sync-work` with a no-`integrations.notion` config + the CLI-spawn seam injected as a spy; assert the spy is never called, the result is the no-op envelope, a hint is present) | RED until `src/commands/notion-sync-work.mjs`'s no-op gate lands | ADR-004, STATE §Opt-in no-op (inv. 3) |
| **Auth-env-ref / no-committed-secret.** The config carries `tokenEnv` (an env-var NAME), never a token; the sync reads the secret from the named env var at run time. | `test/arch/acd-notion-auth-env-ref.test.mjs` (the schema accepts `tokenEnv` + has NO `token`/secret field; source-grep that the sync reads `process.env[<tokenEnv>]`/the injected env and no token literal / `token:` config read appears) | RED until the schema block + the auth read land | ADR-004 (inv. 4) |
| **Never-touch-board-schema.** The sync NEVER creates a database / data source / property / view — only creates/patches PAGES + reads metadata. | `test/arch/acd-notion-no-schema-write.test.mjs` (source-grep `src/notion/*`: no schema-create Notion path/verb — `databases` POST / `data_sources` POST / `update-data-source-properties` / create-property — in any spawn argv / `ntn api` path; the only create is a PAGE create; self-checked the matcher fires on a forbidden schema-create) | RED until `src/notion/sync.mjs` lands | ADR-003, SPEC §Out of scope (inv. 5) |
| **CLI-not-MCP.** The integration imports / depends on NO Notion MCP server or MCP client anywhere; the sole Notion egress is the provisioned CLI spawn. | `test/arch/acd-notion-cli-not-mcp.test.mjs` (source-grep `src/notion/*` + `src/commands/notion-sync-work.mjs`: no `@modelcontextprotocol` / MCP-SDK / Notion-MCP import, no mcp server stand-up; the sole Notion egress is a CLI spawn whose argv[0] is the provisioned binary — the `acd-headroom-no-dependency` / graph no-face-spawn idiom) | RED until `src/notion/*` land | ADR-004, SPEC §Out of scope (inv. 6) |
| **Fail-honestly / never-half-write.** A status with no `statusMap` entry (or an unreachable Notion) is a STRUCTURED per-item/whole-sync failure (`skipped` + `reason`), computed BEFORE the write — never a page written with a fabricated/absent value, never a silent success. | `test/arch/acd-notion-fail-honestly.test.mjs` (pure `projectMilestone` over a fixture milestone with an unmapped status → that item's op is `skip` with a `reason`, no `create`/`patch` op for it; source-grep the apply layer issues no write for a `skip`/`noop` op) | RED until `src/notion/projection.mjs` + the apply layer land | ADR-003, ADR-004, SPEC §scope (inv. 7) |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 08/12/13's split):
     - MAPPING-SIDECAR-ONLY, ONE-WAY, OPT-IN-NO-OP, AUTH-ENV-REF, NEVER-TOUCH-SCHEMA, CLI-NOT-MCP,
       FAIL-HONESTLY are structural invariants over the mapping store / Notion egress / no-op gate /
       auth read / schema-write absence / MCP absence / per-item honesty → arch-tests (this table). They
       are the milestone's load-bearing deliverable (the fitness story — no .feature pass of its own,
       mirroring 08/03, 12/04, 13/03).
     - The OBSERVABLE end-to-end behaviours — "sync-work 15 makes the Notion page + story sub-tasks match
       the on-disk statuses, creating on first run + updating in place thereafter", "--dry-run previews the
       diff without touching Notion", "an unconfigured project changes nothing and says so", "the Notion CLI
       resolves present-and-versioned via aof project doctor", "a 429 backs off on Retry-After" — belong in
       task .feature files authored by the projection/sync + provisioning stories over a real (or recorded)
       Notion workspace, gated @manual where they need a live token / workspace (RESEARCH §A1/A2/A6).
     - The command-core bijection for notion:sync-work (it carries a `cli` adapter + dispatches via the
       registry with --json) is INHERITED from 08/ADR-004 — the existing acd-work-command-cli-bijection
       family extends to it; it is not re-litigated as a new fitness function here.
     - The managed-tool presence/version/platform surface for the Notion CLI rides the EXISTING m12
       `managed-tool`/`tool-platform` doctor checks (config-inspect.mjs:311) over toolDescriptors() — adding
       the NOTION_DESCRIPTOR surfaces it; the auth-reachability advisory is a sibling check, proven by the
       doctor check's behaviour, not a fitness function of its own. -->
