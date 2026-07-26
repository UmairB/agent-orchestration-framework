@executable @ui @distribution
Feature: The window is strictly read-only over the fleet — no assign/route/dispatch affordance exists, and the render path issues only the read `mesh status` poll
  In order that assignment stays CLI-only (`aof mesh assign`, milestone 35) and the window can never mutate the fleet,
  the node/work window exposes NO affordance — button, menu item, or handler — that spawns `aof mesh assign` / `issue` / `revoke` / `invite` / `join`,
  the ONLY controls it carries are the LOCAL process toggles (local supervision, story 01), and its render path issues exactly ONE `aof` verb — the read `mesh status` poll —
  so that the surface arms `acd-desktop-read-only-fleet` and the fleet-data allow-list stays exactly {status, serve, ui}.

  # DESIGN §Non-negotiable framing + §Review notes ("read-only over the fleet: any affordance to assign/route/
  # dispatch from these surfaces is out-of-scope and a gap") + ADR-004 decision 3 (strictly read-only: the
  # spawnable `aof mesh` allow-list is EXACTLY {status, serve, ui}; assignment stays CLI-only). This task is the
  # WIRE-LEVEL no-write proof — the render surface offers no mutation affordance and its data path is the ONE
  # read poll (ADR-004 decision 2, `acd-desktop-single-data-path`). `serve`/`ui` spawns are LOCAL process
  # lifecycle (story 01), not fleet data reads and not fleet mutations — explicitly allowed by the guard.
  #
  # NOTE ON TAGS — this task is `@executable @ui @distribution` with NO `@design`: the read-only posture is a
  # behavioural/wire fact, not a look-and-feel judgement. (The VISUAL statement of the same rail — that no write
  # control appears on the RENDER — is judged in task 03's @uat. This task proves the WIRE has no such path.)
  #
  # SEAM SPLIT — this task is the read-only WIRE posture ONLY. The per-node row mapping is task 00; the four-
  # state selection is task 01; the visual read-only-rail judgement is task 03 (@uat). Arms the story's
  # `acd-desktop-read-only-fleet` fitness unit (ADR-004 d3) and exercises `acd-desktop-single-data-path`
  # (ADR-004 d1-2). The a11y lane is OFF for this story (no "a11y" in work.tags.domains — no axe-core run).
  #
  # RESOLVED (developer-amigo): confirm the harness shape — this @executable is expected to be a Rust `#[test]`
  # (`cargo test`) over the `app/desktop/` IPC command surface + the window's control inventory (asserting no
  # mutation command is registered and the poll invokes only `mesh status`), NOT a Node headless test. The
  # developer amigo confirms whether the control inventory is asserted against the Tauri command registry, the
  # rendered DOM, or both, and how the harness observes the spawned argv.

  Background:
    Given the node/work window is mounted with its full control inventory and render path

  # THE MUTATION ALLOW-LIST — no assign/route/dispatch affordance exists (DESIGN §Review notes read-only rail ·
  # ADR-004 d3). The window carries no control that spawns a fleet-mutating `aof mesh` verb. Each forbidden verb
  # is asserted absent from every affordance channel (button, menu item, IPC command handler).
  Scenario Outline: no affordance spawns a fleet-mutating `aof mesh` verb from the window
    Given the window's full affordance inventory (buttons, menu items, IPC command handlers)
    When the inventory is searched for a control that spawns `aof mesh <verb>`
    Then no button, menu item, or handler spawns `aof mesh <verb>`
    And the verb "<verb>" is absent from the spawnable fleet-data/mutation set

    Examples: the forbidden fleet-mutation verbs (ADR-004 d3 — allow-list is exactly {status, serve, ui})
      | verb   |
      | assign |
      | issue  |
      | revoke |
      | invite |
      | join   |

  # THE ONLY CONTROLS ARE LOCAL PROCESS TOGGLES (DESIGN §Surface 1 control bar · ADR-004 d3 "the only writes are
  # LOCAL process supervision"). The window's ONLY interactive write controls are the local process toggles
  # (start/stop the supervised `serve --serve`/`ui` on THIS machine — story 01) and the Open-web-UI launch.
  # These are local supervision, NOT fleet mutations — the guard allow-list includes {serve, ui} for lifecycle.
  Scenario: the only write controls are the local process toggles — local supervision, not a fleet mutation
    Given the window's interactive write controls are enumerated
    Then the only write controls are the local process toggles (start/stop the supervised `serve --serve` / `ui` on THIS machine)
    And starting/stopping a local process is local supervision, never a fleet mutation
    And no control on the window writes to the fleet's assignment/routing state

  # THE RENDER PATH ISSUES ONLY THE READ POLL (ADR-004 d1-2, `acd-desktop-single-data-path`). The fleet body's
  # render path spawns EXACTLY ONE data-bearing `aof` verb — `mesh status` — and never a second data command
  # (`mesh identity`/`mesh sync`) nor a direct read of aof's on-disk record/config store. The `isControlNode`
  # role decision also comes from this ONE poll (ADR-002), not a second command.
  Scenario: the render path reads the fleet through exactly one verb — the `mesh status` poll — never a second data command
    Given the fleet body performs a render/refresh cycle
    When the `aof` invocations issued by the render path are observed
    Then exactly one data-bearing verb is spawned — `aof mesh status --json`
    And no `aof mesh identity` and no `aof mesh sync` is spawned by the render path
    And no direct read of `.aof/mesh/nodes` or `.aof/aof.config.json` is performed
    And the `isControlNode` role decision is taken from this same one poll, not a second command

  # PROCESS LIFECYCLE IS NOT A FLEET MUTATION (ADR-004 d1-3). The `serve`/`ui` spawns the LOCAL toggles issue
  # are process lifecycle on THIS machine — explicitly allowed by the read-only guard — NOT fleet data reads and
  # NOT fleet mutations. A local toggle spawning `serve`/`ui` must NOT be misread as a fleet write.
  Scenario Outline: a local process toggle spawns a lifecycle verb, which is allowed and is not a fleet mutation
    Given the local process toggle for "<process>" is actuated
    When the spawned `aof mesh <verb>` is observed
    Then the verb "<verb>" is a LOCAL process-lifecycle spawn on this machine (allowed by the {status, serve, ui} allow-list)
    And it is neither a fleet-data read nor a fleet mutation
    And it does not appear on the render/poll data path (which spawns only `mesh status`)

    Examples: the allowed local-lifecycle verbs (ADR-004 d3 allow-list · ADR-002 supervision set)
      | process     | verb  |
      | Mesh server | serve |
      | Mesh web UI | ui    |
