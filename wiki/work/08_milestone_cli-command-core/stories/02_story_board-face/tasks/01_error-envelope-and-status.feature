@ui @work @board @executable
Feature: The /api/work error envelope, status codes and unknown-route 404 survive the migration unchanged
  In order that the re-home behind the command core is observably inert on the error path as well as the success path
  every /api/work* failure still answers the milestone-03 error envelope { ok:false, error, code } with the same HTTP status mapping, and an unknown /api/work route still 404s,
  so that consumers see no change in how the board reports invalid docs, missing refs, oversized or malformed bodies, or unknown routes after the migration.

  # ADR-003: the error envelope { ok:false, error, code } with HTTP status =
  # error.status ?? 500, the specific status codes, the unknown-route 404, and the
  # empty/malformed-JSON 400 are preserved as the COMMANDS' own contract (the input
  # validation + resolver nulls move into the commands; board-ui maps them to the
  # same envelope). The board-ui still owns the unknown-/api/work* 404 (it is a
  # routing concern, not an operation). test/board-api.test.mjs is the regression
  # net; this feature asserts the observable error contract over the migrated seam.
  Background:
    Given a fixtured work stream served by a stood-up board over /api/work*
    And the stream includes a top-level uat session "09"

  # The status-code mapping is unchanged across the error cases the board already
  # distinguished.
  Scenario Outline: each error case returns its milestone-03 status and code
    When the board receives "<request>"
    Then the response status is "<status>"
    And the body is { ok:false } with code "<code>"

    Examples:
      | request                                   | status | code               |
      | GET /api/work/doc?ref=08&doc=NONSENSE     | 400    | invalid-doc        |
      | GET /api/work/doc?ref=99&doc=SPEC         | 404    | ref-not-found      |
      | POST /api/work/feedback (no note)         | 400    | missing-note       |
      | POST /api/work/feedback (no ref)          | 400    | missing-ref        |
      | POST /api/work/feedback (target uat 09)   | 400    | unsupported-target |
      | GET /api/work/nope                        | 404    | not-found          |

  # A request body over the size cap is rejected with 413, unchanged.
  Scenario: an oversized feedback body is rejected with 413 payload-too-large
    When the board posts a feedback body larger than the size cap
    Then the response status is 413
    And the body is { ok:false } with code "payload-too-large"

  # An empty or malformed JSON body on the write route is a 400, unchanged.
  Scenario Outline: an empty or malformed feedback body is a 400
    When the board posts "<body>" to /api/work/feedback
    Then the response status is 400
    And the body is { ok:false } with code "<code>"

    Examples:
      | body            | code          |
      | (empty)         | empty-json    |
      | {not json       | malformed-json|

  # The error envelope shape itself is byte-stable: a known failure renders exactly
  # the milestone-03 { ok, error, code } keys, no more, no fewer.
  Scenario: the error envelope keys are exactly { ok, error, code }
    When the board receives "GET /api/work/doc?ref=08&doc=NONSENSE"
    Then the response body has exactly the keys "ok", "error", and "code"
    And "ok" is false
