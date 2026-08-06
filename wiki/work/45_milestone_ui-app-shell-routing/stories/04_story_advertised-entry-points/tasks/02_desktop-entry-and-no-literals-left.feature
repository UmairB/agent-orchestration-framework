<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/04, the residue that no headless lane can reach: the
# desktop app's COMPILED entry URL, and the end-to-end proof that a legacy address
# an operator already holds still opens the surface it always opened.
#
# WHY THIS TASK IS `@manual`, stated as a disposition rather than an excuse. Its
# two subjects are irreducibly human on this repo's machinery:
#  1. `app/desktop/crates/app/src/supervisor.rs:44`'s `MESH_UI_URL` is a Rust
#     `&'static str` compiled into `aof-mesh-desktop.exe`. It has NO runtime
#     envelope — nothing prints it, no API returns it, and the only way it becomes
#     observable is a WINDOWS-ONLY cargo build
#     (`node scripts/install-local.mjs --desktop`) followed by an operator clicking
#     the tray's "Open web UI" and reading the address bar of the browser it
#     launched. The literal itself is covered structurally by
#     `test/arch/acd-no-surface-mode-url-literal.test.mjs`, whose PRODUCERS table
#     names `supervisor.rs` and asserts it emits `/fleet`; what the arch test
#     cannot say is that the tray still opens anything.
#  2. ADR-003's legacy translation is a client-side `history.replaceState` REWRITE,
#     chosen precisely because only a client can preserve a fragment. A server can
#     therefore never demonstrate it — task 00's fetches prove the legacy address
#     is SERVED, and 45/01's `legacyRedirectFor` proves the mapping is correct, but
#     only a real browser shows the address bar changing once, the fragment
#     surviving, and the back button NOT bouncing between the two forms. m38/ADR-008,
#     verbatim: *"a green suite is not evidence a feature works; only a
#     REAL-producer, real-outsider path is."*
#
# NOT ASSERTED HERE — the PO headline "no `?mode=` surface literal survives
# anywhere in `ui/`, `src/` or `app/desktop/`" is a PLACEMENT invariant and is
# owned in full by `test/arch/acd-no-surface-mode-url-literal.test.mjs` (already
# written, currently RED — two failing assertions plus a green self-check; this
# story is what takes it green). Restating it as a scenario would report one change
# twice and would put a source read in a QA lane. Its OUTSIDER-observable
# counterpart is the last scenario below: across a whole real session, every URL
# the product hands the operator is a path. A producer nobody grepped for would
# fail that scenario without failing the gate, and a hand-rolled copy would fail
# the gate without failing that scenario — they cover different halves.
#
# ALSO NOT A QA ASSERTION, but required by this story and routed to CODE REVIEW:
# `supervisor.rs:37-44`'s doc comment states that *"the bare `/` renders BLANK, so
# the URL MUST carry `?mode=fleet&scope=global`"*. ADR-002 retires that fact. The
# comment must be REWRITTEN, not deleted and not left standing over code that
# contradicts it (TECH_DEBT item 0.4's shape). QA asserts only its BEHAVIOURAL
# half — scenario 3 below, that bare `/` no longer renders blank.
#
# LITMUS: every Then is something a person can see on a screen — an address bar, a
# rendered surface, a tray menu, a terminal line. Nothing is read from source and
# nothing is inspected in a store.
#
# EVIDENCE THE DEVELOPER RECORDS IN THE MILESTONE'S `VERIFICATION.md` (m45), under
# the 45/04 section, at `aof:verify 45`:
#   - the host OS and the desktop build stamp (`~/.aof/bin/aof.exe --version` →
#     `0.1.0 (payload <buildId>)`, and the `Build: payload <buildId>` line both
#     daemons print), so the run is attributable to a build and not to a machine;
#   - the exact address-bar string observed after each row of scenario 2, verbatim,
#     including the fragment;
#   - a screenshot or verbatim transcript for scenario 1 (the tray) and scenario 3
#     (bare `/`);
#   - the list of URLs collected in scenario 4 and where each came from.
#
# MIGRATION DOWN. Scenario 2 migrates to `@executable` the day this repo has a real
# browser harness driving the entry — the translation is a pure function 45/01
# already tests, so all that is missing is a browser that executes `replaceState`.
# Scenario 1 migrates the day the desktop app publishes its entry URL through a
# channel a test can read (an `aof mesh desktop` probe envelope would do it); until
# then a compiled constant behind a Windows cargo build has no other producer.
# A shrinking `@uat`/`@manual` set is maturity — these two are named so the
# shrinking is a decision, not an oversight.

