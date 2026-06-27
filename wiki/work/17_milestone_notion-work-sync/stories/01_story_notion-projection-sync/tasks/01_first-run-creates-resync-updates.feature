@cli @adapter @work-stream
Feature: a first sync creates the board pages; a re-sync updates them in place without duplicating
  In order to keep the Notion board matching the on-disk stream after one command, the live sync must
  create the milestone page and each story sub-task on the first run and record each binding, then on a
  second run over unchanged disk report every item unchanged and create no duplicate, and on a moved
  on-disk status patch that page's status in place — created-then-updated-in-place, idempotent.

  # ADR-003/ADR-002: src/notion/sync.mjs applies the plan over the ADR-004 CLI spawn seam — create → POST a
  # page (parent = data-source, relation set, status set) then recordPageId (ADR-001); patch → PATCH the
  # page properties by id; noop/skip → no Notion call. The SyncResult envelope reports per item created /
  # updated / unchanged / skipped / no-op + the Notion page ref.
  #
  # EXECUTABLE/MANUAL SPLIT: the create→recordPageId→patch-in-place MECHANIC is offline-provable through the
  # INJECTED spawn seam (ctx.notionSpawn) with NO token — the spy stands in for the CLI and returns a known
  # page id, and the assertions read the seam argv (pages create / pages update), the envelope action
  # (created / no-op / updated), and the recorded sidecar binding. Those are the @executable scenarios below
  # (test/notion-apply-idempotent.test.mjs). Each is paired with a @manual scenario that asserts the SAME
  # outcome on a LIVE Notion workspace + real integration token (RESEARCH §A1/A2 — no token on the dev host),
  # exercising the real `ntn api` round-trip + the §A6 429/Retry-After pacing against an actual board. The
  # never-half-write invariant is story-03's arch-test acd-notion-fail-honestly (ADR-005 inv. 7).

  Background:
    Given a work.integrations.notion config bound to a data-source with a complete statusMap
    And a fixture milestone "17" not yet bound in the sidecar

  # @executable: the create MECHANIC over the injected seam — a first sync over an EMPTY sidecar POSTs a
  # `pages create`, maps it to "created" with the returned page id, and records that id back into the
  # sidecar so the next sync resolves a patch. No token, no network (the spy returns a known id).
  @executable
  Scenario: a first sync over an empty sidecar issues a page-create and records the binding
    Given the sidecar records no page for "17"
    When the apply layer runs a non-dry-run sync of "17" through the injected spawn seam
    Then the seam is called with a "pages create" argv for "17"
    And the result reports "created" for "17" with the page id the create returned
    And the sidecar now records that page id for "17"

  # @manual: the same first-run outcome against a LIVE, empty board — creates the milestone page + each story
  # sub-task (self-relation pointing at the milestone page) and records each ref→pageId binding. Needs a real
  # token + workspace (RESEARCH §A1/A2); exercises the real ntn api round-trip.
  @manual
  Scenario: a first sync creates the milestone page and each story sub-task and records the bindings
    Given a live Notion workspace with the board's data-source, status property, and self-relation property
    And the board has no page for "17", "17/01", or "17/02"
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And the board has a milestone page for "17" and a story sub-task for "17/01" and for "17/02"
    And each story sub-task's self-relation points at the milestone page
    And the result reports "created" for "17", "17/01", and "17/02"
    And the sidecar records a page id for "17", "17/01", and "17/02"

  # @executable: the no-duplicate MECHANIC over the injected seam — a second sync over a sidecar whose
  # recorded lastStatus matches unchanged disk issues ZERO seam calls (no second create) and reports no-op,
  # keeping the single recorded page id. Proven offline (the projection decides noop from local facts).
  @executable
  Scenario: a second sync over an unchanged sidecar issues no seam call and reports no-op
    Given the sidecar records a page id for "17" whose lastStatus matches the on-disk status
    When the apply layer runs a non-dry-run sync of "17" through the injected spawn seam
    Then the seam is not called for "17"
    And the result reports "no-op" for "17"
    And the sidecar still records the same single page id for "17"

  # @manual: the same idempotency against a LIVE board — a second run over UNCHANGED disk reports every item
  # unchanged/no-op and creates no second page (still exactly one page per ref). Needs a real token/workspace.
  @manual
  Scenario: a second sync over unchanged disk reports every item unchanged and creates no duplicate
    Given a first sync of "17" has already created and bound every page
    And no on-disk status has changed since that sync
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And the result reports "unchanged" or "no-op" for "17", "17/01", and "17/02"
    And the board still has exactly one page for each of "17", "17/01", and "17/02"

  # @executable: the patch-in-place MECHANIC over the injected seam — a moved on-disk status (the sidecar's
  # recorded lastStatus is now stale) issues a `pages update` carrying the SAME recorded page id (not a new
  # create) and reports "updated", re-recording the new mapped status. Proven offline.
  @executable
  Scenario: a moved on-disk status issues a page-update by the recorded id, not a new create
    Given the sidecar records a page id for "17" whose lastStatus is now stale versus the on-disk status
    When the apply layer runs a non-dry-run sync of "17" through the injected spawn seam
    Then the seam is called with a "pages update" argv carrying the recorded page id for "17"
    And no "pages create" argv is issued for "17"
    And the result reports "updated" for "17"

  # @manual: the same in-place patch against a LIVE board — a story whose on-disk status moved has its
  # EXISTING page's status patched to the newly mapped option, on the same page, reported updated; no new
  # page is created. Needs a real token/workspace + the real ntn api round-trip.
  @manual
  Scenario: a story whose on-disk status moved is patched in place on the next sync
    Given a first sync of "17" has already created and bound every page
    And the on-disk status of "17/01" has moved to a new value that the statusMap covers
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And the existing page for "17/01" now shows the board option mapped from its new on-disk status
    And the result reports "updated" for "17/01"
    And no new page is created for "17/01"
