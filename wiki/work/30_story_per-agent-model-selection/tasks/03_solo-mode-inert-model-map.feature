@cli @work @validate @executable
Feature: per-role model selection is inert under solo mode, and surfaced as such
  In order to avoid a silent no-op that misleads an operator into thinking a tier map is in effect
  the system must recognise that under "work.agents.mode: solo" the main session plays every role, so a
  per-role model map cannot take effect — surfacing that as a non-blocking notice rather than either
  silently ignoring the map or rejecting the config.

  # Resolves STORY.md "Open design questions" -> "solo mode interaction: decide whether that's documented
  # or enforced." Resolution: SURFACED, not enforced. Under `orchestrated` the main session spawns role
  # sub-agents whose generated frontmatter carries the model; under `solo` the main session performs every
  # role inline, so no sub-agent is spawned and the per-role model never binds. Rather than block the
  # config (enforce) or drop the map without a word (silent), validation raises a NON-BLOCKING notice.
  # This mirrors the framework's balance elsewhere — surface loudly, don't over-gate (capture-commands,
  # --autonomous). Per-role model selection therefore only bites under `orchestrated`.
  #
  # FEASIBILITY (dev): the notice rides task 02's net-new `work.agents` validation in config-inspect.
  # diagnostic(severity, …) accepts "warning"/"info"; `aof project validate` marks the config invalid
  # ONLY on an "error" severity (src/config-inspect.mjs + src/cli.mjs), so a warning/info diagnostic
  # surfaces AND leaves the config valid — exactly "surfaced AND not an error". Precedent: doctor's
  # "package-intent" info diagnostic. All rows run OFFLINE against a fixture config via `aof project
  # validate`. Note `mode` is optional in the schema with no declared default.
  #
  # The notice is conditional on BOTH mode=solo AND a per-role map being present — it is not a blanket
  # "you are in solo mode" message. The last two scenarios pin those false-positive edges.

  Background:
    Given a project config whose "work.agents" carries a per-role model override

  Scenario: a per-role model map under solo mode is flagged as having no effect
    Given "work.agents" sets mode "solo"
    When I run "aof project validate"
    Then validation surfaces a notice that per-role model selection has no effect under solo mode

  Scenario: the solo-mode notice does not block — the config stays valid
    Given "work.agents" sets mode "solo"
    When I run "aof project validate"
    Then the config is still reported valid, the notice being informational rather than an error

  Scenario: under orchestrated mode the same map raises no such notice
    Given "work.agents" sets mode "orchestrated"
    When I run "aof project validate"
    Then no "no effect under solo mode" notice is surfaced for the per-role model map

  # The common real config: a project sets a model map but never touches `mode` (which is optional).
  # An unset mode is not solo, so the map is live and no notice fires.
  Scenario: with a per-role map and no mode set, no solo-mode notice is surfaced
    Given "work.agents" does not set "mode"
    When I run "aof project validate"
    Then no "no effect under solo mode" notice is surfaced for the per-role model map

  # False-positive guard: the notice is about an INERT map, so solo mode with no map at all is silent.
  Scenario: solo mode with no per-role map raises no notice
    Given "work.agents" sets mode "solo" and configures no per-role model override
    When I run "aof project validate"
    Then no "no effect under solo mode" notice is surfaced