@manual @ui @work @distribution
Feature: (operator) the desktop app's door opens on a path, and every address this system ever handed out still opens what it always opened
  In order that the operator's tray, their bookmarks and the links already pasted into their notes all keep working on the day the address bar starts meaning something
  the desktop app's compiled entry URL must open the fleet at its path with its scope intact, and every legacy `?mode=` address must land on its canonical path — payload intact, rewritten exactly once, with the back button still going back

  Background:
    Given the deployed build on a real machine, installed with `node scripts/install-local.mjs` (plus `--desktop` for scenario 1, which is a Windows-only cargo build)
    And the desktop app relaunched through `aof mesh desktop run` so both daemons run as its children in its own environment
    And a real browser, with the address bar visible

  # Headline 1: the tray. The one producer with no envelope at all — a compiled
  # constant in a Rust binary — so the click IS the test.
  Scenario: the desktop tray's "Open web UI" lands on the fleet's path, with its scope intact
    Given `aof-mesh-desktop.exe` is running and the fleet daemon it supervises is up on 127.0.0.1:4181
    When the operator picks "Open web UI" from the tray
    Then the browser opens and its address bar reads `http://127.0.0.1:4181/fleet?scope=global`
    And the address bar contains no `mode=` at any point — not even momentarily, before a rewrite
    And the fleet surface renders with its scope control reading the global scope, exactly as it did before this milestone
    And a browser refresh on that same address re-renders the fleet rather than 404ing or landing on the shell's not-found surface

  # Headline 2: the back-compat census. Every legacy address a producer in this
  # story used to emit, walked by hand in a real browser. A row that only checked
  # the new address would be half a test; these rows check the half that is
  # invisible to every other lane in the milestone.
  Scenario Outline: every legacy address a producer used to emit still opens its surface, keeps its payload, and is rewritten exactly once
    Given <origin> is running
    When the operator pastes <legacy> into the address bar and loads it
    Then the surface that renders is <surface>
    And the address bar now reads <canonical> — rewritten exactly once, with no visible second navigation
    And pressing Back returns to whatever the operator was looking at BEFORE, never to <legacy> (a replace, not a push — ADR-003)
    And reloading <canonical> renders the same surface again, changing the address bar no further

    Examples:
      | case                                     | origin              | legacy                                        | surface                    | canonical                        |
      | the board server's own advertised URL    | `aof work ui`       | http://127.0.0.1:PORT/?mode=board             | the board                  | http://127.0.0.1:PORT/board      |
      | a drill-in deep link, fragment and all   | `aof work ui`       | http://127.0.0.1:PORT/?mode=board#34/01       | the board, scrolled to 34/01 | http://127.0.0.1:PORT/board#34/01 |
      | the fleet server's own advertised URL    | `aof mesh ui`       | http://127.0.0.1:4181/?mode=fleet             | the fleet                  | http://127.0.0.1:4181/fleet      |
      | the fleet URL an operator has bookmarked | `aof mesh ui`       | http://127.0.0.1:4181/?mode=fleet&scope=global | the fleet, global scope   | http://127.0.0.1:4181/fleet?scope=global |
      | the local-scope fleet URL                | `aof mesh ui --local` | http://127.0.0.1:4181/?mode=fleet&scope=local | the fleet, local scope   | http://127.0.0.1:4181/fleet?scope=local |
      | the config editor's advertised URL       | `aof assets ui`     | http://127.0.0.1:4177/?mode=assets            | the config editor          | http://127.0.0.1:4177/config     |
      | the fleet-origin board link's legacy form| `aof mesh ui`       | http://127.0.0.1:4181/?mode=board             | the board surface, degrading through its OWN existing error state | http://127.0.0.1:4181/board |
      | an unrecognised mode value               | `aof assets ui`     | http://127.0.0.1:4177/?mode=banana            | the config editor          | http://127.0.0.1:4177/config     |
    # Row 7 is deliberately the UGLY one and it is a NO-CHANGE row: `/board` on the
    # fleet origin has no `/api/work` (mesh-ui-serve.mjs:541-543), so the board
    # cannot load its stream there. That is TODAY's behaviour for
    # `?mode=board` on :4181, it is ADR-002's stated origin-blind consequence, and
    # this story must reproduce it exactly rather than repair it. Whatever the
    # operator sees today for the legacy form is what they must see for the path
    # form — if it differs, that is a finding, not a fix.
    # Row 8's mapping (any unrecognised mode → `/config`) is 45/01's translation
    # table; what this row adds is that a real bookmark of the fall-through case
    # lands somewhere real rather than on the not-found surface.
    # The board rows use the board's EPHEMERAL port, read from the `aof work ui`
    # announce line at the time of the walk — never a fixed port.

  # Headline 3: the behavioural half of the retired warning. `supervisor.rs:37-44`
  # says the bare `/` renders BLANK; ADR-002 makes it the shell landing. A person
  # looking at the screen is the only reader who can retire that claim.
  Scenario: the bare `/` on the fleet origin renders the shell landing, not the blank page the desktop app's doc comment warns about
    Given `aof mesh ui` is running on 127.0.0.1:4181
    When the operator loads `http://127.0.0.1:4181/` with no query and no fragment
    Then a shell landing renders, with the app's navigation visible and reachable
    And it is not blank, not a 404 page, and not an automatic redirect to `/fleet` (the address bar still reads `/`)
    And the fleet is one click away from it
    And the same bare `/` on the board origin also renders the shell landing (it used to render the config editor — the ONE URL whose meaning ADR-003 changes, and the operator should see it change)

  # Headline 4: the outsider's version of "no literal survives". The arch gate reads
  # source; this reads the product. A producer nobody grepped for shows up here.
  Scenario: a whole real session hands the operator nothing but path URLs
    Given a fresh deployment with the board, fleet and config-editor launchers all exercised in one sitting
    When the operator collects EVERY URL the product hands them across that session — each launcher's `Open this URL in your browser:` line, each `--json` probe envelope, the desktop tray's target, the fleet's drill-in into a board, and every in-app link they can click between the board and the fleet
    Then every collected URL carries a path from the ADR-002 table (`/`, `/fleet`, `/board`, `/config`) and not one carries `mode=`
    And each of them, opened, renders the surface its path names
    And the count of collected URLs is written down beside them, so a producer that appears later is visibly a new one
