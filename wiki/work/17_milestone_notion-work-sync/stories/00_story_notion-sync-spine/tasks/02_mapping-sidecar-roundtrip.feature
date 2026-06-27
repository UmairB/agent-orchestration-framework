@cli @adapter @work-stream
Feature: the .aof/ mapping sidecar binds each aof ref to its Notion page id and survives a re-read
  In order to make re-syncs update the SAME Notion page in place instead of duplicating it
  the system must, over the git-ignored .aof/notion.work-map.json sidecar, read an empty mapping from an
  absent file without throwing, resolve a recorded page id on a HIT and null on a MISS, persist a binding
  that survives a re-read, and scope bindings per dataSourceId so two boards never collide.

  # ADR-001: src/notion/mapping.mjs is the SOLE aof-item ↔ Notion-page identity store, a derived git-ignored
  # .aof/ artifact keyed by aof ref ("17" / "17/01"), scoped per dataSourceId. Frozen contract:
  #   readMapping(projectRoot, dataSourceId) → { entries }   (empty on absent file — NEVER throws)
  #   resolvePageId(mapping, aofRef)         → pageId | null  (HIT → pageId; MISS → null)
  #   recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta) → persist the binding back
  # These scenarios drive the store against a temp projectRoot with no live Notion — so the whole lane is
  # @executable.
  #
  # These are OBSERVABLE behaviours of the store contract: an absent-file read returns empty and does not
  # throw; a HIT resolves the recorded id; a MISS resolves null; a recorded binding round-trips through a
  # fresh readMapping with its lastStatus/lastSyncedAt carried; a binding under one dataSourceId does not
  # resolve under a different one.
  #
  # STRUCTURAL — "the sidecar is the SOLE store / no resolve-by-query / no identity-property write on a page /
  # the sidecar path is in AOF_GITIGNORE_ENTRIES" are story-03 arch-test acd-notion-mapping-sidecar
  # (ADR-005 inv. 1), proven over the SOURCE + injected fs, NOT Thens here. Comment-only — do not restate
  # them as Thens.

  Background:
    Given an empty temp project root with no ".aof/notion.work-map.json" sidecar
    And a data-source id "ds-A"

  # ADR-001: readMapping returns an empty mapping on an absent file and never throws — the projection's first
  # run depends on this (a fresh project has no sidecar yet).
  @executable
  Scenario: readMapping on an absent sidecar returns an empty mapping and never throws
    When I read the mapping for data-source "ds-A"
    Then the call does not throw
    And the mapping has no entries

  # ADR-001: a HIT means the page is known — resolvePageId returns the recorded page id so the projection
  # PATCHes in place.
  @executable
  Scenario: resolvePageId returns the recorded page id on a HIT
    Given the binding aof ref "17" to page id "page-17" is recorded under data-source "ds-A"
    When I read the mapping for data-source "ds-A"
    And I resolve the page id for aof ref "17"
    Then the resolved page id is "page-17"

  # ADR-001: a MISS means create — resolvePageId returns null so the projection knows to POST a new page.
  @executable
  Scenario: resolvePageId returns null on a MISS
    When I read the mapping for data-source "ds-A"
    And I resolve the page id for aof ref "17/01"
    Then the resolved page id is null

  # ADR-001: recordPageId persists the binding back; a fresh readMapping resolves it (record → readMapping →
  # resolvePageId HIT), with the lastStatus/lastSyncedAt meta carried.
  @executable
  Scenario: a recorded binding survives a re-read with its meta carried
    Given I record aof ref "17/01" to page id "page-1701" under data-source "ds-A" with status "in-progress" at "2026-06-25T10:00:00Z"
    When I read the mapping for data-source "ds-A" fresh
    And I resolve the page id for aof ref "17/01"
    Then the resolved page id is "page-1701"
    And the entry for aof ref "17/01" carries lastStatus "in-progress"
    And the entry for aof ref "17/01" carries lastSyncedAt "2026-06-25T10:00:00Z"

  # ADR-001: scoped per dataSourceId so two boards do not collide — a config change to a DIFFERENT
  # data-source does NOT silently re-bind stale page ids.
  @executable
  Scenario: a binding recorded under one data-source does not resolve under a different one
    Given I record aof ref "17" to page id "page-17" under data-source "ds-A"
    When I read the mapping for data-source "ds-B"
    And I resolve the page id for aof ref "17"
    Then the resolved page id is null
