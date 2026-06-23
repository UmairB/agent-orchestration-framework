@cli @scaffold @executable
Feature: aof project doctor reports managed tools from the store, the provider prerequisite, and platform support — always warning, never error
  In order that an operator learns the true state of aof's tool stack without the doctor ever failing on an absent tool
  doctorConfig gains three checks — managed-tool (store-first), provider-prereq, tool-platform — that report ok or warning honestly,
  so that a present-from-store tool reads ok-with-version, an absent tool or missing uv or unsupported platform reads warning-with-guidance, and the doctor run never crashes.

  # ADR-003: three checks join doctorConfig's checks[] (config-inspect.mjs), SUPERSEDING
  # the 09 graphify-binary check in place with a store-aware managed-tool check. All
  # resolve via the ADR-001 store-first resolver / the descriptor; absence/missing-prereq/
  # unsupported-platform are WARNINGS (not errors — a project may not use a tool), and no
  # check throws. The `aof project doctor` CLI face is unchanged (renders checks[]+--json).
  # Hermetic via the injectable resolver/prereq/platform seams — every row is provable
  # in-process with the resolver/prereq/platform stubbed, so the whole feature is @executable.
  Background:
    Given doctorConfig run against a fixture project with injectable resolver/prereq/platform seams

  # managed-tool maps each tool's resolution state to an honest severity. The four states
  # are the full ADR-003 matrix: store hit (ok+version), PATH-only (ok "not managed"),
  # total miss (warning+guidance), and a store hit whose version probe failed (ok, version
  # unknown — the RESEARCH §A4 degrade). Absence is the ONLY warning; nothing is an error.
  Scenario Outline: the managed-tool check maps resolution state to severity
    Given a managed "graphify" that is "<state>"
    When the managed-tool check runs
    Then its severity is "<severity>"
    And its message "<message>"

    Examples:
      | state                       | severity | message                                    |
      | present from the store      | ok       | names the resolved version                 |
      | present on PATH only        | ok       | says present on PATH, not managed          |
      | absent from store and PATH  | warning  | gives the `aof project provision` guidance |
      | present, version unprobable | ok       | says present, version unknown              |

  # provider-prereq surfaces the lane prerequisite (uv) — present is ok, absent is a
  # warning carrying the uv install guidance (never an error — a project may not use the
  # uv lane at all).
  Scenario Outline: the provider-prereq check reports the uv prerequisite
    Given uv is "<uv>"
    When the provider-prereq check runs
    Then its severity is "<severity>"
    And its message "<message>"

    Examples:
      | uv          | severity | message                       |
      | on PATH     | ok       | confirms uv is available      |
      | not on PATH | warning  | gives the install-uv guidance |

  # tool-platform warns (never blocks) where a tool's descriptor matrix is unsupported on
  # the running platform. Rows: a supported POSIX platform (ok), a supported platform that
  # carries a prereq (ok — the matrix is supported:true with a note), and an unsupported
  # platform (warning naming the prereq). It is always advisory — never an error.
  Scenario Outline: the tool-platform check warns on an unsupported platform
    Given a tool whose platform matrix marks "<platform>" "<support>"
    When the tool-platform check runs on "<platform>"
    Then its severity is "<severity>"

    Examples:
      | platform | support                         | severity |
      | linux    | supported                       | ok       |
      | darwin   | supported                       | ok       |
      | win32    | supported (needs Rust, note)    | ok       |
      | win32    | unsupported (no wheel)          | warning  |

  # No check ever fails the doctor run or throws — absence is a warning, not an error.
  Scenario: an absent tool, missing uv, and unsupported platform never error or crash
    Given a managed tool absent, uv missing, and the platform unsupported
    When I run "aof project doctor"
    Then every graphify/tool-related check has severity at most "warning"
    And the doctor run reports no error and does not throw
