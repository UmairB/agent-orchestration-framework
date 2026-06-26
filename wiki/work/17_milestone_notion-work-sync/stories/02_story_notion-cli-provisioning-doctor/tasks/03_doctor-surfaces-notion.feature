@cli @adapter @scaffold
Feature: aof project doctor surfaces the Notion CLI's presence, platform support, and auth reachability — always advisory, never an error
  In order that an operator learns whether a Notion sync will actually reach Notion, without the doctor ever failing on an absent tool or absent token
  the doctor reports the Notion CLI via the m12 managed-tool / tool-platform checks plus a sibling auth-reachability advisory, each mapping state to ok or warning honestly,
  so that a present-and-versioned CLI on a supported platform with a reachable token reads ok, an absent CLI / unsupported platform / absent token reads warning-with-guidance, and no Notion-related doctor check ever errors or throws.

  # ADR-004: the Notion CLI rides the EXISTING m12 doctor checks on doctorConfig.checks[]
  # (config-inspect.mjs:311–313) — adding NOTION_DESCRIPTOR (task 01) surfaces managed-tool
  # (present-and-versioned) + tool-platform (the win32-x64 matrix) for free; an auth-reachability
  # advisory is added as a SIBLING check there (NOT in work:doctor, the work-stream lane, 15/ADR-001).
  # Because the npx-lane tool is never in the version-keyed store, the managed-tool check reports it
  # "present on PATH" (the npx-lane reality, config-inspect.mjs:380). EVERY state is at most a WARNING
  # — absence/unreachability is never an error; a project may not use Notion at all. Hermetic via the
  # injected resolver / platform / reachability seams, mirroring the m12 exemplar
  # (12/.../01_doctor-checks.feature) — so the severity-matrix rows are @executable; the live
  # present-and-versioned + auth-reachable report is @manual (real install + token).
  Background:
    Given doctorConfig run against a fixture project with injectable resolver / platform / reachability seams

  # The managed-tool check maps the Notion CLI's resolution state to severity: resolved (on PATH /
  # via npx — the npx-lane reality) reads ok naming the version; absent from PATH reads a warning
  # carrying the `aof project provision` guidance. Absence is the ONLY warning; nothing is an error.
  @executable
  Scenario Outline: the managed-tool check maps the Notion CLI's resolution state to severity
    Given the Notion CLI is "<state>"
    When the managed-tool check runs for "notion"
    Then its severity is "<severity>"
    And its message "<message>"

    Examples:
      | state                    | severity | message                                    |
      | present on PATH via npx  | ok       | names the resolved version                 |
      | absent from PATH         | warning  | gives the `aof project provision` guidance |

  # The tool-platform check reads NOTION_DESCRIPTOR's matrix (task 01) by process.platform — the m12
  # check (config-inspect.mjs:488) keys on the platform only, with NO arch dimension, and the frozen
  # descriptor declares a single win32 entry (supported:true) carrying an "x64 only (no win32-arm64)"
  # NOTE. So win32 reads ok with that x64-only caveat surfaced as an ADVISORY note within the ok
  # verdict (NOT an arm64 warning — the check cannot distinguish arch against the frozen descriptor);
  # a descriptor-unsupported platform reads a warning, exactly like the m12 tool-platform check. Always
  # advisory — never an error, never blocking.
  @executable
  Scenario Outline: the tool-platform check is ok where the descriptor supports the platform and warns where it does not
    Given the running platform is "<platform>" and the Notion descriptor marks it "<support>"
    When the tool-platform check runs for "notion"
    Then its severity is "<severity>"

    Examples:
      | platform                          | support                              | severity |
      | win32                             | supported (x64-only, Node 22+ note)  | ok       |
      | linux                             | supported                            | ok       |
      | a descriptor-unsupported platform | marked unsupported                   | warning  |

  # The auth-reachability advisory maps the auth state to severity: a token set and reachable reads
  # ok; a token absent reads a warning with setup guidance; a configured-but-unreachable Notion
  # (token present but the probe fails) reads a warning. It is an ADVISORY — never a hard error, even
  # when unreachable (a project may be mid-setup).
  @executable
  Scenario Outline: the auth-reachability advisory maps auth state to severity
    Given the Notion auth state is "<auth>"
    When the auth-reachability check runs
    Then its severity is "<severity>"
    And its message "<message>"

    Examples:
      | auth                          | severity | message                                   |
      | token set and reachable       | ok       | confirms auth is reachable                |
      | token env var unset           | warning  | gives the set-the-token guidance          |
      | token set but probe fails     | warning  | reports Notion unreachable, advises retry |

  # No Notion-related doctor check ever fails the run or throws — the worst any of them reports is a
  # warning. An absent CLI, an unsupported platform, and an unset token together still leave the
  # doctor run honest and crash-free (mirrors the m12 exemplar's never-crash scenario).
  @executable
  Scenario: the Notion doctor checks never error or throw — at most warning
    Given the Notion CLI absent, the platform unsupported, and the token unset
    When I run "aof project doctor"
    Then every Notion-related check has severity at most "warning"
    And the doctor run reports no error and does not throw

  # The live surface: against a real ntn install and a real token, `aof project doctor` reports the
  # Notion CLI present-and-versioned and auth reachable. Needs a live binary + token (none on the
  # dev host, RESEARCH §A1/A2), so it is a human/dev-run procedure, not CI.
  # verifies → milestone UAT.md "aof project doctor reports Notion present-and-versioned + auth reachable" procedure (authored at verify).
  @manual
  Scenario: aof project doctor reports the Notion CLI present-and-versioned and auth reachable
    Given a real ntn on PATH and a real NOTION_API_TOKEN exported in the environment
    When I run "aof project doctor"
    Then the managed-tool check reports the Notion CLI present and names its version
    And the auth-reachability advisory reports auth reachable
