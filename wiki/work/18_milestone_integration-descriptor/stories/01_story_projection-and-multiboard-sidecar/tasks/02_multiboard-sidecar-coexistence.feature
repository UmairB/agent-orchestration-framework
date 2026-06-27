@cli @adapter @work-stream
Feature: the derived sidecar holds bindings for more than one board at once, so syncing one board never clobbers another
  In order to let two milestones routed to DIFFERENT boards each land in the right place after one sync-work
  the git-ignored page-id sidecar must key its entries per data-source so a binding under board A and a binding
  under board B coexist in one file — recording B leaves A's bucket untouched, a ref resolves ONLY under its own
  data-source, and an existing single-board (v1) sidecar migrates to the multi-board (v2) shape on first read.

  # ADR-005: re-key .aof/notion.work-map.json to { version:2, boards: { "<dataSourceId>": { entries:
  # { "<aofRef>": { pageId, lastStatus, lastSyncedAt } } } } }. readMapping(projectRoot, dataSourceId) returns
  # the entries under THAT data-source's bucket (empty when absent); recordPageId writes into that bucket,
  # leaving other buckets untouched (the old shape REPLACED the scope — mapping.mjs:85-91 — the clobber this
  # fixes). The per-board scoping guarantee is preserved at the bucket boundary (a ref resolves only under its
  # own data-source). v1 migration: a { version:1, dataSourceId, entries } file is read as the bucket for its
  # own dataSourceId; the first recordPageId rewrites it v2. The sidecar stays DERIVED + git-ignored (ADR-006).
  #
  # OBSERVABLE behaviours of the mapping store over fixtures — @executable. The "routing is never read from the
  # sidecar; the entry shape gains no routing field" guarantee is FF-A (story 02), NOT a Then here. Comment-only.

  Background:
    Given a project with a git-ignored ".aof/notion.work-map.json" sidecar
    And board "ops" has data-source "ds-ops" and board "growth" has data-source "ds-growth"

  @executable
  Scenario: a binding under one board and a binding under another coexist in one sidecar
    Given the sidecar records "18" → "page-A" under data-source "ds-ops"
    When I record "19" → "page-B" under data-source "ds-growth"
    Then resolving "18" under "ds-ops" still returns "page-A"
    And resolving "19" under "ds-growth" returns "page-B"

  # The exact clobber the fix removes: recording into board B must not empty board A's bucket.
  @executable
  Scenario: recording into a second board does not clobber the first board's bindings
    Given the sidecar records "18" → "page-A" under data-source "ds-ops"
    When I record "18" → "page-B" under data-source "ds-growth"
    Then resolving "18" under "ds-ops" still returns "page-A"
    And resolving "18" under "ds-growth" returns "page-B"

  # The per-board scoping guarantee survives the re-shape: a ref resolves ONLY under its own data-source.
  @executable
  Scenario: a ref does not resolve under a data-source it was not bound under
    Given the sidecar records "18" → "page-A" under data-source "ds-ops"
    When I resolve "18" under data-source "ds-growth"
    Then the resolution is a miss

  # v1 → v2 migration is additive and safe (a derived artifact re-derives): an old single-board file is read as
  # its data-source's bucket, and the first record rewrites it in v2 shape.
  @executable
  Scenario: a legacy v1 single-board sidecar migrates on first read
    Given a legacy v1 sidecar { version:1, dataSourceId:"ds-ops", entries: { "18": page-A } }
    When I read the mapping for data-source "ds-ops"
    Then resolving "18" returns "page-A"

  # The migration must keep the v1 file's per-board scope: a v1 file bound to ds-ops must NOT resolve under
  # ds-growth (the same cross-board guard the old shape had at mapping.mjs:62 — now applied to the migration
  # path so a v1 binding can't silently collide on another board).
  @executable
  Scenario: a legacy v1 sidecar does not resolve under a different data-source
    Given a legacy v1 sidecar { version:1, dataSourceId:"ds-ops", entries: { "18": page-A } }
    When I read the mapping for data-source "ds-growth"
    Then resolving "18" is a miss

  @executable
  Scenario: the first record after a v1 read rewrites the sidecar non-lossily in v2 shape
    Given a legacy v1 sidecar for data-source "ds-ops" holding "18" → "page-A"
    When I record "19" → "page-B" under data-source "ds-growth"
    Then the sidecar version is 2
    And re-reading "ds-ops" still resolves "18" → "page-A"
    And re-reading "ds-growth" resolves "19" → "page-B"

  # An absent sidecar is an empty mapping under any data-source — never an error (the first sync depends on it).
  @executable
  Scenario: an absent sidecar is an empty mapping, not an error
    Given no sidecar file exists
    When I read the mapping for data-source "ds-ops"
    Then the read succeeds with no entries
