# ACD Build Roadmap

> **The question this document answers:** *What's the sequence of work to bring ACD fully into the
> `aof` CLI — and how does the bought planning layer plug in?*

Companion to [STATE.md](STATE.md) (where the build *is* right now). This is the plan *ahead*. Status
lives in STATE.md; the methodology lives in the rest of `wiki/`; this doc references both rather than
restating them ([philosophy.md → principle 4](philosophy.md)).

**Where this sits:** GSD is removed; the methodology is designed + documented; the distribution model
is locked (**ACD bundled in aof**, `aof work init/update` + manifest — see STATE.md); let-shield is
still proving the agent/command content. Two layers remain to build: the **planning** layer (bought)
and the **`/work`** layer (owned).

---

## 1. Planning layer — the bought planner (`pm-skills`)

ACD's `/planning` surface is **bought, not owned** ([planning.md](planning.md)). The chosen planner is
**[`phuryn/pm-skills`](https://github.com/phuryn/pm-skills)** — a native Claude Code / Codex plugin
marketplace (markdown skills + slash-commands, MIT). Its **`pm-execution`** plugin produces the
**PRD** (`/write-prd` → `create-prd` skill) that crosses the seam into `/work`.

### Recommended plugin set — pick by altitude

Install what *feeds the PRD*; skip what lives *downstream of the seam* (and pay no always-loaded
frontmatter tax for it).

| Plugin | Decision | Why |
|---|---|---|
| `pm-execution` | **Install — essential** | The only plugin with the PRD (`/write-prd`, `create-prd`, `/red-team-prd`, `/pre-mortem`). The seam producer. |
| `pm-product-discovery` | **Install — core** | Discovery: problem/assumption testing, prioritization, opportunity trees → the PRD's problem/objective. |
| `pm-product-strategy` | **Install — core** | Strategy: vision, canvases, positioning, monetization → the PRD's *why*. |
| `pm-market-research` | Install — optional | Personas, segments, market sizing → the PRD's "Target Users & Segments". |
| `pm-ai-shipping` | **Avoid** ⚠️ | Audits AI-built code (intended-vs-implemented, security/perf, shipping packet) — that is `/work`'s *owned* job (qa/security agents, `@executable`/UAT). Installing it puts two systems on the same job and blurs the seam. |
| `pm-go-to-market` | Skip | Launch altitude — after the product is built, not feeding the PRD. |
| `pm-marketing-growth` | Skip | Marketing/positioning copy — post-build, off the planning→work path. |
| `pm-data-analytics` | Skip | Operates on *live* product data (SQL, cohorts, A/B) — operational, not planning-to-PRD. |
| `pm-toolkit` | Skip | Resume/NDA/privacy/grammar utilities — off-altitude. |

> Even `pm-execution` ships sprint/OKR/user-story commands ACD should **ignore** — `/work` owns those.
> This is the eventual argument for vendoring *just the planning skills aof wants* (`create-prd`,
> `red-team-prd`, discovery/strategy) rather than whole plugins.

### Install (what `aof planning init` wraps)

```sh
<runtime> plugin marketplace add phuryn/pm-skills
<runtime> plugin add pm-execution@pm-skills
<runtime> plugin add pm-product-discovery@pm-skills
<runtime> plugin add pm-product-strategy@pm-skills
# optional: pm-market-research@pm-skills
```
`<runtime>` = `claude` or `codex` (both supported; slash-commands only execute in Claude Code/Cowork
and Codex). Manual copy of skill folders also works for other agents.

### `aof planning init` — the adapter entry

`aof` owns only the **seam**, not the planning method. `aof planning init` should:

1. Register the marketplace + install the recommended plugins above.
2. **Record provenance** so the product docs are traceable to *how they were made*:
   `{ source: phuryn/pm-skills, marketplaceVersion: 2.0.0, sha: <pinned>, plugins: [...] }`.
3. **Pin the sha** — upstream has no version pin beyond git and bumps all plugins together (single
   `2.0.0` across the marketplace), so a pinned commit is the only reproducible anchor.

### Vendor-pinned + tailored

`pm-skills` exposes **no configuration** — no settings, no output-path control, no per-plugin
versioning; customization means *fork & edit markdown* (MIT). So aof should **vendor a pinned
snapshot** of the planning skills it ships (consistent with the bundled-in-aof distribution decision)
and may tailor `create-prd` to emit ACD's seam read-out (objective / scope / milestone-sized chunks)
and a stable PRD id, instead of floating on a fast-moving upstream.

### The seam (rules in [planning.md](planning.md) — referenced, not restated)

- **Consume only the PRD.** It lands as `PRD-<name>.md` in the workspace (not a configurable path) —
  aof *discovers* it. Ignore the planner's downstream (stories/sprints/OKRs); `/work` owns delivery.
- **PO shatters PRD → milestone SPECs**, each stamping an `origin` back to the PRD + the planning
  provenance manifest.
- **One-directional: PRD → SPECs, never back.**

---

## 2. Delivery layer — the `/work` build (deferred)

The owned methodology. Gated on let-shield stabilizing the agent/command content (per STATE.md, the
user is still evaluating effectiveness there). The lift, in order — full detail in
[STATE.md → The lift](STATE.md):

1. **Bundle ACD assets** in aof (agents / commands / templates / observability hook).
2. **`aof work init`** — render into `.claude`/`.codex`, stamp `aof-generated`, write a manifest.
3. **`aof work update`** — manifest-diff re-render (how bugfixes reach users).
4. **`aof work validate`** — the traceability-spine keystone (`@executable` → green test), CI-enforceable.
5. **`aof work` scaffolding** — add-milestone/story/task, recent.
6. **Observability hook** — the session-keyed hook proven in let-shield.
7. **Round-trip proof** — init into a fresh repo → run a milestone end-to-end.

---

## 3. Open decisions

- **`aof packages` namespace fate** — kept generic for now; its only consumer was gsd and the
  bundled-ACD model doesn't use it (STATE.md).
- **PRD anchor + `origin` schema** — define the PRD's referenceable location/id and the milestone
  `origin` field; draft into [planning.md](planning.md) + [documents.md](documents.md) + the SPEC template.
- **Cross-milestone dependency** — `depends-on:` in milestone SPEC frontmatter (delivery's business,
  not the PRD's), to keep the seam one-directional.
- **Codex parity** for the ACD assets now vs claude-first.
- Where the methodology `wiki/` ships in the package.

---

## Sequence at a glance

| Phase | What | Status |
|---|---|---|
| 0 | Remove GSD (boards/SDK + planning methodology) | **done** |
| 1 | Planning layer — `pm-skills` + `aof planning init` + provenance | designed; build pending |
| 2 | `/work` layer — bundle assets, `aof work init/update/validate`, scaffolding, hook | deferred (pending let-shield) |
| 3 | Round-trip proof | pending |
