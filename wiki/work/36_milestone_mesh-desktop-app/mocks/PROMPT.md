# UI-generation prompt — AOF Mesh Desktop App mocks

Paste the block below into a UI/design agent (claude.ai design, Figma AI, or any HTML-artifact tool).
It is grounded in [`../DESIGN.md`](../DESIGN.md) so the output conforms to the binding checklist the
`@uat` design gate (story 02 `03_visual-conformance` / story 01 `03_tray-icon-visual`) judges against.
Export the two frames to `node-work-window.png` and `tray-menu.png` in this folder.

---

**You are designing the UI for AOF Mesh — a small native Windows 11 desktop app.** It is an *ambient ops
tool*: it lives in the taskbar tray, keeps a developer's "mesh" (a fleet of machines running the `aof`
CLI) alive, and shows — **read-only** — the fleet's nodes and what each is working on. It must feel like a
**Windows 11 system utility** (Task Manager, the volume flyout, the Wi-Fi tray panel), **not a branded web
app**. Deliver it as a **single self-contained HTML file** with inline CSS (this is exactly the medium the
app ships in — a WebView-hosted view), rendering the two surfaces below in **both light and dark**, at a
compact desktop scale. I will screenshot each surface to a PNG.

## Non-negotiable rules (a violation is a design gap)
- **Strictly read-only over the fleet.** It renders nodes + current work. There is **no assign / route /
  dispatch control** anywhere. The *only* interactive controls are **local process toggles** (start/stop
  the two processes on *this* machine) and window/app controls.
- **Two separate health vocabularies — never conflate them.** (a) *Local process health* of THIS machine's
  two supervised processes: `running` / `stopped` / `restarting`. (b) *Fleet presence* of each node:
  `online` / `stale` / `offline`. A node can be `online` in the fleet while this machine's local web-UI
  process is `stopped` — both read truthfully, side by side.
- **Colour never travels alone.** Every health signal pairs colour with a **shape/badge/label** so it reads
  in monochrome and for colour-blind users.
- **Stale is never red.** Stale/degraded is quiet **grey/muted**. Red/amber is reserved for a genuine fault
  (mesh unreachable, restart-looping).
- **Errors are calm sentences, never stack traces.** No raw error dumps, no scary full-window failure.
- **Native, not branded.** System font, subtle depth, quiet colour. No marketing hero, no gradients, no
  heavy borders, no custom brand colour.

## Shared visual system (both surfaces draw from this)
- **Type:** Segoe UI Variable (the OS system font — do not ship Inter). Body ~14px, Caption ~12px, a
  Subtitle for region headers. **Node ids, work refs, versions render in monospace** (Cascadia Mono /
  Consolas) so `36/00` and `v1.9.3` align as machine data. Compact, table-like density.
- **Depth:** subtle only — a Mica/acrylic-style backdrop; cards and the control bar on quiet **layer fills**
  with a hairline stroke and a whisper of elevation. No heavy borders, no gradients.
- **Colour = quiet + semantic:**
  - **Accent = the Windows system accent** (a personalised blue by default), used sparingly — the primary
    toggle, the running/online signal.
  - **Health ramp (colour + shape always together):** online/running = **filled accent dot**; stale =
    **hollow / muted-ring dot, quiet grey (NEVER red)**; offline/stopped = **hollow dashed / dim dot**;
    error/restarting = a **calm amber caution** pill, only for a real fault.
  - **Role badge** = a neutral **outline chip** (`control` / `worker`), muted uppercase caption, no fill.
  - **`this node` tag** = a neutral outline chip (an identity label, **not** a colour change).
- **Light + dark are both first-class** and follow the OS theme — every token has a light and dark value.
- **Motion:** minimal — a gentle pulse on a `running` marker and on `restarting`; a subtle fade on refresh.
- **Icons:** native (Segoe Fluent style) — play/stop, open-in-browser, a window glyph. No illustrated icons.

---

## SURFACE 1 — Main window: the node / work view
A compact "fleet at a glance" supervisor window. Regions in order:

1. **Window chrome** — native title bar; title reads quietly `aof mesh — fleet`. (Closing the window hides
   to tray, not quits — imply ambient presence; it is not a control to draw.)
