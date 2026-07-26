---
doc: design
---
<!--
  Milestone DESIGN.md — answers ONE question: how should it look and feel, and why?
  Owner: designer (aof-designer). Captures INTENT + RATIONALE (why a pill, not a stack trace),
  NOT pixel specs. The committed mock is the visual source of truth; the binding checklist below
  makes that mock CHECKABLE region-by-region. UI BEHAVIOUR (what the CLI dispatches) is a
  task-feature outcome, not a design concern here.
-->
# 36 · Mesh Desktop App — UI/UX Design Contract

## What this app is, in one breath

An **ambient ops tool**, not a marketing page. A small native Windows companion that lives in the
tray, keeps the mesh server + `aof mesh ui` alive, and shows — **read-only** — the fleet's nodes and
what each is working on. The whole product should feel like a **Windows 11 system utility** (Task
Manager / the volume flyout / the Wi-Fi tray panel), not a branded web app: system font, subtle
depth, quiet colour, immediate legibility. An operator glances at the tray, reads "3 online · 1
stale," and moves on.

**Non-negotiable framing (state it, then honour it):**
- **The native view is strictly READ-ONLY over the fleet.** It renders nodes + current work. It has
  **no assign / route / dispatch control** — assignment stays `aof mesh assign` (milestone 35). The
  only writes this app performs are **local process supervision** (start/stop the two supervised
  processes on THIS machine) — never a mesh mutation. "The app offers to route work to node X" would
  be out-of-scope behaviour, not a design concern for this surface.
- **One data path.** The node/work body renders the **existing `mesh:status` contract**
  (`src/commands/mesh-identity.mjs` → `{ nodes: [...] }`, each carrying `nodeId`, `caps`/roles,
  presence `heartbeatAt` + `activeRuns`, `aofVersion`, a `stale` flag, and the `local` marker). It
  adds **no second data model** (the milestone-25 single-data-command discipline, carried forward).
  The app shells out to the `aof` binary for this; it computes no fleet state of its own.
- **The two supervised processes are LOCAL-machine facts, distinct from fleet presence.** The top
  control bar reflects *this machine's* Mesh server + Mesh web UI child processes (running/stopped/
  restarting — a supervisor watchdog signal). The body's health dots reflect *fleet presence*
  (online/stale/offline — the `mesh:status` heartbeat signal). **Never conflate the two ramps** — a
  node can be online in the fleet while its local web-UI child is stopped, and both must read
  truthfully side by side.

## Conformance source of truth (mocks + binding checklist)

This milestone has **two surfaces**, each with a committed pixel mock that is the **visual source of
truth** once landed, plus a **binding checklist** (below) that is the concrete, enforceable baseline
a design-conformance review judges against region-by-region — whether or not the PNG has landed yet.
Neither surface is left with "match the mock" alone (unenforceable) nor with no baseline at all.

- **Surface 1 — Main window (node/work view):** mock at
  `wiki/work/36_milestone_mesh-desktop-app/mocks/node-work-window.png` · checklist in §Surface 1.
- **Surface 2 — Tray menu + icon:** mock at
  `wiki/work/36_milestone_mesh-desktop-app/mocks/tray-menu.png` · checklist in §Surface 2.

> **Review rule.** A design-conformance review judges the handed screenshot against BOTH the committed
> mock (pixel fidelity) AND the checklist below (regions · components · states · ramp). When the mock
> PNG is not yet committed, the checklist is the standing baseline — the review does NOT return
> INCONCLUSIVE-on-missing-baseline while this document stands; it judges against the checklist.

## The shared design ramp (native Windows 11 feel)

The visual language every region draws from. This is the **native counterpart** to the web fleet
view's ramps (`ui/src/fleet/Fleet.tsx`) — same *concepts* (presence live/stale/offline, running/idle,
control/worker role, "this node"), rendered in **native Windows idiom**, not the web SPA's Tailwind
chrome. One vocabulary, two faces.

- **Type & density:** **Segoe UI Variable** (the system font — the app inherits the OS font, it does
  not ship Inter). WinUI type ramp: Body 14px, Caption 12px, a Subtitle for region headers. Node ids,
  work refs, versions render in a **monospace** face (Cascadia Mono / Consolas) so `35/02` and
  `v1.9.3` align and read as machine data. Compact, table-like density — an ops tool, not airy
  marketing spacing.
