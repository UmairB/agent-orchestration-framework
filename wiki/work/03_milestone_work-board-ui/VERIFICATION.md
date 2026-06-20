---
doc: verification
ref: "03"
verified: 2026-06-20
verdict: accepted
---
# 03 · Work Board UI — Verification

Verification lanes in scope: **`@executable`** (CI), **`@manual`** (agent/developer-run, recorded
here as evidence), and **`@uat`** (human sign-off — QA's lane, pending). This file currently records
story 02 (the agent terminal) evidence; story 00/01 `@executable` coverage lands via the central
runner (`scripts/test.mjs` / `scripts/test-unit.mjs`) and the `board-api` suite.

## @manual evidence

- **A2 — `node-pty@1.1.0` bundled win32-x64 prebuilt loads and forks a real PTY on this machine/Node
  (RESEARCH §2 build-time confirmation): PASS.**
  - **Procedure:** after `npm install` (root added `node-pty@1.1.0` + `ws@^8`), ran a `pty.spawn`
    smoke from the repo root on this host (win32-x64, Node >=20):
    ```
    node --input-type=module -e "import * as pty from 'node-pty';
      const p = pty.spawn('cmd.exe', ['/c','echo aof-pty-smoke'],
        { name:'xterm-256color', cols:80, rows:24, cwd:process.cwd(), env:process.env });
      let out=''; p.onData(d=>out+=d);
      p.onExit(({exitCode})=>{ const ok = out.includes('aof-pty-smoke');
        console.log('echo:',ok,'exitCode:',exitCode); process.exit(ok?0:1); });"
    ```
  - **Result:** `spawned pid: 45696` · `onData saw echo: true` · `onExit exitCode: 0` →
    **A2 SMOKE: PASS**. The bundled `prebuilds/win32-x64/pty.node` loaded with no node-gyp / VS Build
    Tools, forked a child, streamed data, and exited cleanly. (No blocker; RESEARCH predicted this.)
  - verifies → `00_run-agent-terminal.feature` `@manual` "pressing Run agent spawns the chosen
    provider bound to the item's directory" (the dock reaching `running` is impossible if the prebuilt
    does not load — A2 is its precondition).

- **A7 — real provider present/missing on this machine (RESEARCH §7 honest-degrade): PASS (agent-run
  at `aof:verify`, 2026-06-19).**
  - **Procedure (missing half — the real end-to-end path, NOT the stubbed unit test):** stood up the
    production server (`serveSetupUi` → `attachTerminalWebSocket`, **no stub `which`/`spawn`**) on a
    127.0.0.1 ephemeral port, then modelled "a machine without the provider" by emptying `PATH`/`Path`
    so the real `defaultWhich` (PATHEXT-aware) resolves nothing, and opened a real `ws` client to
    `/ws/terminal?ref=03&provider=claude`.
  - **Result (missing):** the server replied with the real control-frame
    `{"type":"error","message":"claude CLI not found — install it or pick another provider."}`,
    streamed **0 raw bytes** (no session ran, no faked success), closed cleanly, and **did not crash**:
    a fresh HTTP `GET /api/work/list` immediately after returned `200` with the 22-item flat array →
    board + server remain usable. **A7 missing: PASS.**
  - **Procedure + result (present half):** `resolveProvider(id).resolveBinaryPath(process.env)` against
    the real PATH resolved all three providers — `claude → …\claude.EXE`, `codex → …\codex.CMD`,
    `gemini → …\gemini.CMD`, each `validatePrerequisites=true` — so on this machine the server takes the
    **spawn** path (not the error path) for every provider. The full interactive "reaches `running`
    with live echo" overlaps the A4 `@uat` live lane below (it spawns an interactive agent CLI).
  - verifies → `01_provider-picker-and-missing.feature` `@manual` "on a machine without the chosen
    provider installed the dock shows the real error state" (PASS, executed) + "on a machine with the
    chosen provider installed Run agent reaches running" (precondition PASS — binary resolves; live
    confirmation is A4 `@uat`).

## Design conformance (story 01 board surface — code-vs-mock, no served URL)