2. **Status / control bar (top).** Left→right: **Mesh server** health pill (`running`/`stopped`/
   `restarting`) with a single **start/stop toggle**; **Mesh web UI** health pill (`running`/`stopped`) with
   its own **start/stop toggle**; an **"Open web UI"** secondary button (open-in-browser glyph; **dimmed
   when the web UI is stopped**); right-aligned, quiet: **this machine** — `control node` or `worker node` —
   plus the **`aof` version** in mono.
3. **Body — the fleet list.** A region header `NODES  ·  <summary>` (e.g. "4 nodes · 3 online · 1 stale")
   over a scrollable list of node rows. Each row, in order: **health dot** (online/stale/offline) · **node
   name** (mono) with the **`this node`** chip on the local node · **role badge** (`control`/`worker`) ·
   **`aof` version** (mono, quiet) · **current work** — a **work ref** (`36/00`) + short title with a pulsing
   accent **running marker**, or **`idle`** in muted text. Current work is the row's emphasis.
4. **Footer** — a quiet freshness line, "refreshed 3s ago" (visibility is by poll, not a live stream).

**Sample fleet for the populated state** (use this exact data so it reads real):
- `umair-mbp` — **this node** · control · **online** · `v1.9.3` · running **`36/00` supervisor core**
- `worker-01` — worker · **online** · `v1.9.3` · running **`35/02` isolated worker execution**
- `worker-02` — worker · **online** · `v1.9.2` · **idle**
- `mac-studio` — worker · **stale** (muted grey, still shown) · `v1.9.3` · **idle**
Control bar (this = control node): Mesh server **running**, Mesh web UI **running**, Open web UI enabled,
"control node · v1.9.3". Header: "4 nodes · 3 online · 1 stale".

**Design ALL FOUR states of the body (four frames or a labelled set):**
- **Empty** — no nodes yet. A calm centred placeholder (dashed card, quiet icon), NOT an error — with an
  **invite CTA**: the `aof mesh invite` / `aof mesh join` commands as copyable mono chips. (Never call an
  empty fleet "broken.")
- **Loading** — a stable **skeleton** that reserves the SAME layout (control bar present, placeholder body
  rows) so nothing reflows when data lands.
- **Error** — mesh unreachable / `aof mesh status` failed → a **calm inline banner** at the top of the body:
  a caution glyph + one plain sentence + a **Retry**. Never a stack trace. (Keep-last-good: a failed silent
  re-poll must not blank a populated body.)
- **Populated** — the sample fleet above: mixed control/worker, mixed online/stale, mixed running/idle,
  local node tagged `this node`.

---

## SURFACE 2 — Taskbar tray menu + icon
The ambient presence — a right-click menu and an icon that tells fleet health from the taskbar.

**The right-click menu, regions in order:**
1. **Header (non-interactive)** — overall fleet health, e.g. **`3 online · 1 stale`**, with a small health
   glyph. A status readout, not a control.
2. **Start mesh / Stop mesh** — ONE state-labelled item (show **Stop mesh** when running, **Start mesh** when
   stopped). *(On a worker node this item is omitted — no server to run there.)*
3. **Open web UI** — opens the running `aof mesh ui` in the browser (dimmed when it's stopped).
4. **Show / Hide window** — label reflects current visibility.
5. **— separator —**, then **Quit** (last, below the separator, so an ambient tool isn't quit by accident).

**The tray ICON states** (readable at 16px, distinguished **by shape/badge, not colour alone**, with light-
and dark-taskbar variants):
- **healthy** — the mesh mark, no badge ("all online, server running").
- **degraded** — the mark + a small **caution badge** (amber dot/triangle) ("something stale, or the server
  restarting" — attention, not alarm). *(This is the state the sample data above produces — 1 stale.)*
- **stopped** — the mark **dimmed/hollow + a stop badge** ("supervision stopped"), clearly distinct at a
  glance from degraded.

Show the **populated** menu (header `3 online · 1 stale`, **Stop mesh**, Open web UI, Hide window, Quit) and
the **three icon states** as a small strip, in light and dark.

---

## Deliverable
A single self-contained **HTML file** (inline CSS, no external assets) that lays out: Surface 1 in its four
states, and Surface 2 (the populated menu + the three-icon strip), each in **light and dark**. I will
screenshot **Surface 1 (populated)** → `node-work-window.png` and **Surface 2** → `tray-menu.png`. Keep every
frame faithful to the rules and ramp above — it will be judged region-by-region against `../DESIGN.md`'s
binding checklist.