- **Depth:** subtle only. The window uses the native **Mica/acrylic** backdrop where available; cards
  and the control bar sit on **layer fills** (WinUI `CardBackground` / `LayerFill`) with a hairline
  stroke and a whisper of elevation shadow. **No heavy borders, no gradients, no drop-shadow drama.**
- **Colour is quiet and semantic, never decorative:**
  - **Accent = the system accent colour** (respect the user's Windows personalisation), used sparingly
    — the primary toggle, the running/online signal. Not a hard-coded teal brand.
  - **Health ramp (colour AND shape/label ALWAYS travel together — never colour alone):**
    - **online / running** = filled accent dot.
    - **stale** = hollow / muted-ring dot, **quiet grey — NEVER red**. Stale is degraded liveness, not
      data loss (mirrors the web ramp's "stale is muted, never destructive").
    - **offline / stopped** = hollow dashed / dim dot.
    - **error / restarting** = a **calm** amber/attention tone (a caution pill), reserved for a genuine
      fault — never a decorative accent.
  - **Role badge** = a neutral outline chip (`control` / `worker`) — muted, uppercase caption, no fill.
- **Light + dark:** **both are first-class** and follow the OS theme (the app respects Windows
  light/dark automatically). Every token above has a light and dark value; nothing is legible in one
  theme only. Tray icon likewise ships light- and dark-taskbar variants.
- **Motion:** minimal. A gentle pulse on a `running` marker and on `restarting`; a subtle fade on
  poll refresh. No spinners-as-decoration, no bouncing.
- **Icon set:** native (Segoe Fluent Icons / WinUI symbols) — play/stop glyphs, an open-in-browser
  glyph, a window glyph. No custom illustrated iconography.

---

## Surface 1 — Main window (node / work view)

`mocks/node-work-window.png` is the visual source of truth. **Intent:** a compact "fleet at a glance"
supervisor window — top **status/control bar** for this machine, a **body** listing the fleet.
Read-only over the fleet; the only controls are the local process toggles.

### Layout regions, in order

1. **Window chrome** — native title bar; title reads `aof mesh` (quiet, e.g. `aof mesh — fleet`). No
   custom-branded header band. Closing the window **hides to tray** (does not quit — ambient presence);
   this is a behaviour the mock should visually imply (a hint), not a control to design here.
2. **Status / control bar (top).** Left→right:
   - **Mesh server** health pill — one of `running` / `stopped` / `restarting`, with a **start/stop
     toggle** (a single primary toggle: Start when stopped, Stop when running; `restarting` shows the
     pulse and is momentarily non-interactive). RATIONALE: a toggle, not a checkbox or dropdown — a
     supervised process is binary up/down and the operator wants a one-click flip.
   - **Mesh web UI** health pill — `running` / `stopped`, with its own **start/stop toggle**.
   - **Open web UI** button — a secondary button (open-in-browser glyph + label). Launches the running
     `aof mesh ui` in the default browser. Disabled/dimmed when the web UI is stopped (nothing to open).
   - **This machine** label — `control node` or `worker node` (role of THIS install), plus the **`aof`
     version** in mono. Right-aligned, quiet. RATIONALE: an operator must always know which kind of
     node they're sitting at (a worker has no Mesh-server toggle to enable — see error/empty states).
3. **Body — the fleet list.** A **region header** (`NODES  <summary>` — e.g. "4 nodes · 3 online · 1
   stale") over a scrollable list of **node cards/rows**. Each node row holds, in order:
   - **health dot** (online / stale / offline — the fleet-presence ramp),
   - **node name / id** (mono), with the **`this node` tag** on the local node (an identity label —
     neutral outline chip — **not** a colour change; driven off `mesh:status` `local`),
   - **role badge** (`control` / `worker` — neutral outline chip),
   - **`aof` version** (mono, quiet),
   - **current work** — the node's `activeRuns`: a **work ref** (`35/02`) + short title with a
     **running marker** (pulsing accent dot), or **`idle`** in muted text when there are no active
     runs. RATIONALE: "current work" is the single most-glanced fact — it is the row's emphasis, accent
     when running, muted when idle; the ref stays mono so it reads as an addressable work item.
4. **Footer / status line (quiet).** A poll-freshness line — "refreshed Ns ago" — echoing the web
   view's poll idiom (visibility is poll/presence, no push stream). Optional overall-health echo.

### Components each region holds

- Control bar: 2× **health pill + toggle** (Mesh server, Mesh web UI), 1× **secondary button** (Open
  web UI), 1× **this-machine label** (role + version).
- Body: 1× **region header** (label + live summary), N× **node card/row** (health dot · name · this-node
  tag · role badge · version · current-work).
- Footer: 1× **freshness line**.

### States (design ALL FOUR)

- **Empty** — mesh not started / no nodes in the roster. A **calm centred placeholder** (dashed card,
  quiet icon), NOT an error: it explains the next action with an **invite CTA** — the `aof mesh invite`
  / `aof mesh join` commands shown as copyable mono chips (mirrors the web `EmptyFleet`). On a **worker
  node** the copy reflects "join a control node"; on a **control node**, "invite a node / start the
  server." Never call an empty fleet "broken."
- **Loading** — first fetch of `mesh:status`. A **stable skeleton** that reserves the SAME region
  layout (control bar present, body shows placeholder rows) so nothing reflows when data lands. The
  control bar's local process pills may already be truthful (they're a local signal) while the body
  loads.
- **Error** — **mesh server unreachable / `aof mesh status` failed.** A **calm inline banner** at the
  top of the body (attention tone, a caution glyph + one plain sentence + the path/command to inspect
  + a **Retry**). **NEVER a stack trace, never a raw error dump.** Keep-last-good: a failed *silent*
  re-poll must NOT blank the populated body — it quietly stops advancing freshness and (optionally)
  shows a thin "reconnecting" hint, it does not tear the view to a full-screen error.
- **Populated** — several nodes, **mixed control/worker**, **mixed online/stale**, **mixed
  running/idle**, with the **local node tagged `this node`**. This is the mock's primary frame. A stale
  node still RENDERS (degraded, muted — never dropped, never red); a node running work shows the ref +
  running marker; an idle node reads `idle`.

### Design ramp per region

- **Control bar:** WinUI **layer fill** with a hairline bottom stroke; health pills use the health
  ramp (accent=running, grey=stopped, amber-pulse=restarting); the primary toggle carries the system
  accent, the Open-web-UI button is a secondary (neutral) button. Segoe UI Variable Body; version in
  mono.
- **Body node rows:** **card/list-row** on `CardBackground` with hairline stroke + whisper elevation;
  health dot from the presence ramp; role + this-node badges as neutral outline chips; current-work
  accent-when-running / muted-when-idle; work ref in mono. Compact, table-like row height.
- **Empty / loading / error:** dashed calm placeholder (empty), pulse skeleton reserving layout
  (loading), attention-tone inline banner (error) — all in the quiet ops palette, light + dark.

---

## Surface 2 — Tray menu + icon

`mocks/tray-menu.png` is the visual source of truth. **Intent:** the ambient presence — a right-click
menu and an icon whose *shape/badge* tells fleet health at a glance from the taskbar. This is where the
app lives when the window is closed.

### Layout regions, in order (the right-click menu)

1. **Header (non-interactive).** Overall fleet health summary — e.g. **`3 online · 1 stale`** — plus a
   small health glyph matching the current icon state. RATIONALE: the header answers "is the fleet OK?"
   before the operator reads any item; it's a status readout, not a control. Native menu-header
   styling (a disabled/emphasis first item or a header row), quiet.
2. **Process controls.** `Start mesh` / `Stop mesh` — the same local supervisor action as the window's
   Mesh-server toggle, surfaced as menu items (the label reflects current state: show **Stop mesh**
   when running, **Start mesh** when stopped — one item, state-dependent label, not both at once).
   Disabled/hidden on a **worker node** (no server to start) — a worker's menu omits the server control
   rather than showing a dead item.
3. **Open web UI.** Opens the running `aof mesh ui` in the browser (disabled when the web UI is
   stopped).
4. **Show / Hide window.** Toggles the main window (label reflects current visibility).
5. **Separator, then Quit.** `Quit` fully exits the app (tears down supervision) — deliberately below a
   separator and last, so an ambient-presence tool is not quit by accident.

### Components each region holds

- 1× **header row** (health summary + glyph, non-interactive).
- **Menu items:** `Start/Stop mesh` (state-labelled), `Open web UI`, `Show/Hide window`
  (state-labelled), separator, `Quit`. Native menu items with Segoe Fluent leading glyphs; disabled
  items dimmed, not hidden except the worker-node server-control case.

### Tray ICON states (the icon itself, on the taskbar)

The icon is the ambient signal — it must be readable at 16px and distinguishable **by shape/badge, not
colour alone** (taskbars, colour-blindness, monochrome-icon modes):

- **healthy** — the mesh mark, accent/normal, no badge. "All nodes online, server running."
- **degraded** — the mark with a small **caution badge** (amber dot/triangle overlay). "Something is
  stale, or the mesh server is restarting" — attention, not alarm.
- **stopped** — the mark **dimmed / hollow / with a stop badge**. "Mesh server (or the whole app's
  supervision) is stopped." Clearly distinct at a glance from degraded.
- Ships **light- and dark-taskbar variants** (Windows themes both taskbars); the shape/badge is
  identical across themes, only the fill adapts.

### States (menu-level: empty / loading / error / populated)

- **Empty** — no nodes yet: header reads a calm **`no nodes yet`** (not "0 online" alarm); process
  controls still available (you can Start mesh / invite from here). Icon = healthy-but-idle (or stopped
  if the server isn't running).
- **Loading** — first status fetch: header reads **`checking…`** (or shows the last-known summary while
  refreshing — keep-last-good); items remain usable.
- **Error** — status unreachable: header reads a **calm** **`mesh unreachable`** line (plain words, no
  error code dump); the menu stays usable so the operator can `Start mesh` / `Open web UI` / open the
  window to see the inline banner. Icon → degraded or stopped as appropriate.
- **Populated** — header shows the real `N online · M stale` roll-up; icon reflects healthy/degraded/
  stopped; all items present and state-labelled.

### Design ramp

- Native context-menu chrome (Windows 11 rounded flyout, acrylic where available), Segoe UI Variable,
  Segoe Fluent leading glyphs, the same health ramp for the header glyph as the window's dots. Light +
  dark follow the OS theme. No custom-branded menu skin — it must look like it belongs to Windows.

---

## Review notes / design-gap standing rules

These are the rules I own as the read-only "what's correct" authority; a divergence resolves as a
DESIGN.md rule + (usually) a `@uat` visual-review scenario a person judges — not a code patch alone.

- **The two ramps stay separate.** Local process health (running/stopped/restarting) and fleet presence
  (online/stale/offline) are different signals with different vocabularies; a review flags any surface
  that conflates them (e.g. colouring a node's fleet dot from the local web-UI child's state).
- **Stale is never red.** Stale/degraded is quiet grey/muted everywhere (icon, dot, header). Red/amber
  is reserved for a genuine fault (mesh unreachable, restart-looping).
- **Errors are calm sentences, never stack traces.** Any surface rendering a raw error, a code dump, or
  a scary full-window failure on a *silent* re-poll is a gap (keep-last-good is the rule).
- **Colour never travels alone.** Every health signal pairs colour with a shape/badge/label so it reads
  in monochrome and for colour-blind operators.
- **It must look native.** A surface that reads as a branded web app (heavy borders, gradients, a marketing
  hero, a non-system font) is a gap — the target feel is a Windows 11 system utility.
- **Read-only over the fleet.** Any affordance to assign/route/dispatch work from these surfaces is
  out-of-scope and a gap — assignment is CLI-only (`aof mesh assign`).
- **Cadence/interval numbers are never literal copy.** Any retry/poll interval shown to the operator
  (error-banner "retrying every Ns", a "reconnecting" hint) is bound to the single poll-cadence constant
  (3s today) or omitted — a copy string must never assert a cadence the supervisor does not run. A
  staleness readout ("last checked Nm ago") is fine only when derived from the real last-success
  timestamp, never a fixture literal. *(Set at `aof:verify 36`, finding GAP-1: the error banner read
  "Retrying every 5s" against a real 3s poll — the divergence is a copy-vs-behaviour gap, not a typo.)*

## UI BEHAVIOUR that should become task scenarios (not design)

Cross-referenced from the scenario, not restated as design — hand these to the developer/product-owner
as candidate task `.feature` outcomes:

- Closing the window **hides to tray** (survives, does not quit); `Quit` is the only full exit.
- The local **start/stop toggles** actually spawn/stop the supervised `aof` processes and the watchdog
  **restarts on crash** (the `restarting` state is real supervisor behaviour, not just a visual).
- **Open web UI** launches the running `aof mesh ui` at its real local URL in the default browser.
- The body **polls `mesh:status`** on a cadence (matching the web view's poll idiom) — no push stream.
- A **worker node** omits the Mesh-server control (window + tray) because there is no server to run
  there; a **control node** shows it.
