---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 17 · Notion Work-Board Sync — Research

**Gathered:** 2026-06-25
**Method:** Live `npm view` of the candidate packages on this Windows 11 host (`ntn`, `@coastal-programs/notion-cli`,
`@litencatt/notion-cli`, `notion-cli`, `@notionhq/client`) — confirming existence, latest version, `bin`, `os`/`cpu`,
maintainer, publish dates; plus the official Notion CLI + API docs (`developers.notion.com/cli/*`,
`developers.notion.com/reference/*`), the official `makenotion/skills` repo, and the 2025-09-03 API upgrade guide. The
milestone-12 frozen tool-descriptor contract (`12/ARCHITECTURE ADR-002`) and this milestone's `SPEC.md` / `STATE.md`.
**Status:** Desk research complete; package metadata is live-confirmed on this host. The CLI's *behaviour* against a real
Notion workspace (auth round-trip, JSON shape of a real `ntn api` call, win32 binary actually running) was NOT executed
live — no Notion token/workspace on this host — so end-to-end operation is flagged `@manual` / unconfirmed where noted.

**Prior-lesson recall:** `aof work memory recall "notion api integration cli auth token sync" --area research --block`
returned an EMPTY block — no prior lesson to honour or depart from. Findings stand on the sources below alone.

---

## §A1 — There IS now an official Notion CLI (`ntn`), and it is Windows-capable as of June 2026 (the blocking unknown, resolved)

- **Finding:** Notion shipped a first-party CLI, package **`ntn`** on npm — `npm view ntn` (this host, 2026-06-25):
  `version 0.17.0`, `license MIT`, `bin: { ntn: "bin/ntn" }`, `deps: none`, `unpackedSize 52.8 MB` (a bundled binary),
  maintainer **`jclem-ntn <jclem@makenotion.com>`** (a Notion email), `latest 0.17.0` published "a week ago" by Notion's
  GitHub Actions. The package declares **`os: ['darwin','linux','win32']`** and **`cpu: ['arm64','x64']`**. The official
  install page states three methods — `curl -fsSL https://ntn.dev | bash` (mac/Linux), **`npm install --global ntn`**
  (cross-platform, **"Requires Node.js 22+ and npm 10+"**), and `winget install Notion.ntn` (Windows) — and that it
  supports macOS, Linux, and Windows, with the caveat **"We currently only support Windows x64 (x86-64/AMD64)"**. The May
  2026 release notes had ntn as macOS/Linux-only ("Windows coming soon"); Notion announced native Windows support (npm +
  winget) in mid-June 2026, which the live `os:['…','win32']` npm field now confirms.
- **Constraint:** The architect has a *first-party, MIT-licensed, maintained, Windows-x64-capable* CLI to target — this
  is the recommended `packageSpec`. BUT its provider lane is the problem (→ §A2): `ntn` is a **node/npm package**, so it
  maps to milestone-12's **`npx` lane**, NOT the `uv` (Python) lane — and the npx lane is the one milestone-12 deliberately
  did NOT re-home into the version-keyed `~/.aof/tools/<name>/<version>/` store (it keeps the npx scope model;
  `12/ADR-002` "the npx lane installs a node framework as today; it does NOT target the version-keyed store"). Two further
  hard constraints: (a) the runtime prereq is **Node 22+ / npm 10+** (heavier than the existing npx tools' floor —
  doctor must check it); (b) **Windows is x64-only** (no win32-arm64) — a per-tool platform-matrix note, exactly the
  shape `12/ARCHITECTURE ADR-002`'s `platforms?` field exists for.
- **Source:** `npm view ntn version description license bin os cpu engines time.modified` (this host, 2026-06-25 →
  0.17.0, win32 in `os`, maintainer `jclem@makenotion.com`); `https://developers.notion.com/cli/get-started/installation`
  ("Node.js 22+ and npm 10+", "We currently only support Windows x64"); `https://www.notion.com/releases/2026-05-13`
  (CLI announcement); `https://x.com/NotionDevs` ("Windows now supported via npm and winget", mid-June 2026).

