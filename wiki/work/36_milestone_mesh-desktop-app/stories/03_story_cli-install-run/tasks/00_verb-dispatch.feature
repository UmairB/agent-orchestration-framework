@executable @cli @distribution @adapter
Feature: `aof mesh desktop install` and `aof mesh desktop run` dispatch as CLI-only nested verbs outside the mesh bijection
  In order to install and launch the desktop supervisor through the one tool the operator already has,
  `aof mesh` gains a `desktop` sub-group with two inner verbs — `install` and `run` — that dispatch as CLI-only
  nested verbs (siblings to `ui`/`repo`/`assign`), route to one new `commands/mesh-desktop.mjs`, emit exactly one
  `{ ok, … }` document under `--json`, reject unknown flags, and register NO `mesh:*` id (staying outside the bijection).

  # ARCHITECTURE 36/ADR-003 (the CLI seam): the install verb + the run/launch verb are added as additive
  # `subcommand === "desktop"` branches in meshCommand, ABOVE the unknown-sub fallthrough (the m22 additive-branch
  # idiom — see cli.mjs:493-507 identity/status, :554 ui, :563 repo, :572 assign), each routing to ONE new command
  # module `src/commands/mesh-desktop.mjs` (the `mesh-repo.mjs`/`mesh-assign.mjs` `← 1 cli.mjs` shape). They take a
  # nested inner-verb face (install/run) that does NOT fit meshVerbCli's single-positional `mesh:<verb>` shape, so
  # they carry NO `mesh:*` registry id and stay DELIBERATELY OUTSIDE `acd-mesh-command-cli-bijection` — exactly as
  # ui/repo/assign do (cli.mjs:548-575 comments). "The verbs carry no mesh:* id" is STRUCTURAL → the fitness
  # acd-desktop-verbs-outside-bijection (test/arch/acd-desktop-verbs-outside-bijection.test.mjs), not a step; THIS
  # feature asserts the observable dispatch, the single --json envelope, the unknown-flag rejection, and the still-
  # unknown-sub fallthrough being left unchanged.
  #
  # VERB SPELLING DECIDED HERE (ADR-003 §2 left it to the build): the NESTED `desktop` sub-group form —
  # `aof mesh desktop install` and `aof mesh desktop run` — chosen to mirror the `aof mesh repo publish` nested
  # precedent ADR-003 names as the shape to join: ONE `subcommand === "desktop"` branch → `meshDesktopCommand(rest)`,
  # which then routes on its own inner verb (install/run). The flat `install-desktop`/`desktop` forms were rejected
  # as two dispatch branches for one module; the nested sub-group is the tighter single-branch fit.
  #
  # RESOLVED (developer-amigo): these verbs are Node-side @executable in the EXISTING `node scripts/test.mjs`
  # harness — the `mesh-repo`/`mesh-assign` precedent (a command module unit-tested off the CLI + a spawn-and-parse
  # over a fixture $HOME). NO cargo lane is needed for THIS story; the Rust subtree (app/desktop/) is exercised only
  # by the @uat task 03. Dispatch + arg-parse assert with no built app and no network.

  Background:
    Given the `aof mesh` command spine with its existing ui/repo/assign sibling verbs

  # THE DISPATCH (ADR-003 §1): each inner verb reaches the ONE new command module as a nested CLI-only verb.
  Scenario Outline: `aof mesh desktop <verb>` dispatches to the new command module as a nested CLI-only verb
    When the operator runs `aof mesh desktop <verb>`
    Then it dispatches through the additive `subcommand === "desktop"` branch above the unknown-sub fallthrough
    And it routes to the new `commands/mesh-desktop.mjs` module
    And it does not route through meshVerbCli (it is not a registered mesh:* command)

    Examples:
      | verb    |
      | install |
      | run     |

  # THE SINGLE --json ENVELOPE (ADR-003, the 08/ADR-003 discipline): exactly ONE { ok, … } document on stdout.
  Scenario Outline: the `--json` face emits exactly one `{ ok, … }` document
    When the operator runs `aof mesh desktop <verb> --json`
    Then stdout carries exactly one JSON document
    And that document is a single `{ ok, … }` envelope (ok:true on success, or ok:false with error + code)
    And no second JSON document and no stray non-JSON line is written to stdout

    Examples:
      | verb    |
      | install |
      | run     |

  # UNKNOWN-FLAG REJECTION (mirrors meshUiCommand cli.mjs:980-983): an unrecognised flag is refused, exit 1.
  Scenario Outline: an unknown flag on a desktop verb is rejected before any work, mirroring meshUiCommand
    When the operator runs `aof mesh desktop <verb> --bogus`
    Then it is rejected with `Unknown option "--bogus".`
    And the process exits with a non-zero status
    And under `--json` the rejection is the single `{ ok:false, error, code }` envelope naming the unknown flag
    And no install or launch work is performed

    Examples:
      | verb    |
      | install |
      | run     |

  # THE INNER-VERB FALLTHROUGH: an unknown INNER verb under `desktop` is a coded refusal, never a crash.
  Scenario: an unknown inner verb under `desktop` is refused with a coded envelope, never a stack trace
    When the operator runs `aof mesh desktop frobnicate`
    Then it is refused with a coded unknown-verb envelope naming "frobnicate"
    And the process exits with a non-zero status
    And no stack trace is printed

  # THE OUTER UNKNOWN-SUB FALLTHROUGH IS UNCHANGED (ADR-003): a still-unknown `aof mesh` sub falls through as before.
  Scenario: a still-unknown `aof mesh` sub falls through to the existing unknown-subcommand envelope unchanged
    When the operator runs `aof mesh wibble`
    Then it reaches the existing meshCommand unknown-sub fallthrough
    And under `--json` it emits the existing `{ ok:false, error, code:"unknown-subcommand" }` envelope naming "wibble"
    And the desktop dispatch branch did not intercept it

  # OUTSIDE THE BIJECTION (ADR-003 §2, fitness acd-desktop-verbs-outside-bijection): asserted here as BEHAVIOUR.
  Scenario: neither desktop verb registers a `mesh:*` id, so the mesh bijection gate is untouched
    When the command registry is enumerated
    Then no `mesh:install` / `mesh:run` / `mesh:desktop` id exists
    And the desktop verbs are reachable ONLY as CLI-only nested dispatch branches (like ui/repo/assign)
    And `acd-mesh-command-cli-bijection` derives no desktop sub and stays green
