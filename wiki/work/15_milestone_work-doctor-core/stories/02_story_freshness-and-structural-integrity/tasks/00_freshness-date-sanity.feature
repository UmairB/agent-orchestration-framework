@cli @work @work-stream @executable @validate
Feature: The freshness / date-sanity check-group reports stale and malformed dates against an injected clock
  In order to catch a stream that passes validate but hides a months-stale in-progress item or an impossible date
  the freshness check-group reads each item's recorded created/updated dates and its folder's newest file mtime, compares them against an INJECTED now + staleWindow, and emits a coded { stale-updated | updated-before-created | unparseable-date | mtime-ahead-of-updated } finding,
  so that an operator gets a deterministic, reproducible-in-CI health finding for a date the per-file validate lane cannot see across the snapshot's metadata.

  # ADR-003: the engine is clock-free. `now` (a fixed millisecond/Date) and
  # `staleWindow` (a config-sourced duration) arrive through ctx; the group is a
  # PURE function of the snapshot's recorded dates + per-item folder-mtime probe
  # and the injected clock — it reads NO Date.now()/new Date(). Determinism + the
  # no-wall-clock guarantee are story 00's ARCH-TESTS (not asserted here); these
  # scenarios assert only the OBSERVABLE finding, made deterministic by PINNING
  # `now` in the fixture so every time relationship is explicit.
  # ADR-001: the envelope is { code, severity, path, message }; severity ∈
  # {warn, error}; an empty findings array means healthy (no "ok" rows). The
  # architect fixed stale-updated + mtime-ahead-of-updated at `warn`; this group
  # leans `error` for an IMPOSSIBLE/MALFORMED date (updated-before-created,
  # unparseable-date) — a coherence violation, not advice.
  # LITMUS: every Then asserts a finding present/absent given a PINNED `now` +
  # `staleWindow` + fixture — never that the engine avoids the wall-clock (that is
  # the determinism arch-test).

  Background:
    Given a work stream loaded as a snapshot with each item's recorded created/updated and its folder's newest file mtime
    And the freshness check-group run with an injected now of "2026-06-25T00:00:00Z" and a staleWindow of 30 days

  # The clean baseline: a fresh, well-dated, in-progress item — updated recently,
  # updated after created, no folder file newer than updated, all dates ISO — emits
  # nothing. A silent group over a healthy item is the contract (ADR-001).
  Scenario: a fresh, well-dated item produces no freshness findings
    Given an in-progress item created "2026-06-01" and updated "2026-06-20" whose newest folder file mtime is "2026-06-20T09:00:00Z"
    When the freshness check-group runs
    Then no freshness finding is reported for that item

  # stale-updated + its counter-row prove the window AND the injected `now` are
  # respected: with now=2026-06-25 and a 30d window, an updated of 2026-05-10 (46d
  # back) is stale; an updated of 2026-06-10 (15d back) is fresh — same code, same
  # `now`, opposite outcomes decided only by the window boundary.
  Scenario Outline: an in-progress item is stale only when updated falls outside the staleWindow before now
    Given an in-progress item whose updated is "<updated>" (created "2026-05-01") with all folder files older than updated
    When the freshness check-group runs
    Then the finding outcome is "<finding>"

    Examples: pinned now = 2026-06-25, staleWindow = 30 days
      | updated    | finding                  | # relation to now
      | 2026-05-10 | stale-updated / warn     | # 46 days before now → outside the 30d window → stale
      | 2026-05-26 | stale-updated / warn     | # 30 days + a margin before now → outside window → stale
      | 2026-06-10 | (none)                   | # 15 days before now → within the 30d window → fresh
      | 2026-06-24 | (none)                   | # 1 day before now → well within window → fresh

  # Status gates the staleness check: only an in-progress item can be "stale" on its
  # updated date (a done/not-started item updated long ago is not a freshness fault).
  # Same stale `updated`; only the in-progress row fires.
  Scenario Outline: the stale-updated check applies only to in-progress items
    Given a "<status>" item whose updated is "2026-04-01" (created "2026-03-01") with all folder files older than updated
    When the freshness check-group runs
    Then the finding outcome is "<finding>"

    Examples: pinned now = 2026-06-25, staleWindow = 30 days; updated is 85 days back
      | status      | finding              |
      | in-progress | stale-updated / warn |
      | done        | (none)               |
      | not-started | (none)               |

  # The date-coherence + parseability rows. updated-before-created and a date that
  # does not parse are IMPOSSIBLE/MALFORMED, not stale — leaning `error`. The
  # parsed-from-fixture dates make each row deterministic; the staleWindow is held
  # constant so only the date relationship under test varies the outcome.
  Scenario Outline: an out-of-order or unparseable date is reported with its code and severity
    Given an item with created "<created>" and updated "<updated>"
    When the freshness check-group runs
    Then the finding outcome is "<finding>"

    Examples: out-of-order chronology — updated strictly before created
      | created    | updated    | finding                        | # note
      | 2026-06-20 | 2026-06-01 | updated-before-created / error | # updated 19 days before created
      | 2026-06-20 | 2026-06-20 | (none)                         | # equal dates are not out of order

    Examples: unparseable / non-ISO dates on either field
      | created     | updated     | finding                  | # note
      | not-a-date  | 2026-06-20  | unparseable-date / error | # created does not parse
      | 2026-06-01  | 25-06-2026  | unparseable-date / error | # updated is non-ISO (DD-MM-YYYY)
      | 2026-13-40  | 2026-06-20  | unparseable-date / error | # created is ISO-shaped but an impossible calendar date
      | 2026-06-01  | 2026-06-20  | (none)                   | # both well-formed ISO → no date-sanity finding

  # mtime-ahead-of-updated: a file in the item's folder whose mtime is NEWER than
  # the item's recorded updated means the record was touched but `updated` was not
  # bumped — a warn (advisory drift, not an impossible date). The counter-row (all
  # folder files older-or-equal than updated) emits nothing. The mtime is snapshot
  # data (ADR-003), so the relationship is explicit and deterministic.
  Scenario Outline: a folder file mtime newer than updated is reported
    Given a well-dated item updated "2026-06-20T12:00:00Z" whose newest folder file mtime is "<mtime>"
    When the freshness check-group runs
    Then the finding outcome is "<finding>"

    Examples: pinned now = 2026-06-25; updated = 2026-06-20T12:00:00Z
      | mtime                | finding                       | # relation to updated
      | 2026-06-22T08:00:00Z | mtime-ahead-of-updated / warn | # a folder file 2 days newer than updated
      | 2026-06-20T12:00:01Z | mtime-ahead-of-updated / warn | # one second newer than updated
      | 2026-06-20T12:00:00Z | (none)                        | # mtime equals updated → not ahead
      | 2026-06-19T09:00:00Z | (none)                        | # mtime older than updated → not ahead