`aof-designer` compared the built React surface (`ui/src/board/*`) to `DESIGN.md`'s mockups + the
per-surface binding checklists + the six Documented Defaults. **Verdict: CONCERNS** — substantially
conformant (composition, status ramp + on-screen legend, segmented toggles, action subordination,
terminal connection-state ramp, dark-on-light dock, and the binding **no-drag-to-restatus** constraint
all implemented as specified); two minor design-gaps logged below (DG-1, DG-3). Remaining
conformant-notes (DG-2 not-started muted-outline override, DG-4 composer `refs` field, DG-5 collapse
tears down a running session, DG-6 pointer-events resize instead of dnd-kit) were judged acceptable —
not findings. This is *inferred* render fidelity; true rendered fidelity (Playwright screenshot vs
mock) awaits a served base URL.

### Re-check against the reworked surface (2026-06-20, `aof:verify 03/01`)

The §1 board was reworked 2026-06-20 to the two-level card/lanes model, so the review above (against
the OLD single-tree surface) was re-run by `aof-designer` against the current code (`ui/src/board/*`)
— still **code-vs-spec** (no served URL/Playwright; the referenced `Work Board.dc.html` mock is an
external claude.ai/design artifact, so the judge is DESIGN.md's prose + ASCII wireframes + binding
checklists + the six Documented Defaults). **Verdict: CONCERNS** — substantially conformant. Confirmed
conformant on the reworked surface (cited): the **glyph-ring status ramp** as a single source emitting
ring + chip + dot (`status.tsx`) with the top-bar legend (`Board.tsx`); **VIEW 1** 3-col milestone
grid + card anatomy + the **honest progress bar** (teal reserved for `done`/accepted, in-progress
remainder a muted non-teal shimmer, not-started a flat empty track — `Overview.tsx:158-176`) + summary
chips + the uat-only Acceptance-gates strip; **VIEW 2** five derived lanes with sticky count headers,
red-tinted blocked lane, breadcrumb + milestone switcher, selected-card border/shadow/tint, empty
placeholder, and **no drag-to-restatus** (plain buttons, no dnd-kit status mutation — Documented
default 5 / ADR-004); **§2** the **type-aware doc switcher** (milestone SPEC·VERIFICATION·RETROSPECTIVE·
Findings; story STORY·TASKS; uat Findings), markdown body with frontmatter/comments stripped, absent-doc
= dashed placeholder not error, no-selection prompt; **§3** inline (not-toast) validate/next results and
the collapse-on-success feedback composer. Two non-blocking design-gaps logged below — **DG-1**
(carried, Findings count) and **DG-7** (new, the actions-strip Validate/Next emphasis is inverted). No
*design* blocker is open.

## User sign-off

