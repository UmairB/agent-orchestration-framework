@executable @cli @work @distribution @bug @finding-F-3203
Feature: a sidecar whose nodeId was derived from a hostname that no longer matches this machine re-derives from the CURRENT hostname and rewrites the sidecar — a copied identity sidecar self-corrects; an operator-pinned id is honoured and never auto-healed
  In order that a copied .aof/mesh/identity.json (the clone/copy symptom) self-corrects and not only committed config
  a sidecar whose nodeId was hostname-DERIVED but whose recorded hostname no longer matches this machine's current hostname re-derives from the CURRENT hostname and rewrites the sidecar (ADR-004.5), so a copied identity sidecar self-corrects; an operator-PINNED id (explicitly set, not hostname-derived) is honoured and NOT auto-healed (the pin wins),
  so that copying a whole .aof tree between machines cannot silently share a nodeId, while an operator who deliberately pinned an id keeps it.

  # ARCHITECTURE ADR-004.5 (self-heal on hostname/nodeId mismatch): if the sidecar's
  # nodeId was DERIVED from a hostname that no longer matches this machine's current
  # hostname (the clone/copy symptom), re-derive from the current hostname and rewrite the
  # sidecar. ADR-004.2 (pinned-wins-verbatim, node-identity.mjs:74-78) constrains the
  # exception — an operator-pinned id is not hostname-derived, so it is NOT healed.
  #   1. THE HEAL PREDICATE needs to distinguish a DERIVED id from a PINNED id. The sidecar
  #      records enough to decide: it carries the hostname the id was DERIVED from (a new
  #      sidecar field, e.g. `derivedFrom` / `origin:"hostname"`), OR a `pinned:true` flag
  #      for an operator-set id. Heal fires iff origin is "hostname" AND
  #      sanitizeHostname(currentHostname) !== the recorded sidecar nodeId;
  #   2. ON HEAL: re-derive via deriveNodeId from the CURRENT injected hostname + the
  #      sidecar's salt, and REWRITE the sidecar { nodeId, salt, derivedFrom:currentHostname }
  #      (the persistNodeId read-merge-write idiom node-identity.mjs:112-125);
  #   3. NO HEAL when the recorded hostname's sanitization still equals the sidecar nodeId
  #      (this IS this machine) OR the id is operator-pinned (pinned:true) — the sidecar is
  #      left BYTE-UNCHANGED;
  #   4. the current hostname is the INJECTED hostname (deriveNodeId's white-box seam,
  #      node-identity.mjs:73), so every heal/keep row is testable with NO real hostname read.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness acd-mesh-identity-not-committed (ADR-006) guards the COMMITTED config only;
  #    self-heal operates on the git-ignored SIDECAR, so no arch-test asserts this — it is
  #    purely a behavioural contract. THIS feature asserts the OBSERVABLE self-heal outcome
  #    (the sidecar's resulting nodeId + whether it was rewritten byte-for-byte) for each
  #    hostname-match / hostname-differ / operator-pinned case.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the self-heal rows stay @executable ONLY if
  #  (a) the SIDECAR RECORDS ENOUGH to distinguish derived-from-hostname vs operator-pinned
  #      — i.e. the sidecar schema gains a discriminator (a recorded derivedFrom hostname
  #      and/or a pinned flag). Without it, a hostname-derived id and an operator-pinned id
  #      that HAPPEN to look like a stale hostname are indistinguishable, and the
  #      "operator-pinned is not healed" row is not deterministically decidable. Confirm the
  #      sidecar carries this discriminator (the ADR-004.5 mismatch predicate needs it);
  #  (b) the heal path takes the CURRENT hostname as an injected input (the deriveNodeId
  #      hostname arg, node-identity.mjs:73) and the sidecar path as an injected target — so
  #      a test drives "current hostname differs from recorded" with two fixture strings and
  #      asserts the rewritten sidecar bytes, no real machine hostname needed;
  #  (c) WHERE self-heal fires is confirmed — on the loadWorkspace hydration read (task 01)
  #      or on the deriveNodeId path (task 00). If it fires in loadWorkspace, note that
  #      loadWorkspace otherwise writes no file (task 01's "no disk write" assertion) — a
  #      heal is the ONE sanctioned sidecar rewrite on load, so the two contracts must be
  #      reconciled (the developer confirms the heal site + that it is the only load-time write).
  # RAISED — do NOT retag to @manual; the whole matrix is injected-hostname + planted-sidecar
  # fixtures with byte-level sidecar assertions. The REAL cross-OS copy is task 04 (@manual),
  # a different lane. Sub-flag (a) (the sidecar discriminator schema) is the load-bearing one:
  # the developer must confirm the sidecar carries derivedFrom/pinned before this is testable.
  # See VERIFICATION.
  #
  # RESOLVED (developer-amigo): all three sub-flags resolved. (a) is the LOAD-BEARING
  # decision — stated concretely below; (b)/(c) confirmed feasible given (a).
  #
  #  (a) THE SIDECAR SCHEMA DECISION — `.aof/mesh/identity.json` is:
  #        { nodeId: string, salt: string, derivedFrom?: string, pinned?: true }
  #      Discriminator semantics (mutually exclusive by construction — the persist path
  #      never sets both):
  #        - HOSTNAME-DERIVED id (the common case, task 00's persist / task 01's default
  #          overlay path): the sidecar carries `derivedFrom: <the hostname sanitizeHostname
  #          was fed>` — recorded by the SAME re-pointed `persistNodeId`-idiom write
  #          (task 00's resolved flag (b)) whenever `deriveNodeId` resolves via the
  #          hostname-stem or empty-stem-fallback path (node-identity.mjs:81-93/38-49) — the
  #          COLLISION-SUFFIXED id (`<stem>-<hash>`) is STILL "derived" (`derivedFrom` records
  #          the raw hostname fed in, not the resolved id — this is why the feature's
  #          shared-host examples compare `sanitizeHostname(currentHostname)` against the
  #          RESOLVED id, not against `derivedFrom` verbatim, for the mismatch test);
  #        - OPERATOR-PINNED id (an operator explicitly sets `config.mesh.nodeId` — the
  #          existing pinned-wins-verbatim precedent, `node-identity.mjs:74-78`, now
  #          per-install): the sidecar instead carries `pinned: true` and NO `derivedFrom`.
  #      HEAL PREDICATE (exactly the feature's stated rule): heal fires iff
  #      `sidecar.pinned !== true` AND `typeof sidecar.derivedFrom === "string"` AND
  #      `sanitizeHostname(currentHostname) !== sidecar.nodeId` (comparing against the
  #      recorded RESOLVED nodeId, which already accounts for a possible collision suffix —
  #      re-deriving on heal reapplies `deriveNodeId` fresh with the CURRENT hostname +
  #      the sidecar's OWN salt + the current taken-roster, so a genuinely-still-colliding
  #      stem gets re-suffixed consistently, per the feature's "heal re-derives with the
  #      sidecar's own salt" scenario). Without `derivedFrom`/`pinned`, "operator-pinned is
  #      not healed" is undecidable exactly as QA flagged — a hostname-derived id and a
  #      pinned id that happen to share a string are indistinguishable on `nodeId` alone.
  #      This schema is the MINIMAL addition that makes the discriminator decidable while
  #      staying inside the read-merge-write idiom (two new OPTIONAL keys, no restructuring
  #      of `{nodeId,salt}`; a pre-existing sidecar written by an earlier build of this
  #      story before `derivedFrom`/`pinned` existed degrades safely — absent `derivedFrom`
  #      AND absent `pinned` is treated as "unknown origin, do not heal" so an old sidecar
  #      is never silently churned by a schema-version gap).
  #
  #  (b) HEAL SITE — CONFIRMED as `loadWorkspace` (work.mjs, task 01's hydration seam), NOT
  #      `deriveNodeId`. Rationale: the heal needs "the current machine's hostname" compared
  #      against a RECORD of provenance that only the sidecar (not `deriveNodeId`'s pure
  #      precedence chain) carries, and it must run on every load so a copied sidecar is
  #      caught the FIRST time this install's config is touched — not only when some command
  #      happens to call `deriveNodeId` (e.g. `mesh:status`, a pure read, never calls
  #      `deriveNodeId` today — `commands/mesh-identity.mjs:205` reads `ws.config?.mesh?.nodeId`
  #      directly). Placing the heal in `loadWorkspace` means EVERY command that loads the
  #      workspace (all of them, per the `loadWorkspace(...)` call sites in `cli.mjs`,
  #      `board-ui.mjs`, `mesh-ui-serve.mjs`, `terminal-ws.mjs`) gets the self-heal for free,
  #      matching ADR-004.5's "self-heal on hostname/nodeId mismatch" framed as a LOAD-time
  #      concern, not a derive-time one. `os.hostname()` is read at the `loadWorkspace` call
  #      boundary (the ONE real impure edge, mirroring `commands/doctor.mjs:31`'s `Date.now()`
  #      pattern of keeping the impure read at the boundary) and threaded into the hydration
  #      step as an injectable arg for tests (mirroring `deriveNodeId`'s own injected-hostname
  #      seam, `node-identity.mjs:73`) — so `loadWorkspace(cwd, explicitConfig, { hostname })`
  #      (or an equivalent options bag) is the test seam; production supplies `os.hostname()`
  #      when the override is absent.
  #
  #  (c) RECONCILING WITH TASK 01's "loadWorkspace writes no file" — the heal write is a
  #      DELIBERATE, DISCRIMINATED EXCEPTION, not the common path. Task 01's assertion
  #      ("loadWorkspace wrote NO file") holds for the PRECEDENCE-OVERLAY scenarios in that
  #      feature, because none of those fixtures trigger the heal predicate (their sidecars
  #      either have no `derivedFrom`/`pinned` recorded in the fixture at all, or the
  #      fixture's hostname is not exercised as "current ≠ recorded"). The heal fires ONLY
  #      when the discriminator (a) says "derived" AND the hostname comparison says
  #      "mismatch" — a narrow, named condition, never the default overlay behaviour. So the
  #      contract is: `loadWorkspace` writes a file if-and-only-if the heal predicate fires;
  #      every other load (no sidecar, sidecar-matches-host, sidecar-pinned) is a pure read,
  #      exactly as task 01 states. This story's build notes should make this exception
  #      explicit in `loadWorkspace`'s own header comment so a future reader does not
  #      mistake the heal write for a violation of the "hydration overlays, never persists"
  #      rule — it is ADR-004.5's own carve-out, not a drift from ADR-004.3.
  Background:
    Given a fixture aof project whose sidecar .aof/mesh/identity.json I control
    And the sidecar schema records the hostname an id was derived from (or a pinned flag)
    And the self-heal path takes this machine's CURRENT hostname as an injected input

  # THE SELF-HEAL MATRIX (ADR-004.5): the ONE table pinning hostname-matches → keep,
  # hostname-differs (derived) → re-derive+rewrite, operator-pinned → keep. "kept" = the
  # sidecar is byte-unchanged; "re-derived" = the sidecar's nodeId becomes
  # sanitizeHostname(current-hostname) and the file is rewritten.
  Scenario Outline: self-heal re-derives a stale hostname-derived sidecar id, keeps a matching or operator-pinned id
    Given a sidecar holding <sidecar-before>
    And this machine's current hostname is "<current-hostname>"
    When the identity self-heal runs
    Then the sidecar's resulting nodeId is "<resulting-nodeId>"
    And the sidecar was <rewrite> (re-derived from the current hostname, or left byte-unchanged)

    Examples:
      | sidecar-before                                                | current-hostname | resulting-nodeId | rewrite            | case              |
      | { nodeId:"macbook-pro", salt:"s", derivedFrom:"macbook-pro" } | macbook-pro      | macbook-pro      | left byte-unchanged| hostname-matches  |
      | { nodeId:"umairs-msi", salt:"s", derivedFrom:"umairs-msi" }   | macbook-pro      | macbook-pro      | rewritten          | hostname-differs  |
      | { nodeId:"umairs-msi", salt:"s", derivedFrom:"umairs-msi" }   | Umair's MacBook  | umair-s-macbook  | rewritten          | differ+sanitize   |
      | { nodeId:"operator-choice", salt:"s", pinned:true }           | macbook-pro      | operator-choice  | left byte-unchanged| operator-pinned   |

  # THE COPIED-SIDECAR SYMPTOM SELF-CORRECTS (ADR-004.5, the exact F-3203 copy case): an
  # operator copies the WHOLE .aof tree (including .aof/mesh/identity.json) from the origin
  # machine to a new host. The copied sidecar carries the origin's nodeId "umairs-msi"
  # derived from the origin hostname. On the new host (a different hostname) the heal
  # re-derives, so the two machines end with DISTINCT sidecar ids — no shared nodeId, no
  # clobbered nodes/<id>.json (the m22 partition invariant holds).
  Scenario: a copied identity sidecar re-derives on a different host so the two machines never share a nodeId
    Given a sidecar copied verbatim from the origin: { nodeId:"umairs-msi", salt:"origin-salt", derivedFrom:"umairs-msi" }
    And this machine's current hostname is "macbook-pro" (a different host)
    When the identity self-heal runs
    Then the sidecar's resulting nodeId is "macbook-pro"
    And the resulting nodeId is NOT the origin's "umairs-msi" (identity self-corrected)
    And this machine now publishes to nodes/macbook-pro.json, never the origin's nodes/umairs-msi.json

  # HEAL RE-DERIVES WITH THE SIDECAR'S OWN SALT, PRESERVING THE COLLISION SUFFIX
  # (ADR-004.5 + node-identity.mjs:90-93): the heal re-derive uses the sidecar's recorded
  # salt (not a fresh one), so if the re-derived stem collides against the synced roster it
  # gets the SAME stable installHash(salt) suffix — the heal keeps the id deterministic and
  # per-install, never minting a new salt that would churn the install hash.
  Scenario: self-heal re-derives with the sidecar's own salt so the install hash stays stable
    Given a sidecar { nodeId:"origin-host", salt:"fixed-salt-A", derivedFrom:"origin-host" }
    And this machine's current hostname is "shared-host" already taken in the synced roster
    When the identity self-heal runs
    Then the sidecar's resulting nodeId is "shared-host-<installHash("fixed-salt-A")>"
    And the resulting sidecar retains salt "fixed-salt-A" (no fresh salt minted)

  # HEAL IS THE ONLY LOAD-TIME SIDECAR WRITE, AND IT REWRITES derivedFrom (ADR-004.5): when
  # a heal fires it must record the NEW hostname it derived from, so a SECOND load on the
  # same (now-correct) host is a keep, not a repeated rewrite — the heal is self-terminating,
  # not a rewrite-every-load. This is the idempotence guarantee for the heal path.
  Scenario: after a heal the sidecar records the new hostname so a second load is a keep (heal is self-terminating)
    Given a sidecar { nodeId:"umairs-msi", salt:"s", derivedFrom:"umairs-msi" } and current hostname "macbook-pro"
    When the identity self-heal runs a first time
    Then the sidecar becomes { nodeId:"macbook-pro", salt:"s", derivedFrom:"macbook-pro" }
    And a SECOND self-heal with the SAME current hostname "macbook-pro" leaves the sidecar byte-unchanged