## §A2 — `ntn` authenticates head-less via `NOTION_API_TOKEN` (an integration token); JSON in/out via `ntn api` — fully scriptable

- **Finding:** `ntn` has two auth modes. Interactive: `ntn login` (OAuth, stores a token in the OS keychain). Head-less:
  it **reads the `NOTION_API_TOKEN` env var** — Notion's own skill doc instructs agents "Check `NOTION_API_TOKEN` first.
  If it is already set, prefer using it instead of telling the user to run `ntn login`." The token is a Notion **internal
  integration token** (`export NOTION_API_TOKEN=$NOTION_API_KEY`). `NOTION_KEYRING=0` opts out of the OS keychain (for CI
  / no-keychain hosts). The scriptable surface is **`ntn api <path>`** — a thin proxy over the Notion REST API that adds
  the `Authorization` + `Notion-Version` headers for you and returns the API's **JSON** on stdout: GET by default
  (`ntn api v1/pages/$PAGE_ID`), a body via `-d '<json>'` / `--data` / stdin (`ntn api v1/pages -d '{…}'`,
  `ntn api v1/pages < body.json`), method override `-X PATCH`. There are also higher-level verbs (`ntn pages create
  --parent …`, `ntn db query`), but **`ntn api` is the load-bearing seam**: anything the Notion REST API can do, the CLI
  can do non-interactively with JSON output.
- **Constraint:** The auth model the architect should adopt is the **internal integration token, supplied as an env var**
  — it is the simplest head-less model, the one Notion's own tooling prefers, and it fits SPEC's "token must never be
  committed → an env-var reference from `work.integrations.notion` config". The config block should hold the env-var
  *name* (e.g. `tokenEnv: "NOTION_API_TOKEN"`), never the secret; the sync passes it through to the spawned `ntn`. OAuth
  (`ntn login` + keychain) is the WRONG fit for a head-less, hook-runnable sync (it needs an interactive browser consent
  and a per-host keychain) — note it exists but recommend against it. Because **every Notion operation routes through
  `ntn api`** (raw REST + JSON), capability §A3–§A6 reduce to "what the Notion REST API allows" — the CLI itself imposes
  no extra capability ceiling, which de-risks the Q1 pick: there is no operation the milestone needs that `ntn api`
  cannot express. (Live token round-trip + the exact JSON envelope of a real call are `@manual`/unconfirmed here.)
- **Source:** `https://github.com/makenotion/skills/blob/main/skills/notion-cli/SKILL.md` ("Check `NOTION_API_TOKEN`
  first"); `https://developers.notion.com/cli/guides/api-requests` (`ntn api`, GET/`-d`/stdin/`-X PATCH`, adds
  Authorization + Notion-Version headers, JSON output, `NOTION_KEYRING=0`); `https://www.notion.com/help/use-notion-from-your-terminal-with-notion-cli`.

## §A3 — "Sub-tasks" on a Notion board are a SELF-RELATION property, created in the DB schema, settable via the API by page-id

- **Finding:** Notion sub-items/sub-tasks are **not** sub-pages and **not** a built-in field — they are a **self-referencing
  relation property** on the same database. Enabling "Sub-items" on a database creates a paired relation (default names
  "Parent item" / "Sub-item", renameable to "Parent task" / "Sub-tasks") where each row links to other rows **in the same
  database** as parent/child. Via the REST API, you create a sub-item by **creating a page whose `parent` is that database
  and setting the self-relation property to the parent page's id** — relation properties in the API are keyed by **page
  IDs** (`"<RelationProp>": { "relation": [ { "id": "<parent-page-id>" } ] }`). The relation property must already exist
  on the board's schema (aof binds to it; it does not create it — SPEC out-of-scope: "never creates databases, properties,
  or views").
