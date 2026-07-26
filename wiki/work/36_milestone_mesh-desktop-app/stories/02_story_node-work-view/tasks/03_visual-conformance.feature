@uat @ui @design @distribution
Feature: the node/work window renders the four states — a read-only design-conformance judgement against DESIGN §Surface 1's mock + binding checklist
  In order to confirm an operator reads the fleet at a glance — a native Windows-11 utility, read-only over the fleet, truthful and torn-view-free across empty/loading/error/populated —
  the node/work window is rendered POPULATED and in each of the four states,
  and judged region-by-region against DESIGN §Surface 1 (`mocks/node-work-window.png` once committed, else the §Surface 1 binding checklist — the standing baseline) as CONFORMS / GAPS,
  so that the two ramps stay separate, stale is never red, errors are calm sentences, keep-last-good holds on a silent re-poll, colour never travels alone, and no fleet-mutation control leaks onto the surface.

  # DESIGN §Surface 1 is the BINDING CONFORMANCE BASELINE (DESIGN §Conformance "Review rule": a review judges
  # the handed screenshot against BOTH the committed mock AND the §Surface 1 checklist; when the PNG is not yet
  # committed the checklist is the STANDING baseline — the review does NOT return INCONCLUSIVE-on-missing-
  # baseline while this document stands, it judges against the checklist). The regions this @uat review judges,
  # in order (DESIGN §Surface 1 §"Layout regions"):
  #   1. WINDOW CHROME — native title bar reading `aof mesh — fleet` (quiet, no branded header band); the
  #      hide-to-tray-on-close hint is visually implied, not a control designed here.
  #   2. CONTROL BAR (top) — Mesh-server health pill + start/stop toggle · Mesh-web-UI health pill + toggle ·
  #      Open-web-UI secondary button (dimmed when the web UI is stopped) · this-machine label (control/worker
  #      role + `aof` version in mono, right-aligned quiet). The pills use the LOCAL-process ramp
  #      (running/stopped/restarting).
  #   3. BODY — a region header (`NODES  <summary>` e.g. "4 nodes · 3 online · 1 stale") over node rows; each
  #      row: health dot (FLEET-presence ramp) · node id (mono) + `this node` tag on the local node (neutral
  #      chip, not a colour change) · role badge (neutral chip) · `aof` version (mono) · current work
  #      (`activeRuns` → ref + title + running marker, else muted `idle`).
  #   4. FOOTER — a quiet poll-freshness line ("refreshed Ns ago"); poll/presence idiom, no push stream.
  #
  # BROWSER LANE (QA-owned): this @uat is the design-conformance judgement handed to the designer — a RENDERED
  # screenshot of each state, judged region-by-region against §Surface 1. QA runs the browser; the designer
  # judges the handed render (it has no Bash). Per the design-render discipline (`design-render via headless
  # Chromium` memory) `npx playwright` is POLICY-BLOCKED — the render drives the cached ms-playwright Chromium
  # directly (`--headless=new --screenshot=<ABSOLUTE forward-slash path>`), NOT `npx playwright`. HARNESS CAVEAT:
  # this is a Tauri WebView2 surface (ADR-001), NOT a plain web page — the developer amigo confirms the EXACT
  # render harness next (whether the WebView HTML/CSS is rendered standalone in cached Chromium against fixture
  # payloads, or the built Tauri window is screenshotted). This @uat gate is judged at `aof:verify`. Once the
  # designer judges a render CONFORMS, that approved render becomes the `toHaveScreenshot` baseline QA's visual-
  # regression guards against drift (the seam QA owns; building the baselines into a hard gate is a QA-owned
  # follow-on, OUT OF SCOPE for this story). This surface is MOTION-bearing (the running marker + `restarting`
  # pulse) — the screenshot locks the PRESENCE of the pulsing marker; the pulse animation itself is a functional
  # harness check, not a pixel assert.
  #
  # RENDER PRECONDITION: reaching CONFORMS/GAPS requires an actual render of each judged state (fed the
  # corrected-shape fixture payloads). Absent a render, the honest verdict is INCONCLUSIVE NAMING the missing
  # render — never a guess from the WebView source.
  #
  # SEAM SPLIT — this task is the design-conformance (does it LOOK/READ right) judgement ONLY. The corrected-
  # shape row mapping is task 00 (@executable); the four-state selection is task 01 (@executable); the read-only
  # WIRE posture is task 02 (@executable). This @uat judges placement, the native Windows-11 feel, the ramp
  # appearances, the two-ramps separation, and the read-only RAIL visually. The a11y lane is OFF for this story
  # (no "a11y" in work.tags.domains — no axe-core run, no a11y finding).

  Background:
    Given the node/work window is rendered against the corrected-shape `mesh status --json` fixtures — the populated frame plus the empty, loading, and error states
    And each render is driven via the cached ms-playwright Chromium (not npx playwright) to an absolute screenshot path — the Tauri WebView harness the developer amigo confirms
    And each rendered screenshot is handed to the designer to judge against DESIGN §Surface 1's mock + binding checklist

  # RENDER GATE — if no render is produced, the review does NOT guess from the WebView source (DESIGN
  # §Conformance render rule). A render of each judged state is the precondition for a CONFORMS/GAPS verdict.
  Scenario: absent a render the review degrades to INCONCLUSIVE naming the missing render
    Given the cached-Chromium render did not produce a screenshot of the judged state
    When the design-conformance review runs
    Then the verdict is INCONCLUSIVE
    And it names the missing render (the populated window and/or the specific missing state) as the gap
    And it does not infer a verdict from the WebView source

  # THE POPULATED WINDOW — the mock's primary frame (DESIGN §Surface 1 §States populated). Judged as a whole:
  # native Windows-11 utility feel (Segoe UI Variable, Mica/acrylic, layer fills, quiet colour — NOT a branded
  # web app), the four regions present in order, and a mixed fleet (control+worker, online+stale, running+idle,
  # local tagged). [cached-Chromium screenshot candidate — the populated node/work window]
  Scenario: the populated window renders the four regions in order with a native Windows-11 utility feel
    When the designer judges the populated window against DESIGN §Surface 1 §"Layout regions" and §"the shared design ramp"
    Then the window carries, in order: window chrome (title `aof mesh — fleet`), the control bar, the body node list, and the footer freshness line
    And it reads as a native Windows-11 system utility (Segoe UI Variable, Mica/acrylic, WinUI layer fills, quiet semantic colour) — a branded web app / heavy borders / gradients / a non-system font is a GAP
    And the body shows a mixed fleet: control + worker roles, online + stale presence, running + idle work, with the local node tagged `this node`
    And the verdict for the populated window is CONFORMS or names a specific GAP

  # BODY ROW ANATOMY + the FLEET-PRESENCE ramp (DESIGN §Surface 1 body row · §ramp). Each row: health dot (from
  # the presence ramp), mono node id + the `this node` identity tag (neutral chip, NOT a colour change), role
  # badge (neutral chip), mono version, current work (`activeRuns` ref+title with a running marker, else muted
  # `idle`). [cached-Chromium screenshot candidate — a node row: online running + a stale idle row]
  Scenario: a node row reads dot · id · this-node tag · role badge · version · current work, off the fleet-presence ramp
    When the designer judges a node row against DESIGN §Surface 1 body-row anatomy and §"the shared design ramp"
    Then the row reads, in order: a fleet-presence health dot, a mono node id (with the `this node` neutral chip on the local node), a neutral role badge, a mono version, and the current-work cell
    And current work renders `35/02 · <title>` in mono with a pulsing accent running marker, or a muted `idle` when there are no active runs
    And the `this node` tag is an identity label, NOT a colour change to the row or its dot
    And a stale node's dot is a muted/grey mark, NEVER red (stale is degraded liveness, not a fault)
    And the verdict for the body row is CONFORMS or names a specific GAP

  # THE TWO RAMPS STAY SEPARATE (DESIGN §Non-negotiable framing · §Review notes "the two ramps stay separate").
  # The control-bar process pills use the LOCAL-supervisor ramp (running/stopped/restarting); the body dots use
  # the FLEET-presence ramp (online/stale/offline). A node reading online in the body while its local web-UI
  # child pill reads stopped must render truthfully side by side; colouring a body dot from a local-process
  # signal is a GAP. [cached-Chromium screenshot candidate — control-bar pill stopped beside an online body dot]
  Scenario: the control-bar process ramp and the body fleet-presence ramp read separately, never conflated
    When the designer judges the control bar and the body against DESIGN §"the two ramps stay separate"
    Then the control-bar health pills use the local-process vocabulary (running / stopped / restarting)
    And the body health dots use the fleet-presence vocabulary (online / stale / offline)
    And a node reading online in the body while this machine's web-UI pill reads stopped renders truthfully side by side
    And any body dot coloured from a local-process signal (the two ramps conflated) is a GAP
    And the verdict for the two-ramps separation is CONFORMS or names a specific GAP

  # THE EMPTY STATE — a calm centred invite, not an error (DESIGN §States empty). Worker copy "join a control
  # node"; control copy "invite a node / start the server"; the commands render as copyable mono chips. An empty
  # fleet styled as "broken"/an error banner is a GAP. [cached-Chromium screenshot candidate — the empty state]
  Scenario: the empty state renders a calm role-aware invite CTA, never an error
    When the designer judges the empty-state render against DESIGN §States empty
    Then the surface is a calm centred placeholder (dashed card, quiet icon) with an invite CTA — NOT an error banner
    And the invite copy reflects the node role: "join a control node" on a worker, "invite a node / start the server" on a control node
    And the invite commands render as copyable mono chips
    And an empty fleet presented as "broken" or as an error is a GAP
    And the verdict for the empty state is CONFORMS or names a specific GAP

  # THE LOADING STATE — a stable skeleton reserving the SAME layout (DESIGN §States loading). The control bar is
  # present, the body shows placeholder rows, and NOTHING reflows when data lands. A skeleton that resizes/
  # reflows on data arrival is a GAP. [cached-Chromium screenshot candidate — the loading skeleton]
  Scenario: the loading state is a stable skeleton reserving the same layout — no reflow when data lands
    When the designer judges the loading-state render against DESIGN §States loading
    Then the skeleton reserves the SAME region layout — control bar present, body placeholder rows
    And nothing reflows or resizes when the real payload lands (the layout is held)
    And the control-bar local process pills may already read truthfully during loading (a local signal)
    And the verdict for the loading state is CONFORMS or names a specific GAP

  # THE ERROR STATE — a calm inline banner, never a stack trace (DESIGN §States error · §Review notes "errors
  # are calm sentences, never stack traces"). Attention tone, a caution glyph, ONE plain sentence + the path/
  # command to inspect + Retry. A stack trace / raw dump / full-window failure is a GAP. [cached-Chromium
  # screenshot candidate — the error banner over the body]
  Scenario: the error state renders a calm inline banner — one plain sentence, never a stack trace
    When the designer judges the error-state render against DESIGN §States error
    Then the error surface is a calm inline banner at the top of the body: an attention-tone caution glyph, one plain sentence, the path/command to inspect, and a Retry
    And it renders NO stack trace, NO raw error dump, and NO scary full-window failure takeover
    And the error tone is a reserved attention/amber, distinct from the muted-grey stale ramp (stale is never red/amber)
    And the verdict for the error state is CONFORMS or names a specific GAP

  # KEEP-LAST-GOOD on a SILENT re-poll (DESIGN §States error keep-last-good · §Review notes). The user story's
  # anti-torn-view rule: a failed silent re-poll keeps the last-good populated body, quietly stops advancing
  # freshness (optionally a thin "reconnecting" hint), and does NOT tear to a full-screen error. A blanked/torn
  # populated body on a silent poll is a GAP. [cached-Chromium screenshot candidate — populated body held after a failed silent re-poll]
  Scenario: on a failed silent re-poll the populated body is kept — the view never tears to a full-screen error
    When the designer judges the populated render after a failed SILENT re-poll against DESIGN §States error keep-last-good
    Then the populated body is still rendered (last-good kept) — not blanked, not replaced by the error banner
    And the freshness line has quietly stopped advancing (optionally a thin "reconnecting" hint)
    And no stack trace and no full-window error takeover covers the live cards
    And a blanked or torn populated body on a silent re-poll is a GAP
    And the verdict for keep-last-good is CONFORMS or names a specific GAP

  # THE READ-ONLY RAIL (DESIGN §Non-negotiable framing · §Review notes "read-only over the fleet" · ADR-004 d3).
  # The VISUAL statement of the same rail task 02 proves at the wire: NO assign/route/dispatch control appears on
  # the render; the ONLY controls are the local process toggles + Open-web-UI. A leaked fleet-mutation affordance
  # is a GAP. [cached-Chromium screenshot candidate — the full window audited for controls]
  Scenario: the surface stays strictly read-only — no assign/route/dispatch control appears on the render
    When the designer audits the full rendered window for interactive controls against DESIGN §Review notes read-only rail
    Then there is no assign, route, or dispatch button, menu item, or form anywhere on the surface
    And the only write controls are the local process toggles (Mesh server, Mesh web UI) and the Open-web-UI launch
    And any health signal rendered by colour without its paired shape/label is a GAP (colour never travels alone)
    And the verdict for the read-only rail is CONFORMS or names a specific GAP

  # COLOUR NEVER TRAVELS ALONE (DESIGN §the shared design ramp · §Review notes). Every health signal pairs colour
  # with a shape/badge/label so it reads in monochrome and for colour-blind operators — the body dots, the
  # control-bar pills, and the region-header summary. A colour-only signal is a GAP. [cached-Chromium screenshot
  # candidate — the health signals audited for a paired shape/label]
  Scenario: every health signal pairs colour with a shape or label — none travels by colour alone
    When the designer audits every health signal on the render against DESIGN §"colour never travels alone"
    Then each body health dot pairs its colour with a distinct shape (filled / hollow-muted / hollow-dim) and reads with a label
    And each control-bar process pill pairs its colour with a state word (running / stopped / restarting)
    And the region-header summary states the counts in words ("N online · M stale"), not colour alone
    And any signal legible only by colour is a GAP
    And the verdict for the colour-never-alone rule is CONFORMS or names a specific GAP