- **A4 — end-to-end live agent stream (`@uat`): PASS — operator sign-off (2026-06-20, `aof:verify 03`).**
  - **Procedure (brokered, human-performed):** with the operator's `aof work board` server already live
    on `127.0.0.1:4180` (the port-in-use probe at this verify confirmed a board server running), the
    operator opened `http://127.0.0.1:4180/?mode=board`, selected an item, picked provider **claude**, and
    pressed Run agent / Verify — then walked all five `@uat` scenarios of
    `00_run-agent-terminal.feature` against the DESIGN §4 connection-state ramp.
  - **Result:** **all five passed.** (1) the dock walked **idle → connecting → running** with the agent's
    output painting in the xterm viewport; (2) **keystrokes echoed** in the viewport and reached the agent;
    (3) **dragging the dock taller reflowed** the output with no clipped/mis-wrapped lines; (4) a clean
    finish showed **exited (code 0)** with scrollback retained + a restart affordance; (5) a non-zero
    finish showed **exited (1)** read as a failure, distinct from the clean exit. No defect observed.
  - **Sign-off:** operator (the work-stream's developer/operator) — *"All 5 passed — sign off."*
  - verifies → `00_run-agent-terminal.feature` `@uat` scenarios (idle→connecting→running + output visible;
    keystroke echo; resize reflow; exited(0) + scrollback + restart; exited(non-zero) distinct).

## @manual resolved (recap)

- **A2** (`pty.spawn` smoke) **PASS**, **A7** (real provider present/missing) **PASS**, story-01
  rendered-UI **resolved** — all recorded above (`## @manual evidence`, `## @uat / @manual pending`
  history). No `@manual`/`@uat` lane remains open.
- **A7 — a present/missing provider on a real machine (`@manual`). RESOLVED above (PASS).** The
  missing-provider end-to-end path was executed against the real server (dock error state, board+server
  stay up); all three providers resolve present on this machine. The only residual — a present provider
  visibly reaching `running` with live echo — folds into the A4 `@uat` live lane (it is the same live
  spawn).
- **Story 01 rendered board UI (`@manual`). RESOLVED (2026-06-20, `aof:verify 03/01`) — operator
  observation of the live board.** These are developer-run `@manual` scenarios (run the served board,
  observe the rendered surface), NOT a `@uat` human-acceptance gate. The board is now servable
  same-origin (F-1 resolved → `aof work board`), and the agent confirmed it **live**: with `aof work
  board` already running on this host, `GET http://127.0.0.1:4180/api/work/list` returns the real
  22-item flat contract and `GET /?mode=board` serves the **built** bundle (references
  `/assets/index-I6trLFhm.js`, **not** the vite-only `/src/main.tsx`) on the one 127.0.0.1 origin — so
  the relative `api.ts` fetches and the `window.location.host` WS both resolve (the runtime proof of
  ADR-001 / task 05). On top of that served surface, the **operator (the work-stream's developer/operator)
  reports having exercised the live board over an extended session and confirms the rendered behaviour
  works** — the grid/lanes render, selection drives the detail panel, the type-aware doc switcher and
  markdown bodies render, and the feedback/validate/next actions behave as specified. Playwright is not
  installed on this host, so the agent could not independently drive the DOM; the rendered lane is closed
  on the operator's first-hand observation against the live build (the `@manual` developer-observation
  path), with the server-side contract independently green via `board-api` (below).
  verifies → `00_board-renders-stream.feature` (overview grid, honest progress bar, drill-into-lanes,
  derived bucketing, select→detail, switcher/breadcrumb, empty-milestone, loading/empty/error);
  `01_detail-shows-records.feature` (type-aware tabs, header, markdown body, absent-doc placeholder,
  Findings empty, milestone-default→story swap); `02_add-feedback.feature` (inline composer,
  collapse+confirm, error keeps note); `03_validate-stream.feature` (inline no-issues / finding rows
  persist / error line); `04_next-item.feature` (ready+reveal / blocked line / "stream complete" / error
  line); `05_serve-board-same-origin.feature` `@manual` (the printed URL renders the built board, not the
  assets editor — confirmed at the server level by the live :4180 same-origin probe above).

## @executable evidence (stories 00–01 — the CLI stream + the board API)

Green via the central runner (`scripts/test.mjs` / `scripts/test-unit.mjs`) and the new modules:

- **`test/work-list.test.mjs`** — 14 ok. `aof work list --json` emits the whole stream as a flat array
  (one element/item, pure JSON, no chrome, byte-stable, empty→`[]`); each item carries the seven
  contract fields; `parent` links resolve; every type emitted. Human listing: readable, depth-indented,
  scope-narrowed, empty-scope line, json↔human parity.
  verifies → `00_list-json-contract.feature` + `01_list-human-output.feature` (`@executable`).
- **`test/board-api.test.mjs`** — 19 ok (real `serveSetupUi` server + `fetch`). `/api/work/list` serves the
  flat contract; `/api/work/doc` returns a body / reports absent-not-error; `/api/work/feedback` appends one
  attributed bullet (verbatim heading, refs verbatim, append-not-overwrite, only-STATE.md-changes,
  milestone+story routes); `/api/work/validate` returns findings / clean→empty / scoped / changes-no-files;
  `/api/work/next` returns ready/blocked/done + waitingOn / changes-no-files.
  verifies → `00_board-renders-stream.feature` (`@executable` list endpoint) + `01_detail-shows-records`,
  `02_add-feedback`, `03_validate-stream`, `04_next-item` (`@executable` endpoint scenarios).
- **Fitness functions — green.** `acd-work-list-contract` (3 ok: flat-array-not-tree; exactly the seven
  keys; `parent` resolves) and `acd-board-write-isolation` (4 ok: the sole fs-write targets STATE.md's
  feedback heading; no status/frontmatter write, no restatus route; validate/next in-process, no shell-out;
  behavioural — feedback POST changes only STATE.md).
  verifies → ARCHITECTURE.md `## Fitness functions` (ADR-002, ADR-004).

## @executable evidence (story 02 — the agent terminal)

The story's `@executable` (protocol-shape + server) scenarios are green via the new test modules
(run headlessly, no real PTY, no browser):

- **`test/terminal-dock.test.mjs`** — 13 ok / 0 not-ok. Exit-control-frame → dock state (0→clean,
  1→failure, 130→failure); provider picker exactly-one-selected default + every selection-outline row;
  fit→exactly-one-resize (80×24, 120×30, 200×50).
  verifies → `00_run-agent-terminal.feature` (exit-state outline, fit-resize outline) +
  `01_provider-picker-and-missing.feature` (exactly-one-selected, selection outline).
- **`test/terminal-ws.test.mjs`** — 9 ok / 0 not-ok (injected stub spawn + stub PATH; real `ws`
  upgrade handshake against `serveSetupUi`). The selected provider is the CLI that runs (claude/codex/
  gemini → that provider's resolved binary, cwd = item dir); a stubbed-absent binary → `{type:'error'}`
  control-frame, no session runs, never exit(0), server keeps serving (second WS + HTTP both succeed);
  a missing provider never fakes success and never crashes (server still listening).
  verifies → `01_provider-picker-and-missing.feature` (selected provider is the CLI run; absent binary →
  error + server up; never-fake-success / never-crash).
- **Fitness functions — green.** `acd-terminal-server-only` (3 ok: node-pty+ws are root deps, not
  `ui/`; no node-pty under `ui/src`; browser dock imports only `@xterm/*`); `acd-vibeyard-attribution`
  (7 ok: the vibeyard+MIT notice on each adapted file + the repo NOTICE surface);
  `acd-board-single-server` (4 ok: exactly one `http.createServer`; terminal via `server.on('upgrade')`
  + `noServer` routing only `/ws/terminal`; disjoint `/api/work*` ↔ `/ws/` namespaces; behavioural —
  `/api/work/list` JSON + static GET + `/ws/terminal` handshake all on the same port).
  verifies → ARCHITECTURE.md `## Fitness functions` (ADR-001, ADR-003).

## Findings

- **F-1 — No delivered launch path serves the board same-origin, so `/ws/terminal` (the headline agent
  terminal) cannot connect under the provided serving — blocks the A4 `@uat` / rendered-terminal lane.**
  - *observed:* the board's WS URL is built from `window.location.host`
    (`ui/src/board/TerminalDock.tsx:322`) and the API calls are same-origin relative paths
    (`ui/src/board/api.ts:38,71`), so both must be served from one origin that routes `/api/work*` AND
    `/ws/terminal`. But (a) the only UI launcher, `aof assets ui`, starts **vite** whose proxy forwards
    only `/api` — **no `/ws` key and no `ws:true`** (`ui/vite.config.ts`) — and hardcodes
    `VITE_AOF_UI_MODE=assets` (`src/cli.mjs:1200`), so the terminal WS (to vite's port) never reaches the
    API server; and (b) `serveSetupUi`'s static root is `repoRoot/ui` (`src/setup-ui.mjs:18`), which
    serves the **dev** `ui/index.html` → `/src/main.tsx` (TS source, vite-only), not the built
    `ui/dist` bundle — so serving the board *same-origin* via `serveSetupUi` (which DOES route
    `/ws/terminal`, proven by the A7 harness above and `acd-board-single-server`) is not wired.
  - *type:* integration / launch gap · *severity:* **blocker (for the `@uat` acceptance lane, not for the
    terminal code itself** — the protocol suite, A2 smoke, and the A7 end-to-end same-origin run are all
    green).
  - *triage (PO):* blocker → fix before A4 can be performed. Cheapest path: add `"/ws": { target:
    <api>, ws: true }` to the vite proxy and open the board at `?mode=board` (unblocks the dev UAT); the
    durable path is a first-class board launcher that serves `ui/dist` same-origin through `serveSetupUi`
    (one origin → `/api/work*` + `/ws/terminal` + static, no proxy). Either is a small change.
  - *routed-to:* `aof:continue` as a `@bug` (+ `@finding-F1`) — the board needs a working same-origin
    launch path. *status:* **RESOLVED (2026-06-19, `aof:continue 03`).** Fixed by the new `aof work
    board` command + `serveBoard()` (`src/board-serve.mjs`) serving the BUILT `ui/dist` through the one
    `serveSetupUi` server — `/api/work*` + `/ws/terminal` + bundle on one 127.0.0.1 origin (ADR-001
    intact; no second server/port). Pinned by story-01 task `05_serve-board-same-origin.feature` (4
    `@executable` scenarios green) + verified end-to-end against the real build (`/` → built index, not
    `/src/main.tsx`; bundle asset 200; `/api/work/list` 22 items; `/ws/terminal` handshake OPEN — all same
    origin). Architect review PASS-with-concerns; the two confirmed fixes applied (honest `EADDRINUSE`
    degrade; `work board` default port 4180 vs the 4177/4178 `assets ui` collision). **The A4 `@uat` lane
    is now performable via `aof work board`.**

From the design-conformance review (`aof-designer`, code-vs-mock). Both **non-blocking** (minor); no
*design* blocker is open (F-1 above is an integration blocker, not a design gap).

- **DG-1 — Findings-tab count is static plain text, not a dynamic `Badge`.**
  - *observed:* the Findings tab label is hardcoded `"Findings (0)"` (`ui/src/board/DetailPanel.tsx:111`)
    — the count never reflects real findings and is not wrapped in the `Badge variant="secondary"` the
    design names.
  - *type:* design-gap · *severity:* minor.
  - *triage (PO):* design-gap — the DESIGN rule already stands (§2: count = secondary `Badge`,
    dynamic); the render fix lands naturally with the already-routed **populated-findings** refine task
    (see STATE `## Feedback (for retro)`), so no new DESIGN edit is required.
  - *routed-to:* `aof:refine 03` (the populated-findings task) → developer. *status:* open (deferred,
    non-blocking).
- **DG-3 — `Next` button shares the `secondary` variant with `Validate`; DESIGN says it should read
  "primary-ish, subordinate to Run-agent".**
  - *observed:* `Next` is `variant="secondary"` (`ui/src/board/ActionsStrip.tsx:95`), identical to
    `Validate` (`:102`), distinguished only by icon + position — flattening the intended emphasis tier
    Run-agent > Next > Validate. (Default 6's headline constraint — Run-agent is the single most
    prominent — IS honoured.)
  - *type:* design-gap (a genuine doc↔build contradiction) · *severity:* minor.
  - *triage (PO):* design-gap — `aof-designer` sets the DESIGN rule first: pick the canonical `Next`
    treatment (either bump to `default` at `size="sm"` to stay subordinate to the full-size Run-agent,
    or amend Default 6 to state `Next` is `secondary` differentiated by icon+position). Then the build
    conforms.
  - *routed-to:* `aof-designer` (DESIGN.md clarification) → developer. *status:* open (non-blocking).
  - *update (2026-06-20):* the board §1 was reworked to the two-level card/lanes design; the
    `ActionsStrip` was restyled (Next is now its own button). Re-check DG-1/DG-3 against the new surface
    at the next design-conformance pass.
  - *re-check disposition (2026-06-20, `aof:verify 03/01`):* **CHANGED — not resolved; mutated into
    DG-7.** The rework did split Validate/Next into distinct variants (the old "shared `secondary`"
    symptom is gone), but in the wrong direction: Validate is now teal/primary and Next is outline (see
    DG-7). The underlying rule (Run-agent > Next > Validate) is now violated more directly, so DG-3 is
    superseded by **DG-7** below. *status:* closed-as-superseded.

- **DG-1 re-check (2026-06-20, `aof:verify 03/01`): STILL-OPEN (unchanged by the rework), minor,
  non-blocking.** The Findings tab label is still a hardcoded string `"Findings (0)"`
  (`ui/src/board/DetailPanel.tsx:169`) — neither dynamic nor the `Badge variant="secondary"` the design
  names; the rework only relocated the line (and it now also shows on the uat Findings tab). Correctly
  does **not** fabricate a count — the real count is gated on the superseding ADR-002 contract extension
  (F-2). *status:* open (deferred behind F-2; render as `Badge variant="secondary"` when the count lands).

- **DG-7 — the actions strip inverts the Validate/Next emphasis tier (Validate is loud teal/primary,
  Next is a quiet outline) — the inverse of DESIGN §3 + Documented default 6.** (Raised 2026-06-20,
  `aof:verify 03/01` design-conformance re-check; supersedes DG-3.)
  - *observed:* in `ui/src/board/ActionsStrip.tsx`, **Validate** is `bg-primary … text-primary-foreground`
    (teal/primary, `:92`) while **Next** is `border border-input bg-background` (outline/quiet, `:100`)
    and Add feedback is also outline (`:84`). DESIGN §3 (lines 264-267, 278) + Documented default 6 say
    **Validate = `secondary`** (neutral) and **Next = primary-ish, subordinate to Run-agent** — so the
    build makes Validate the strip's headline and Next the quietest button, the inverse of the intended
    `Next > Validate` order. The file's own header comment (`:1-5`) states "✓ Validate (teal)",
    confirming the build deviated knowingly from the durable spec. (The top-tier constraint — Run-agent
    the single most prominent action — *is* honoured: Run-agent is full-size teal in the detail header,
    the strip buttons are smaller; what's broken is the within-strip ranking.)
  - *type:* design-gap (a true doc↔build contradiction) · *severity:* minor (cosmetic emphasis; behaviour
    unaffected, Run-agent prominence intact). *Verified directly against the code at `aof:verify`.*
  - *triage (PO):* design-gap — the DESIGN rule already stands and is unambiguous (Validate `secondary`,
    Next primary-ish subordinate to Run-agent), so no DESIGN edit is needed; the build must conform. Fix:
    in `ActionsStrip.tsx` swap the variants so the strip reads Run-agent > Next > Validate — make **Next**
    the primary-ish button (teal at `size="sm"` so it stays subordinate to the full-size header Run-agent)
    and **Validate** the neutral `secondary`/grey button; keep Add feedback `outline`; align the
    file-header comment.
  - *routed-to:* `aof:continue 03` (developer) — small CSS-class change. *status:* **RESOLVED**
    (2026-06-20, `aof:continue 03` review gate). `ActionsStrip.tsx` now renders **Validate** as the
    neutral `secondary` button and **Next** as a primary-tinted subordinate (border-`primary/40`,
    `bg-primary/5`, `text-primary`) at `size`-strip scale, with Run-agent (detail header, full teal) the
    single headline — the DESIGN §3 / Documented-default-6 order Run-agent > Next > Validate. The fix is
    part of this milestone's acceptance commit; the file-header comment was aligned.

- **F-2 — the approved redesign wants per-item data the frozen `work list --json` contract (ADR-002)
  does not carry; rendered honestly (omitted/softened), but full fidelity needs a superseding
  contract extension.** (Raised during the 2026-06-20 visual rework.)
  - *observed:* the card/lanes design calls for (a) **task counts** per milestone ("N tasks"),
    (b) the acceptance gate's **"waiting on X"** (a `depends` edge), (c) the detail **Findings count**
    and structured **Objective/Acceptance/Records**. The contract's 7 fields
    (`ref,type,slug,status,title,parent,dir`) carry none of these. The build renders from real data and
    **degrades honestly** — task counts omitted; gate "waiting on" best-effort from `/api/work/next`
    (absent in the current seed, so the gates strip doesn't render); Findings stays `0/none`;
    Objective/Acceptance/Records are best-effort-parsed from the doc markdown. Nothing is faked.
  - *type:* contract/enhancement · *severity:* non-blocker (the surface works; these are fidelity gaps).
  - *triage (PO):* to reach full design fidelity, extend the read model via a **superseding ADR-002**
    (e.g. add per-milestone `taskCount`/child tallies + a `depends`/`waitingOn` field, or a small
    sidecar endpoint) — an architecture decision, not an ad-hoc field. Subsumes DG-1 (Findings count).
  - *routed-to:* `aof:refine 03` → `aof-architect` (contract extension) then developer. *status:* open
    (deferred, non-blocking).
  - *update (2026-06-20):* the **tasks** part is now surfaced — a read-only `GET /api/work/tasks?ref=`
    endpoint parses each story's `tasks/*.feature` (lightweight Gherkin parser, no new dep) and the
    story detail panel gained a **TASKS** tab (Feature title + scenarios + `@executable`/`@manual`/`@uat`
    lane chips + counts). Doc bodies now render as **markdown** (`marked`). Residual F-2 gaps:
    per-milestone task *roll-up counts*, the gate `depends`/`waitingOn` on the list contract, and the
    **Findings count** (DG-1) — still want the superseding ADR-002 extension.

## Accept decision

**Story 01 (`work-board`) — ACCEPTED (2026-06-20, `aof:verify 03/01`).** All of story 01's lanes are
satisfied: the full `@executable` suite is green (the `board-api` suite — list / doc / feedback / tasks /
validate / next — plus `board-serve` same-origin and `work-list`; **636 ok / 0 not-ok** in the central
runner) and all three of story 01's fitness functions pass (`acd-work-list-contract` ADR-002,
`acd-board-write-isolation` ADR-004, `acd-board-single-server` ADR-001); the rendered `@manual` lane is
closed by **operator observation of the live board** (served same-origin on `127.0.0.1:4180`, built
bundle confirmed by the agent) — story 01 carries **no `@uat`** scenario, so no human-acceptance gate
applies to it; the design-conformance re-check against the reworked surface is **CONCERNS** with only
**non-blocking** design-gaps (DG-1 Findings-count deferred behind F-2; DG-7 Validate/Next emphasis,
routed to `aof:continue 03`). `aof work validate 03/01` = **PASS**. No blocker finding is open. →
`STORY.md` set `status: done`; ticked in `SPEC.md` `## Stories`.

---

**Milestone 03 — ACCEPTED (2026-06-20, `aof:verify 03`).** All three stories are `done` (00, 01, and now
**02 `agent-terminal`**, accepted on this run). Every lane is satisfied: the full `@executable` suite is
**green (636 ok / 0 not-ok)** with all **five fitness functions** green (`acd-work-list-contract`,
`acd-board-write-isolation`, `acd-board-single-server`, `acd-terminal-server-only`,
`acd-vibeyard-attribution`); the `@manual` lanes are PASS (A2 `pty.spawn` smoke; A7 real provider
present/missing; story-01 rendered UI); and the milestone's **one** `@uat` gate — story 02's **A4 live
agent-stream** — was **signed off by the operator** ("All 5 passed": idle→connecting→running with live
output, keystroke echo, resize reflow, exited(0) with scrollback+restart, exited(≠0) distinct — see
`## User sign-off`). `aof work validate 03` = **PASS** (+ test-traceability and litmus hold). **No
blocker finding is open.** Story 02 → `STORY.md status: done`, ticked in `SPEC.md ## Stories`; milestone
→ `SPEC.md status: done`; `STATE.md` compacted; `RETROSPECTIVE.md` distilled (the run was not clean —
F-1 was a blocker + carry-over feedback). **DG-7** (Validate/Next emphasis) was **resolved** at the
2026-06-20 `aof:continue 03` review gate — the `ActionsStrip.tsx` fix is part of this acceptance commit.
The remaining non-blocking items ride along as deferred backlog — **DG-1** (Findings count, deferred
behind F-2) and the **F-2** contract extension — none gate acceptance.

*(historical — interim milestone verdict, 2026-06-20: NOT YET ACCEPTED, stayed `in-progress` after
story 01 was accepted, pending story 02's A4 `@uat` human sign-off — now satisfied above.)*

*(historical — milestone-level verdict, 2026-06-19, `aof:verify 03`; F-1 resolved via
`aof:continue 03` same session, the `@uat` lane now unblocked):*

Everything agent-runnable is green: the full `@executable` suite (611 unit + integration) and all five
fitness functions (`acd-work-list-contract`, `acd-board-write-isolation`, `acd-terminal-server-only`,
`acd-vibeyard-attribution`, `acd-board-single-server`); the A2 `pty.spawn` smoke; the A7 missing-provider
path executed end-to-end against the real server (real error control-frame, server stays up) with all
three providers resolving present; and the design-conformance code review (CONCERNS — two minor
design-gaps). `aof work validate 03` = PASS.

Acceptance gate, updated:
1. ~~**Open blocker finding F-1**~~ — **RESOLVED** (see Findings). `aof work board` now serves the built
   board same-origin and the `/ws/terminal` handshake connects; A4 is performable.
2. **Pending human `@uat` sign-off (A4 live agent stream)** — STILL the milestone gate (story 02). The
   story-01 rendered-UI `@manual` scenarios are now **resolved** (operator observation of the live board,
   2026-06-20 — see `## @uat / @manual pending`), so only the A4 `@uat` (Run agent → idle→connecting→
   running→exited, with a human watching) remains. It requires the operator to run `aof work board`, open
   `http://127.0.0.1:4180/?mode=board`, and observe (ACD does not boot the app). No blocker finding is
   open; the design-gaps (DG-1, DG-7) are non-blocking and ride along.

Next step: the human `@uat` pass (checklist handed to the operator), then re-run `aof:verify 03` to
record the sign-off and accept. Retrospective deferred to the close (the run is not clean — F-1 was a
blocker + there is carry-over feedback — so `RETROSPECTIVE.md` will be warranted then).
