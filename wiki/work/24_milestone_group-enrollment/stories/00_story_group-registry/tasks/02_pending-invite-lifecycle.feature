@cli @work @distribution @executable
Feature: the pending-invite durable shape — a pending invite carries a codeHash never a plaintext code, consuming marks it single-use, and a TTL read flags now strictly past expiresAt
  In order to record an outstanding device code durably without ever committing a plaintext secret to the git-synced registry, and to bound it in time and re-use
  a pending invite is appended as { codeHash, issuedAt, expiresAt, consumedAt:null } — the durable record carrying a codeHash never a bare code — consuming sets consumedAt (single-use), and a TTL read flags expiry when the injected now is strictly greater than expiresAt,
  so that the registry never persists a live plaintext credential (TB-3: it is committed + pushed to every peer + lives in git history), a matched code is burned exactly once, and an aged code reads expired on the strict-> boundary the mesh reuses from the run layer.

  # ARCHITECTURE ADR-001 (the pending schema) + ADR-002 (the match/consume/TTL semantics
  # the endpoint reads): a pending invite is the durable record { codeHash, issuedAt,
  # expiresAt, consumedAt:null }. This feature asserts the OBSERVABLE durable SHAPE + the
  # pure lifecycle accessors — the record carries a codeHash and NO bare plaintext code
  # field, consuming sets consumedAt (single-use), and a TTL read flags now > expiresAt
  # (strict >). The code-hash CRYPTO (that the code is hashed with node:crypto before the
  # write, no plaintext at rest) is the SECURITY-owned acd-enrollment-code-hashed-at-rest
  # fitness — NOT asserted here; this feature treats codeHash as an OPAQUE string and asserts
  # only the STRUCTURAL shape (a codeHash field exists; no bare code/deviceCode/plaintext
  # field is persisted). The single-use CONSUME verb + constant-time compare are story 01's
  # match crypto (acd-enrollment-code-single-use-constant-time); this feature owns the
  # DURABLE SHAPE + the pure TTL/consume read, not the hashing or the compare.
  #
  # QA FEASIBILITY FLAG (developer-amigo): white-box over the pure pending-invite accessors
  # — a registry value in, a registry value / a boolean out (no fs, no relay, no git, no
  # crypto). codeHash is treated as an OPAQUE string (this story owns the durable SHAPE; the
  # hashing is story 01 + the security fitness). Every now / issuedAt / expiresAt is an
  # INJECTED value, NEVER wall-clock (the 22/R2 discipline) — so the strict-> TTL boundary
  # is asserted deterministically. Buildable STANDALONE alongside task 00. Buildable
  # @executable; no feasibility concern RAISED.
  Background:
    Given the mesh-registry pending-invite accessors (append / consume / a TTL-expiry read — pure over a registry value)
    And an empty registry with pending []
    And injected issuedAt / expiresAt / now timestamps I control (never wall-clock)

  # The durable SHAPE: appending a pending invite stores { codeHash, issuedAt, expiresAt,
  # consumedAt:null } — the record carries a codeHash. R4 (the structural write-scope pin):
  # NO bare code / deviceCode / plaintext field is persisted on the record (the durable
  # shape carries only the hash; the hashing crypto is the security-owned
  # acd-enrollment-code-hashed-at-rest, NOT asserted here — codeHash is opaque).
  Scenario: appending a pending invite stores { codeHash, issuedAt, expiresAt, consumedAt:null } with no plaintext code field
    Given a codeHash "OPAQUE-HASH-1", issuedAt "2026-07-01T10:00:00Z", and expiresAt "2026-07-01T10:05:00Z"
    When I append that pending invite
    Then pending contains a record with codeHash "OPAQUE-HASH-1", issuedAt "2026-07-01T10:00:00Z", expiresAt "2026-07-01T10:05:00Z"
    And that record's consumedAt is null (a fresh invite is unconsumed)
    And the record carries a codeHash field (an opaque string — the hashing crypto is the security-owned fitness, not asserted here)
    And NO bare "code", "deviceCode", or "plaintext" field is persisted on the record

  # Single-use consume: marking an invite consumed sets consumedAt, and the accessor
  # DISTINGUISHES pending (consumedAt null, not expired) from consumed (consumedAt set).
  # R4: pin the UNAFFECTED side — consuming sets ONLY consumedAt; the codeHash / issuedAt /
  # expiresAt on that record are byte-unchanged (a consume is a marker, not a rewrite).
  Scenario: marking an invite consumed sets consumedAt, and the accessor reads it as consumed thereafter
    Given a pending invite with codeHash "OPAQUE-HASH-1" whose consumedAt is null
    When I mark that invite consumed at "2026-07-01T10:03:00Z"
    Then that invite's consumedAt is "2026-07-01T10:03:00Z"
    And the accessor reads that invite as consumed (not pending)
    And an invite whose consumedAt is null and is not expired reads as pending (the distinction the endpoint reads)
    And that invite's codeHash, issuedAt, and expiresAt are byte-unchanged by the consume (a marker, not a rewrite)

  # The TTL boundary — the load-bearing literal. A TTL read flags expiry when the INJECTED
  # now is STRICTLY greater than expiresAt (strict >, matching the m20 isStale strict->
  # discipline the mesh reuses). The AT-boundary row is load-bearing: now == expiresAt is
  # NOT expired (== is not >), so an invite is presentable right up to and including its
  # expiresAt instant. The Examples literal MUST agree with the strict-> post-rule value
  # (the 22/R2 "get the boundary literal right" discipline). Each row fixes expiresAt at a
  # reference instant and varies now relative to it.
  Scenario Outline: a TTL read flags an invite expired only when now strictly exceeds expiresAt
    Given a pending invite with expiresAt "2026-07-01T10:05:00Z"
    When I read its expiry against an injected now of <now vs expiresAt>
    Then the invite expired flag is <expired>

    Examples:
      | now vs expiresAt                    | expired |
      | 2026-07-01T10:00:00Z (before)       | false   |
      | 2026-07-01T10:04:59Z (one s before) | false   |
      | 2026-07-01T10:05:00Z (equal)        | false   |
      | 2026-07-01T10:05:01Z (one s after)  | true    |
      | 2026-07-01T10:10:00Z (after)        | true    |

  # R4 (the add-only-marker pin): consuming ONE invite leaves OTHER pending invites
  # untouched — the consume marks the ONE record, never the others (the same add-only /
  # no-peer-rewrite property the roster holds). Pin BOTH sides: the consumed one reads
  # consumed AND every other pending invite is byte-unchanged.
  Scenario: consuming one invite leaves the other pending invites byte-unchanged
    Given pending invites with codeHash "OPAQUE-HASH-1", "OPAQUE-HASH-2", and "OPAQUE-HASH-3", all with consumedAt null
    And I record the on-value bytes of the "OPAQUE-HASH-2" and "OPAQUE-HASH-3" invites
    When I mark the "OPAQUE-HASH-1" invite consumed at "2026-07-01T10:03:00Z"
    Then the "OPAQUE-HASH-1" invite reads as consumed
    And the "OPAQUE-HASH-2" and "OPAQUE-HASH-3" invites are byte-unchanged (the consume marked only the one record)
    And no other pending invite's consumedAt was set (an add-only marker on the one record)