- **Constraint:** SPEC's "milestone → board page, story → its *sub-task*" projection is realizable, but it forces the
  config block to name **(a) the target database/data-source id** the items live in and **(b) the self-relation property's
  name** (the board's "Parent" / "Sub-items" property — board-defined, so configurable). The architect cannot assume a
  fixed property name; the milestone-and-its-stories must live in the **same database** (a self-relation cannot cross
  databases), and a story page is created in that database with its relation set to the milestone page's id. If the board
  models sub-tasks as literal **sub-pages** (page-children) rather than a sub-item relation, that is a different mechanism
  — the config must capture which the board uses, or the milestone fixes the self-relation model and says so.
- **Source:** `https://www.notion.com/help/tasks-and-dependencies` and `https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies`
  (sub-items = a self-relation property in the same database); `https://developers.notion.com/docs/working-with-databases`
  (create-a-page parent must be the database; relation properties are set by page id).

## §A4 — `status` vs `select`: option values are BOARD-DEFINED and the API can only set EXISTING options (it cannot invent a status value)

- **Finding:** Two distinct property types. **`select`** is a flat list of options defined by the database (one per row).
  **`status`** is richer: options are grouped (default groups "To-do" / "In progress" / "Complete", default options "Not
  started" / "In progress" / "Done"). For BOTH, the API sets a page's value by passing an option object with `name` or
  `id` (`"Status": { "status": { "name": "Done" } }` / `"…": { "select": { "name": "…" } }`). Crucially: when creating or
  updating a page, **the value must match an option that already exists** on that property's schema — the API enforces
  validation and **cannot create a new status option on the fly** (you "cannot update the name and color of existing status
  options" and "status options themselves must already exist"; new options are added via the UI or the
  update-data-source-properties endpoint, not by setting a page value). There is also a read-only **`unique_id`** property
  type (auto-incremented) — the API CANNOT write to it.
- **Constraint:** This is decisive for SPEC's "status vocabulary mapping". aof's four statuses (`not-started` /
  `in-progress` / `in-review` / `done`) **must be mapped to the board's EXISTING option names** — aof cannot push a value
  the board doesn't already have without erroring. So the `work.integrations.notion` config block MUST carry an explicit
  **status-value map** (aof status → board option name) and the architect must decide failure behaviour when a mapped
  option is missing on the board (honest fail vs skip — SPEC's "fail honestly, never half-write"). aof's `in-review` in
  particular has no Notion default — it WILL need an operator-supplied mapping. The board's property may be `status` OR
  `select`; the config should name the property and the sync must read the property type before writing (the JSON key
  differs: `status` vs `select`).
- **Source:** `https://developers.notion.com/reference/property-object` (status vs select; set by `name`/`id`; status
  defaults + groups; `unique_id` read-only); search corpus on "status options must already exist" — Notion community +
  `https://developers.notion.com/reference/update-data-source-properties` (options added via schema-update / UI, not by a
  page write).

## §A5 — An arbitrary external-id property (rich_text / number) CAN be written and FILTERED on — making resolve-by-query feasible

- **Finding:** The API can write arbitrary custom properties on a page: a **`rich_text`** property takes an array of rich
  text objects, a **`number`** property takes a number — both are freely writable by an integration. And a database/
  data-source **query supports filtering by these**: `rich_text` filter conditions include `equals`, `does_not_equal`,
  `contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`; `number` supports `equals` (and comparisons);
  `relation` is also filterable. So writing an aof ref (e.g. `17/01` or a stable id) into a `rich_text` property and later
  finding the page via `filter: { property: "<aof-id-prop>", rich_text: { equals: "<ref>" } }` is a supported round-trip.
  The read-only `unique_id` (§A4) is NOT usable for this — aof cannot write it.
- **Constraint:** This is the load-bearing fact behind the milestone's **mapping ADR** (STATE: sidecar vs external-id-on-
  page). Option (b) — **external-id property + resolve-by-query** — is technically feasible and keeps aof stateless, BUT
  it requires a **writable `rich_text`/`number` property to exist on the board's schema** (aof does not create properties
  — SPEC out-of-scope), so it adds a config requirement (name that property) and a board pre-req. Option (a) — a `.aof/`
  **sidecar** mapping file — needs no board property and works on any board, at the cost of a local file. The researcher
  reports both are buildable; the architect decides. NOTE: resolve-by-query costs an extra database-query request per
  item per sync (→ §A6 rate-limit cost), which a sidecar avoids.
- **Source:** `https://developers.notion.com/reference/property-object` (rich_text/number writable; unique_id read-only);
  `https://developers.notion.com/reference/post-database-query-filter` (rich_text `equals`/`contains`/…, number `equals`,
  relation filterable).

## §A6 — Idempotent resolve-or-create is N database-queries + create-or-PATCH, bounded by Notion's ~3 req/s rate limit

- **Finding:** "Find the page for this aof item, create if absent, update in place" maps to: **query** the database/
  data-source filtered by the identity property (§A5) → if a hit, **PATCH** that page's properties (status/title); if a
  miss, **POST** create a page (parent = database, relation = parent milestone page for a sub-task, §A3). Notion's REST
  API rate limit is an **average of ~3 requests/second per integration** (≈2,700 / 15 min), bursts tolerated; over-limit
  returns HTTP **429** `rate_limited` with a **`Retry-After`** header (seconds). Create-a-page and query are normal
  (non-batched) single-item endpoints — there is no bulk create/patch. A milestone with M stories costs roughly, per sync,
  `1 (milestone resolve) + 1 (milestone create-or-patch) + M (story resolves) + M (story create-or-patch)` ≈ `2 + 2M`
  requests if every item is resolved-by-query; a sidecar that already holds the page id skips the resolve queries (≈ `1 +
  M` patch/create only).
- **Constraint:** The sync must (a) handle **429 + `Retry-After`** (back off, never hammer) and pace itself to ~3 req/s —
  a real factor for a milestone with many stories; (b) the `@executable` arch-tests can assert plan/structure with the CLI
  STUBBED, but the live rate-limited round-trip against a real workspace is `@manual`. The rate-limit cost is also an
  input to the §A5 mapping ADR: **resolve-by-external-id-property roughly DOUBLES the request count** (a query before
  every write) versus a sidecar that stores the page id — so the mapping choice has a measurable sync-cost consequence,
  not just a statefulness one. There is no atomic multi-page transaction, so "never half-write" (SPEC) means the sync must
  define per-item create/update/skip semantics and a clean failure point, not rely on a rollback.
- **Source:** `https://developers.notion.com/reference/request-limits` (~3 req/s average, 429 `rate_limited`,
  `Retry-After`); `https://developers.notion.com/docs/working-with-databases` (create-a-page, query endpoints — single-item).

## §A7 — API version 2025-09-03 routes queries through `data_source_id`, not `database_id` (a config-shape constraint)

- **Finding:** Notion's current API version **`2025-09-03`** introduced multi-source databases: a "database" is now a
  container that can hold multiple **data sources**, and the query endpoint moved from `/v1/databases/:id/query` to
  **`/v1/data_sources/:id/query`** — the new query/create APIs take a **`data_source_id`**, not a bare `database_id`.
  Retrieving a multi-source database returns a `data_sources` array (each `{ id, name }`); apps must add a discovery step
  to fetch and store the `data_source_id`. `ntn api` sets the `Notion-Version` header itself, so the CLI pins a version —
  but the path/id the milestone uses must match that version. The bash-CLI candidates (e.g. nitaiaharoni1) advertise API
  version `2025-09-03`, and `4ier/notion-cli` has an open issue to migrate its `db` surface to `data_sources` — i.e. this
  is a live, breaking distinction across the ecosystem.
- **Constraint:** The `work.integrations.notion` config block should name a **`data_source_id`** (not just a
  `database_id`) for the board's task database — or aof must do the database→data-source discovery step before querying/
  creating. Either way the architect must decide which the config captures; assuming the legacy `database_id` query path
  will break on a multi-source board. This also pins a **`Notion-Version`** the sync targets (whatever `ntn`'s bundled
  version sends) — a versioned dependency the doctor/auth-reachability check should be aware of.
- **Source:** `https://developers.notion.com/docs/upgrade-guide-2025-09-03` (databases→data_sources, `/v1/data_sources/:id/query`,
  discovery step); `https://github.com/4ier/notion-cli/issues/39` (migrate `db` surface to 2025-09-03 data_sources).

## §A8 — The realistic alternatives to `ntn` (fallbacks), surveyed

- **Finding:** Live `npm view` of the field, this host 2026-06-25:
  - **`ntn`** — `0.17.0`, MIT, `bin: ntn`, official (Notion-maintained), node/npm, Windows x64. (§A1) **← recommended.**
  - **`@coastal-programs/notion-cli`** — `6.4.1`, MIT, `bin: { "notion-cli": "bin/notion-cli.js" }`, created 2025-10-26,
    **modified 2026-06-25** (actively maintained), a **single Go binary** wrapped by a thin npm installer that downloads
    the platform binary; cross-platform incl. **Windows amd64**; described "Unofficial Notion CLI optimized for automation
    and AI agents … structured error handling". Auth via **`NOTION_TOKEN`** env (also OAuth `auth login`); every command
    has **`--output json`** with a `{success,data,metadata}` envelope; documents `db query --filter`, `page create
    --database-id --properties`, `page update <id> --properties` (status/select/rich_text via the properties JSON). **This
    is the strongest fallback** — purpose-built for non-interactive automation, cross-platform, structured JSON. Note it
    is the **`npx` lane** too (npm wrapper / Go binary), and its env var is `NOTION_TOKEN`, not `NOTION_API_TOKEN`.
  - **`@litencatt/notion-cli`** — `0.15.6`, MIT, `bin: { "notion-cli": "bin/run" }`, modified 2025-11-01 (oclif-based,
    node). Viable but less automation-focused than the two above and less recently active; treat as a third option.
  - **`notion-cli`** (bare name) — `0.0.0`, MIT, `unpackedSize 1483` bytes — an **empty placeholder**, NOT usable.
    Disqualified.
  - **`@notionhq/client`** — `5.22.0`, MIT — the official Notion **API SDK (a library, not a CLI)**. Relevant only as the
    base for a *first-party thin wrapper script* if no CLI were adequate; not itself a head-less CLI.
  - Non-npm: a Go CLI **`4ier/notion-cli`** ("full API coverage in a single binary") and a **pure-bash** CLI
    (`nitaiaharoni1/notion-cli`, "bash + curl + python3", API `2025-09-03`) exist; neither is an npm/PyPI package so
    neither fits a milestone-12 `npx`/`uv` provider lane cleanly (they'd need a third install lane — the registry is
    extensible but the milestone scopes Notion-only, no new lane unless forced).
- **Constraint:** A CLI IS adequate — no first-party wrapper script over `@notionhq/client` is needed (so the "no
  existing CLI is adequate" branch does NOT apply). The architect's pick is between **`ntn`** (first-party, official,
  Notion's own auth convention `NOTION_API_TOKEN`, but heavy Node 22+ floor and the npx-lane/store mismatch of §A1) and
  **`@coastal-programs/notion-cli`** (purpose-built for automation, cleaner `--output json` envelope, but unofficial and
  env var `NOTION_TOKEN`). Both are npm/`npx`-lane; neither uses the `uv` lane. Whichever is chosen, the milestone-12
  descriptor's `packageSpec` ≠ `binaries[]` rule applies (`ntn` → bin `ntn`; `@coastal-programs/notion-cli` → bin
  `notion-cli`).
- **Source:** `npm view ntn / @coastal-programs/notion-cli / @litencatt/notion-cli / notion-cli / @notionhq/client`
  (version, license, bin, time.created/modified — this host, 2026-06-25);
  `https://github.com/Coastal-Programs/notion-cli` (Go binary, `NOTION_TOKEN`, `--output json`, cross-platform Windows
  amd64, v6.4.1, MIT); `https://github.com/4ier/notion-cli`, `https://github.com/nitaiaharoni1/notion-cli`.

---

## Recommendation (for the architect's ADRs)

**Q1 — which Notion CLI (the milestone-12 descriptor).** Recommend the **official `ntn` CLI**, pinned at **`0.17.0`**
(latest on 2026-06-25), provider lane **`npx`** (it is a node/npm package — NOT the `uv` lane). Descriptor sketch
(`12/ARCHITECTURE ADR-002` shape):
`{ name:"notion", provider:"npx", packageSpec:"ntn", version:"0.17.0", binaries:["ntn"],
   platforms:{ win32:{ supported:true, note:"x64 only (no win32-arm64); requires Node 22+ / npm 10+" } } }`.
The decisive trade-off the architect must weigh: `ntn` is first-party + MIT + Notion's own `NOTION_API_TOKEN` auth
convention, but it lands in the **`npx` lane that milestone-12 did NOT wire into the version-keyed `~/.aof/tools/` store**
(`12/ADR-002`: the npx lane keeps the npx scope model). So "provisioned into the managed store, version-pinned, resolved
store-first" (SPEC's promise) is NOT free for an npx-lane tool the way it is for the uv-lane Python tools — the architect
must decide whether to (i) extend the npx lane to the store, (ii) add it as a doctor-checked npx global, or (iii) — if a
store-resident, self-contained binary matters more than first-party status — pick the **fallback `@coastal-programs/notion-cli`
`6.4.1`** (a single Go binary, `--output json`, `NOTION_TOKEN`), which is purpose-built for automation but unofficial.
**Fallback: `@coastal-programs/notion-cli@6.4.1`** (npx lane, bin `notion-cli`). Either way the live binary round-trip is
`@manual`.

**Q2 — auth model.** Recommend the **internal integration token supplied via an environment variable** — for `ntn` that
is **`NOTION_API_TOKEN`** (Notion's own head-less convention; for the fallback it is `NOTION_TOKEN`). The
`work.integrations.notion` config block holds the env-var **name**, never the secret; the sync passes it through to the
spawned CLI. Set **`NOTION_KEYRING=0`** to keep `ntn` off the OS keychain in head-less/CI contexts. **Reject OAuth**
(`ntn login`) for this milestone — it needs interactive browser consent + a per-host keychain, defeating the head-less,
hook-runnable requirement (`SPEC §CLI-not-MCP`).

**The two facts that most constrain the architect's mapping / auth ADRs:**
1. **§A4 — status options are board-defined and the API can only set EXISTING ones.** aof's four statuses MUST map to the
   board's existing option names via a config-supplied map (esp. `in-review`, which has no Notion default), and the sync
   must fail honestly when a mapped option is absent. This is non-negotiable for the projection ADR.
2. **§A5 + §A6 — resolve-by-external-id-property is feasible (rich_text/number is writable and filterable) but roughly
   DOUBLES the request count** (a query before every write) vs a `.aof/` sidecar that stores the page id, and requires a
   writable id property to pre-exist on the board (aof never creates properties). That cost + board-prereq is the
   load-bearing input to STATE's sidecar-vs-external-id mapping ADR.

Adjacent constraints the architect should carry: **§A7** (config names a `data_source_id`, not a bare `database_id`, for
the 2025-09-03 API), **§A3** (config names the self-relation property; milestone + stories must share one database), and
**§A1** (npx lane + Node 22+ / Windows-x64-only platform note in the descriptor).
