@cli @adapter @scaffold @executable
Feature: aof project doctor carries a graphify-binary check that warns (never errors) when graphify is absent
  In order that an operator learns whether graphify is provisioned — and exactly how to install it — without aof trying to install a Python tool
  `aof project doctor` adds a graphify-binary check that reads resolveGraphifyBinary and reports ok / warning honestly,
  so that the Python-binary provisioning is a deliberate, guidance-bearing health check (Option B) rather than a silent failure or a hard error.

  # ADR-004 (Option B): the existing doctorConfig checks[] surface (config-inspect.mjs,
  # surfaced by `aof project doctor`) gains a `graphify-binary` check calling
  # resolveGraphifyBinary (ADR-002). Absent = severity "warning" (NOT "error" — a
  # project may legitimately not graph) with the install guidance; present = "ok" with
  # the version, degrading to "present, version unknown" when the probe is unavailable
  # (RESEARCH §A4). The check NEVER crashes. All three states (absent / present-stubbed /
  # version-unknown) are assertable with resolveGraphifyBinary stubbed, so the whole
  # feature is @executable — no live install needed to prove the degrade-clearly STRUCTURE
  # (ADR-004); the live-install confirmation lives in the doctor UAT procedure.
  Background:
    Given a project with an aof config
    And `aof project doctor` resolves its checks

  # Absent binary → a warning with guidance, and the overall doctor run does not fail.
  Scenario: doctor reports the absent binary as a warning with install guidance
    Given PATH does not contain a graphify executable
    When I run "aof project doctor"
    Then the graphify-binary check has severity "warning"
    And its message names "uv tool install graphifyy"
    And the doctor run does not report an error for graphify being absent

  # The check is honest about severity across states; absent is never an error, and no
  # state crashes the check (warning / ok / ok — never "error", never a throw).
  Scenario Outline: the graphify-binary check maps each state to the right severity
    Given graphify is "<state>"
    When the graphify-binary check runs
    Then its severity is "<severity>"
    And it "<crashes>"

    Examples:
      | state                  | severity | crashes      |
      | absent from PATH       | warning  | never throws |
      | present with a version | ok       | never throws |
      | present, version probe unavailable | ok | never throws |

  # The check degrades clearly when it cannot read a version — it reports
  # "present, version unknown" rather than asserting a version it never observed.
  Scenario: the check degrades clearly when the version probe is unavailable
    Given graphify is present but its version cannot be probed
    When the graphify-binary check runs
    Then its severity is "ok"
    And its message says the version is unknown
    And it does not invent or assert a version
