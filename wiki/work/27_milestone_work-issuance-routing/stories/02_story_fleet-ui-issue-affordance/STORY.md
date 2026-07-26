---
type: story
number: 02
slug: fleet-ui-issue-affordance
title: "The fleet-UI issue/assign affordance — the first write route on aof mesh ui (POST /api/mesh/issue) + the [assign] control; flips acd-mesh-ui-write-isolation to bounded-write; the security-lens story"
parent: 27
status: done
owner: product-owner
created: 2026-07-03
updated: 2026-07-03
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 02 · The fleet-UI issue/assign affordance — the first write route on the fleet face

## User story

As an operator at the control node's mission-control view (`aof mesh ui`),
I want to **issue / assign work into the fleet directly from the fleet surface** — an `[assign ▸]` affordance that POSTs to `POST /api/mesh/issue` (the same `mesh:issue` command the CLI uses), with a target picker for any-node / a specific node / a capability,
so that I can route work from the same screen where I see the whole fleet, without dropping to the CLI — the "issue / assign into a board from here" the PRD's control node promises (KR3, PRD §7.1).

<!-- The UI / integration join: the FIRST mutating control on the m25 read-only fleet surface. It
     deliberately relaxes m25/ADR-004's write-isolation (a pinned guard flip, not a drive-by), and it is
     the security-lens story — the first cross-machine inbound write surface. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 27 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its feature is green. The fitness functions are arch-tests
     (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_fleet-ui-issue-route.feature` `@executable` — the FIRST write route (ADR-006.1): a same-origin JSON `POST /api/mesh/issue` with a body `{ ref, to? }` reaches `invoke("mesh:issue", { ref, to }, …)` through the ONE registry door (no direct `mesh-issuance` import) and returns the directive record (200); the body's `to` rides through to the target union (`any`/`node`/`capability`, data-driven, ADR-002.3); a malformed/missing body ⇒ a coded `{ ok:false, error, code }` envelope with NO directive written, never a crash; `GET /api/mesh/status` still answers the aggregate and mutates nothing; a non-issue write method/route is still refused; a `ref-not-found` from `mesh:issue` surfaces faithfully (404-class coded error, tree byte-unchanged) and does not crash the face.
- [x] `tasks/01_issue-route-same-origin.feature` `@executable` — the CSRF / same-origin guard (SECURITY T1 / fitness S-1): a same-origin `POST` (matching `Origin`/`Sec-Fetch-Site: same-origin` + `content-type: application/json`) is ACCEPTED; a cross-origin `Origin` ⇒ REFUSED (403-class coded envelope, no directive); a no-origin form / simple-request POST ⇒ REFUSED (no directive); a same-origin non-json POST ⇒ REFUSED (no directive); the guard runs BEFORE `invoke("mesh:issue")` (a refused request short-circuits the mutation — the disk is byte-unchanged); the guard is scoped to the write route (the safe-method read route stays unguarded/unchanged). Examples over {same-origin+json ⇒ accept; cross-origin ⇒ refuse; no-origin+form ⇒ refuse; same-origin+non-json ⇒ refuse}.
- [ ] `tasks/02_assign-affordance.feature` `@uat` — the `[assign ▸]` affordance judged against the DESIGN binding checklist: on the CONTROL node the board tile renders the quiet `[⊕ assign]` trigger in its action row (state · assign · open), clicking opens the anchored target picker (Any node / a specific node / a capability, from the fleet's own roster + capabilities), submitting POSTs to `/api/mesh/issue` with a quiet in-flight then a calm success micro-ack, and a failure shows an `accent`/crimson line + Retry scoped to the tile; on a NON-control node the affordance renders NOT AT ALL (control-node-gated true absence — byte-identical to the m25 read-only tile, never greyed/disabled); the surface stays otherwise read-only (drill-in a link, presence/run ramps unchanged, no bulk-select/toolbar/action-log/modal); the six states (idle · gated-hidden · open · submitting · success · error) + the design ramp are the conformance baseline. `@uat` — the DESIGN binding checklist.
- [x] `tasks/03_write-isolation-bounded.feature` `@executable` — the bounded-write posture (the BEHAVIOURAL half of fitness #7, ADR-006.2): `POST /api/mesh/issue` is the fleet face's ONLY mutation route; every OTHER write method/route is refused (405 on the read route / not-found on `assign`·`route`·`revoke`·`/api/work/*`) with no state change and the server survives; NO `/ws/terminal` and no upgrade; NO second write route (the disjoint `/api/mesh` namespace holds); the single `127.0.0.1` server is unchanged (no second server/port); serving the read view (no issue POST) still mutates nothing.
- [x] **Fitness `acd-mesh-ui-write-isolation` #7 flip** (arch-test, ADR-006.2, SUPERSEDED in place at build) — the m25 gate's assertion moves from "the fleet face writes NOTHING and serves no write route" to a BOUNDED-WRITE shape: the ONLY mutation route is `POST /api/mesh/issue`, reaching the mutation ONLY via `invoke("mesh:issue")` (no direct `mesh-issuance`/operation import, no bare `writeFile`/`child_process` in the face), serving NO other write route and NO `/ws/terminal`; XOR/consistency-phrased (GREEN on the m25 zero-write tree OR the exactly-one-route tree; RED only in the broken half); m03 planted-violation self-check. `acd-mesh-ui-single-server` + `acd-mesh-ui-no-core-import` stay GREEN unchanged.
- [x] **Security fitness `acd-mesh-issue-route-same-origin` S-1** (arch-test, SECURITY §Security fitness / T1, RED-until-route) — source-analysis of `src/mesh-ui-serve.mjs`: the `/api/mesh/issue` branch references an `origin`/`sec-fetch` header read AND a `content-type`/`application/json` check on the SAME path that reaches `invoke("mesh:issue")`; a planted bare-`invoke`-no-guard route fails the detector; GREEN vacuously on today's m25 tree (existsSync-guarded / XOR — either no `/api/mesh/issue` route OR the route present AND carrying both guards), tightening its satisfied side when this story lands the route; m03 non-vacuous self-check.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-006** (the fleet-UI write route:
`POST /api/mesh/issue` on `src/mesh-ui-serve.mjs` → `invoke("mesh:issue")` through the ONE registry door;
it DELIBERATELY relaxes m25/ADR-004's read-only posture, flipping EXACTLY `acd-mesh-ui-write-isolation` to a
bounded-write shape while `acd-mesh-ui-single-server` / `acd-mesh-ui-no-core-import` stay green; the route is
bounded at three edges — loopback same-origin `127.0.0.1`, control-node framing via `isControlNode(config)`,
the m24 credential/trust boundary — and its threat model is owned by [SECURITY.md](../../SECURITY.md)) — and
the milestone [DESIGN.md](../../DESIGN.md) (the `[assign ▸]` affordance placement + the target picker + the
control-node-gated / open / submitting / success / error states; base surface = the m25 `Mesh.dc.html`
fleet mock, unchanged except for this affordance) and [SECURITY.md](../../SECURITY.md) (the CSRF /
same-origin control on the loopback write route — **T1 / fitness S-1**; the revoked-issuer posture; v1 trust
= group membership, untrusted issuance Phase-5+ out of scope).

This story **owns**: `src/mesh-ui-serve.mjs` (the NEW `POST /api/mesh/issue` route reaching
`invoke("mesh:issue")` — the FIRST write route on the fleet face, with the same-origin guard in front of the
invoke), the fleet bundle's `[assign ▸]` affordance + target picker (`ui/` — the m25 kit, no new design
system), the FLIP of `acd-mesh-ui-write-isolation` to the bounded-write shape (fitness #7), and the SECURITY
security-lens fitness (`acd-mesh-issue-route-same-origin`, S-1 — the same-origin / non-simple-content-type
control).

Arms fitness **#7** (`acd-mesh-ui-write-isolation` bounded-write flip) + the SECURITY.md security fitness
**S-1** (owned here). **Depends on story 01** (`mesh:issue` must exist for the route to invoke) — the genuine
integration story. The security-lens work (SECURITY.md + its fitness) was authored at Decide alongside this
story and converges here. Graph-grounded: the write route reaches the mutation ONLY through
`command-core.mjs` (the registry door), adding ZERO coupling beyond it — a greenfield-shaped edit on the
isolated fleet face (← 1 `cli.mjs` / → 2), one guard flipped.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- The developer-amigo pass RESOLVES the QA feasibility flags RAISED in the task features (the in-process
     stand-up-and-POST harness lever + the mutation-without-a-live-remote lever for tasks 00/03; the
     Origin-vs-Sec-Fetch header set + the absent-header policy for task 01; whether the control-node gate is
     server/client/both and whether mesh:status gains an isControlNode fact for the @uat true-absence in
     task 02) and folds implementation guidance here at aof:continue. Left empty at Contract — do NOT
     fabricate a RESOLVED. -->

**Verdict: all four RAISED flags RESOLVE feasible, no scenario needs a retag.** Every lane task 00/01/03
scenario-carries (`@executable`) and task 02 carries (`@uat`) remains reachable as authored. Full
`RESOLVED (developer-amigo): …` blocks with `file:line` citations are folded into each `.feature`
immediately beneath its RAISED flag; this section is the implementation guidance those resolutions imply.

### 1. `POST /api/mesh/issue` handler shape on `src/mesh-ui-serve.mjs`

Mirrors `board-ui.mjs`'s `POST /api/work/feedback` (`src/board-ui.mjs:126-139`) inside the existing
`/api/mesh/status` `if`-chain (`src/mesh-ui-serve.mjs:78-97`), added as a sibling branch:

```js
if (pathname === "/api/mesh/issue") {
  if (request.method !== "POST") { sendMethodNotAllowed(response, "POST"); return; }

  // (1) SAME-ORIGIN + CONTENT-TYPE GUARD — BEFORE any body read or invoke (SECURITY T1 / S-1).
  const origin = request.headers.origin;
  const loopbackOrigin = `http://127.0.0.1:${server.address().port}`;
  if (origin && origin !== loopbackOrigin) {
    sendApiError(response, 403, "Cross-origin request refused.", "forbidden");
    return;
  }
  if (!/application\/json/i.test(request.headers["content-type"] ?? "")) {
    sendApiError(response, 403, "content-type: application/json required.", "forbidden");
    return;
  }

  // (2) BODY READ — the board's readJsonBody transport reader, mirrored (empty-json /
  // malformed-json are transport concerns, stay in the face — src/board-ui.mjs:192-216).
  try {
    const body = await readJsonBody(request);
    const workspace = await loadWorkspace(resolvedProjectDir);
    // (3) THE ONE REGISTRY DOOR — never a direct mesh-issuance import (acd-mesh-ui-no-core-import).
    const result = await invoke("mesh:issue", { ref: body.ref, to: body.to }, { workspace });
    sendJson(response, 200, result);
  } catch (error) {
    sendApiError(response, error.status ?? 500, error.message, error.code ?? "mesh-api-failed");
  }
  return;
}
```

Notes:
- The guard runs strictly BEFORE `readJsonBody`/`invoke` — a refused request never reaches the body
  parser, let alone the mutation (task 01's load-bearing ordering scenario).
- `sendMethodNotAllowed` needs a second `Allow` value (`"GET, HEAD"` today, `src/mesh-ui-serve.mjs:174`) —
  factor it to accept the route's allowed-methods string so `/api/mesh/issue`'s 405 advertises `POST` and
  `/api/mesh/status`'s still advertises `GET, HEAD` (task 00's `PUT`/`DELETE /api/mesh/issue` rows +
  task 03's method matrix both need this distinct-per-route `Allow` header).
- `ref-not-found` / any other coded error `mesh:issue` throws surfaces FAITHFULLY through the same catch
  that already maps `mesh:status`'s errors (`src/mesh-ui-serve.mjs:93-95`) — no new error-mapping table.
- No `mesh-issuance.mjs` import anywhere in this file — the mutation reaches ONLY through `invoke`.

### 2. Guard ordering + fitness interaction

`acd-mesh-issue-route-same-origin` (S-1, already on the tree, `test/arch/acd-mesh-issue-route-same-origin.
test.mjs`) source-greps for an `origin`/`sec-fetch` header read AND a `content-type`/`application/json`
check on the SAME path that reaches `invoke("mesh:issue")`. The handler above satisfies it with an
Origin-only check (the detector's own accepted self-check fixture, `:125-139`, uses exactly this shape) —
confirmed against the detector source, not assumed. `acd-mesh-ui-write-isolation` #7 (SUPERSEDED in place)
asserts the ONE write route reaches the mutation ONLY via `invoke("mesh:issue")`, no direct operation
import, no second write route, no `/ws/terminal` — the handler's `invoke`-only mutation path satisfies the
flip without touching the S-1 guard's separate concern (SECURITY.md's own compatibility note,
`SECURITY.md:160-170`, confirms these two compose: guard runs, THEN invoke).

**The #7 flip is an in-place edit, not a new file**: `test/arch/acd-mesh-ui-write-isolation.test.mjs`'s
second test (`:114-134`) currently asserts line 124's regex `!/pathname\s*===\s*["']\/api\/mesh\/(issue|
assign|route|revoke)["']/` — this literal assertion must flip to the XOR/consistency form ARCHITECTURE's
fitness table #7 specifies (GREEN on the m25 zero-write tree OR the exactly-one-route tree, RED only in
the broken half) once `/api/mesh/issue` lands, mirroring the `acd-mesh-issue-route-same-origin` XOR
pattern already on the tree as the template. Do not add a parallel new test file for #7 — supersede the
existing assertion in place per ADR-006.2.

### 3. `[assign ▸]` bundle work (`ui/src/fleet/`)

- **`ui/src/fleet/api.ts:60`** — `MeshStatus` gains `isControlNode?: boolean` (additive, matching the
  command's additive `result.isControlNode`, story 01's `mesh-status-issued-render.feature:131-149`); add
  an `issue(ref, to?)` API function that POSTs `{ ref, to }` to `/api/mesh/issue` and returns the directive
  or throws the coded error, mirroring `fleetApi.status()`'s fetch-and-json shape (`api.ts:76-79`).
- **`ui/src/fleet/Fleet.tsx:315` (`BoardTile`)** — gains the `[⊕ assign]` trigger in the action row
  (`:326`, between the run-state chip and the `Open board →` drill-in, `:385-413`), rendered IFF
  `status.isControlNode === true` is threaded down from `Fleet()`'s top-level state (`:23`) as a prop —
  `<BoardTile key={board.ref} board={board} isControlNode={status.isControlNode === true} />`. When false,
  render nothing extra (a genuine conditional omission, not a `disabled` attribute — DESIGN default 3's
  true-absence mandate).
- **The target picker** — a new small component (`ui/src/fleet/AssignPicker.tsx` or inline in
  `BoardTile`) using the existing kit `Popover`/`Select` primitives (`ui/src/components/ui/`, per DESIGN's
  "no new component system" rail) anchored to the trigger; populates Nodes from `status.nodes` (already
  fetched) and Capabilities from the union of `node.runtimes`/`node.skills` across `status.nodes` — no new
  fetch, the picker reads data the Fleet view already has in memory (DESIGN §"The data the affordance
  reads").
- **States** — idle / open / submitting / success / error per DESIGN's binding checklist (`DESIGN.md:
  200-231`); submitting disables the picker's inputs and shows "Issuing…"; success closes the picker and
  shows a quiet primary/teal micro-ack on the tile, then reverts to idle; error shows an accent/crimson
  line + Retry SCOPED to the tile (not a page-level toast).

### 4. `isControlNode` cross-story seam (confirmed, not diverged)

Confirmed sound against `mesh:status`'s current shape: today's `src/commands/mesh-identity.mjs:168-288`
carries NO `isControlNode` key. Story 01's task 04
(`wiki/work/27_milestone_work-issuance-routing/stories/01_story_mesh-issue-routing-pickup/tasks/
04_mesh-status-issued-render.feature:131-149`, itself RESOLVED there) is the OWNING addition: an
UNCONDITIONAL pure read of `isControlNode(config)` (`src/mesh-registry.mjs:69-73`) appended to the result
regardless of the `config.mesh.nodeId` gate that scopes `leases`/`issued` — so even an unconfigured node
reads `isControlNode: false`, never an absent key. Story 02 (this story) is the FIRST and ONLY consumer
this milestone — the fleet bundle reads it off the SAME `GET /api/mesh/status` aggregate already fetched
(ADR-002's one-fleet-data-command discipline, zero new endpoint). This is recorded here as a cross-story
seam this story CONSUMES, not one it authors; if story 01 lands ahead of story 02 (the milestone's locked
00→01→02 sequencing, ARCHITECTURE §Recommended story partition) the key is simply present and ready.

The `@uat` absence is judged two ways (task 02's resolution): an automated Playwright DOM-audit (zero
`[assign]` matches by role/text on a `isControlNode:false` fixture, plus a DOM/snapshot diff against the
m25 read-only tile fixture proving byte-identity) PLUS the human designer's visual conformance pass against
the binding checklist (the existing `@uat` review this feature already frames).

### 5. Existing-test ripple

- **`test/arch/acd-mesh-ui-write-isolation.test.mjs`** — the second test (`:114-134`) needs its `/api/mesh/
  issue` literal-refusal assertion (`:124`) SUPERSEDED to the XOR bounded-write form (see §2 above); the
  first test (fs-write/shell-out grep, `:92-112`) and the third (behavioural byte-unchanged-on-read,
  `:135-165`) are UNCHANGED — they hold on both the m25 and the m27 tree as written (no fs write / shell-out
  is introduced by an `invoke`-only mutation; reading `/api/mesh/status` still mutates nothing).
- **`test/arch/acd-mesh-issue-route-same-origin.test.mjs`** — already on the tree, XOR/vacuous-green today;
  arms (tightens to its guarded-route half) automatically once the route lands — no edit needed to the test
  itself, only to `mesh-ui-serve.mjs`.
- **`test/mesh-ui-read-only-contract.test.mjs:199-233`** — CONFIRMED RIPPLE (source-checked, not
  hypothetical): the `05 a write-method request…` test's `rows` array (`:202-209`) includes
  `{ method: "POST", route: "/api/mesh/issue" }` (`:207`, with the comment at `:198` "the would-be m27
  /api/mesh/issue|/assign must not exist early" — a deliberately temporary m25-era assertion) and expects
  a 405/404 rejection with zero state change. Once story 02 lands the route this row's expectation
  INVERTS — `POST /api/mesh/issue` becomes an ACCEPTED write. This row must be REMOVED from the
  refusal-matrix `rows` array (or moved to a same-origin-guard-satisfying accepted-write assertion
  elsewhere) at build time; leave `POST /api/mesh/assign` (`:208`) in place — it stays a genuine not-found
  per task 03's bounded-write matrix (assign/route/revoke never become routes). This is the ONE concrete
  pre-existing test edit this story owes beyond the fitness-table supersede in §2.
- **`test/mesh-ui-serve.test.mjs`** (315 lines) — scan at build time for any additional `/api/mesh/issue`
  literal-refusal assertion beyond the one confirmed above; none found in the S-1/fitness/read-only-contract
  files already inspected, but this file was not exhaustively line-read this pass — grep it for
  `/api/mesh/issue` before wiring task 00/03's new scenarios so no other pre-existing assertion silently
  contradicts the bounded-write flip.
- **`test/arch/acd-mesh-ui-no-core-import.test.mjs`** / **`test/arch/acd-mesh-ui-single-server.test.mjs`**
  / **`test/arch/acd-mesh-ui-single-data-command.test.mjs`** — UNCHANGED, stay green (the route adds no new
  import beyond `./command-core.mjs` and no second server/port).
