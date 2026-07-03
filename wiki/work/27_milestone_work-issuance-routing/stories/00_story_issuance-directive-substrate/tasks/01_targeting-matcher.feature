@cli @work @distribution @executable
Feature: nodeSatisfiesTarget answers "does this node satisfy this directive's target?" as one pure total predicate over the frozen capability descriptor
  In order to route an issued item to an eligible node by node id or by capability with a single side-effect-free rule both next's routing filter (story 01) and any render consume — never two divergent match implementations
  the matcher reads only the m22-frozen descriptor fields as data — any ⇒ true for every node, node ⇒ nodeId equality, capability ⇒ membership in runtimes[] OR skills[] — and any unknown or malformed target ⇒ false (fail-safe),
  so that an untargeted directive is claimable fleet-wide, a node-targeted directive matches only that node id, a capability directive matches a node advertising that runtime or skill and skips one that does not, a bare minimal install matches nothing capability-scoped rather than crashing, and an unroutable directive offers to nobody rather than everybody.

  # ARCHITECTURE ADR-003 (story 00 — the eligibility / targeting matcher): the PURE
  # predicate nodeSatisfiesTarget(descriptor, target) in src/mesh-issuance.mjs, reading
  # the 22/ADR-003 FROZEN 7-key descriptor { nodeId, host, os, runtimes[], skills[],
  # aofVersion, publishedAt } AS DATA:
  #   1. { kind:"any" }               ⇒ true  (the fleet-wide offer — ADR-003.1);
  #   2. { kind:"node", nodeId }      ⇒ descriptor.nodeId === nodeId (ADR-003.2);
  #   3. { kind:"capability", value } ⇒ runtimes.includes(value) || skills.includes(value)
  #                                     (a runtime OR a skill match — ADR-003.3; absent /
  #                                     non-array fields read as [], the honest-minimal-install
  #                                     discipline, so a capability match against a bare install
  #                                     is false, never a crash);
  #   4. an unknown / malformed target.kind ⇒ false (fail-safe: an unroutable directive
  #      offers to nobody, never to everybody — ADR-003.4). The predicate is TOTAL and PURE.
  # It reads ONLY the frozen descriptor fields, imports NO node-identity mechanic
  # (no deriveNodeId / assembleDescriptor — no re-derivation, no re-assembly), and touches
  # no fs / no clock. Node-vs-capability disambiguation is an ISSUE-TIME decision (ADR-002.3 /
  # ADR-003 alternatives) frozen into target.kind BEFORE the matcher sees it — the matcher
  # receives an already-typed union and never reads the roster.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #3 (acd-targeting-matcher-descriptor-pure): src/mesh-issuance.mjs imports NO
  #    node-identity.mjs (an import grep) AND the matcher reads only the frozen descriptor
  #    fields (nodeId / runtimes / skills) — a SOURCE + import assertion with an m03
  #    planted-violation self-check, NOT a scenario here. The "no node-identity import" and
  #    "reads only frozen fields" invariants are structural.
  #  - THIS feature asserts the OBSERVABLE truth table: for a given (descriptor, target) pair,
  #    does the pure predicate return true or false — the routing verdict every consumer reads.
  #
  # FIXTURE NOTE — pure-data only. Every row here is a plain descriptor object × a plain
  # target union → a boolean; no fs, no git, no clock. Descriptors are assembled via
  # assembleDescriptor (src/node-identity.mjs:135, the frozen 7-key shape) OR built as plain
  # fixtures with the same key shape — the matcher reads them as data either way (ADR-003.4).
  # This is the assembleClaimRecord × resolveArbitration pure-predicate idiom (m26 story 01),
  # provable with zero fixtures on disk.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the outline imports nodeSatisfiesTarget from
  # src/mesh-issuance.mjs and calls it IN-PROCESS over fixture descriptors + fixture targets.
  # This assumes nodeSatisfiesTarget is an EXPORTED pure function of TWO plain-data arguments
  # (descriptor, target) — no injected roster, no fs, no config read — exactly the
  # resolveArbitration / claimLiveness pure-predicate shape (src/mesh-lease.mjs:147,162). If
  # the descriptor's runtimes/skills fields are read via a HELPER rather than direct property
  # access, confirm the helper is likewise pure and importable. No git-fixture or scripted
  # transport is needed — a data table suffices.
  # RAISED — do NOT silently retag to @manual or drop a row; see VERIFICATION.
  #
  # RESOLVED (developer-amigo): confirmed FEASIBLE, the assumed two-arg pure shape is LOCKED.
  # The precedent is exact: claimLiveness(claim, holderPresence, nowMs, thresholdMs)
  # (src/mesh-lease.mjs:147, a plain switch over plain-data args, zero fs/import-of-mutation)
  # and resolveArbitration(ownNodeId, claims, presenceById, nowMs, thresholdMs)
  # (src/mesh-lease.mjs:162, a `for` loop over plain arrays/Maps, zero fs) are both bare
  # exported functions in a module that itself imports NO write-capable seam for the
  # predicate's own body — nodeSatisfiesTarget(descriptor, target) in src/mesh-issuance.mjs
  # follows the SAME shape: `export function nodeSatisfiesTarget(descriptor, target) { … }`,
  # two plain-data positional arguments, no injected roster/fs/config/clock, a total switch on
  # `target?.kind` with `runtimes`/`skills` coerced via `Array.isArray(x) ? x : []` inline (the
  # assembleDescriptor field-coercion idiom, src/node-identity.mjs:140-141) — no separate
  # helper module, so there is nothing further to certify pure. Zero rows drop; the whole
  # outline (truth table + the bare-install row + the pure-read-independence scenario) runs
  # in-process over plain object literals, no fs, no git.
  Background:
    Given the pure predicate nodeSatisfiesTarget(descriptor, target) reading only the frozen capability descriptor fields nodeId, runtimes and skills as data

  # THE TARGETING TRUTH TABLE (ADR-003.1–4): one Scenario Outline over the full matrix of
  # (descriptor, target) → boolean. Every arm of the discriminated union is covered against a
  # spread of descriptors: any (true for every descriptor incl. a bare install), node (exact
  # id match vs wrong id), capability (runtime-only match, skill-only match, no match, and the
  # bare-install false — absent fields read as []), and the fail-safe unknown/malformed kind
  # (false, never true). The descriptor column names the node id + its runtimes[] + skills[]
  # (empty means the honest minimal install); explicit literals — the 22/R2 boundary discipline.
  Scenario Outline: nodeSatisfiesTarget returns the routing verdict for each descriptor and target
    Given a node descriptor with nodeId <node-id>, runtimes <runtimes> and skills <skills>
    When nodeSatisfiesTarget is asked about target <target>
    Then the result is <verdict>

    Examples: any ⇒ true for every descriptor (incl. a bare install)
      | node-id       | runtimes            | skills              | target                                    | verdict |
      | "build-server" | ["claude", "codex"] | ["planner"]         | { kind: "any" }                           | true    |
      | "laptop-a1b2"  | []                  | []                  | { kind: "any" }                           | true    |

    Examples: node ⇒ true iff nodeId matches, false otherwise
      | node-id       | runtimes            | skills              | target                                    | verdict |
      | "build-server" | ["claude"]          | []                  | { kind: "node", nodeId: "build-server" }  | true    |
      | "build-server" | ["claude"]          | []                  | { kind: "node", nodeId: "laptop-a1b2" }   | false   |
      | "laptop-a1b2"  | []                  | []                  | { kind: "node", nodeId: "build-server" }  | false   |

    Examples: capability ⇒ true iff value is in runtimes[] OR skills[]
      | node-id       | runtimes            | skills              | target                                       | verdict |
      | "build-server" | ["claude", "codex"] | ["planner"]         | { kind: "capability", value: "codex" }       | true    |
      | "build-server" | ["claude", "codex"] | ["planner"]         | { kind: "capability", value: "planner" }     | true    |
      | "build-server" | ["claude", "codex"] | ["planner"]         | { kind: "capability", value: "cursor" }      | false   |
      | "laptop-a1b2"  | []                  | []                  | { kind: "capability", value: "codex" }       | false   |
      | "runner-1"     | ["codex"]           | []                  | { kind: "capability", value: "codex" }       | true    |
      | "runner-1"     | []                  | ["planner"]         | { kind: "capability", value: "planner" }     | true    |

    Examples: unknown / malformed target ⇒ false (fail-safe — offers to nobody, never everybody)
      | node-id       | runtimes            | skills              | target                                    | verdict |
      | "build-server" | ["claude"]          | ["planner"]         | { kind: "everyone" }                      | false   |
      | "build-server" | ["claude"]          | ["planner"]         | { kind: "node" } (nodeId absent)          | false   |
      | "build-server" | ["claude"]          | ["planner"]         | { kind: "capability" } (value absent)     | false   |
      | "build-server" | ["claude"]          | ["planner"]         | { } (no kind)                             | false   |
      | "build-server" | ["claude"]          | ["planner"]         | null                                      | false   |

  # THE HONEST-MINIMAL-INSTALL FLOOR (ADR-003.3 — absent/non-array fields read as []): a
  # descriptor whose runtimes/skills keys are ABSENT (not merely empty) still resolves a
  # capability target to false rather than throwing — the matcher coerces a missing field to
  # []. This isolates the "never a crash" half of ADR-003.3 from the empty-array rows above.
  Scenario: a capability target against a descriptor missing runtimes and skills reads false, never a crash
    Given a node descriptor with nodeId "bare-node" and no runtimes or skills fields at all
    When nodeSatisfiesTarget is asked about target { kind: "capability", value: "codex" }
    Then the result is false
    And no error is raised (the absent fields coerce to [], never a throw)

  # THE PURE-READ INDEPENDENCE (ADR-003.4 — the matcher reads ONLY nodeId / runtimes / skills):
  # the verdict is decided from the three frozen capability fields alone; the descriptor's other
  # frozen keys (host, os, aofVersion, publishedAt) do NOT influence any arm. Two descriptors
  # identical on nodeId/runtimes/skills but differing on host/os/aofVersion/publishedAt yield the
  # SAME verdict for the same target — the "reads only frozen capability fields" behaviour that
  # fitness #3 pins structurally, confirmed here observably.
  Scenario: the verdict depends only on nodeId, runtimes and skills — not host, os, aofVersion or publishedAt
    Given two node descriptors sharing nodeId "runner-1", runtimes ["codex"] and skills [] but differing on host, os, aofVersion and publishedAt
    When each is asked about target { kind: "capability", value: "codex" }
    Then both results are true (the non-capability descriptor fields never sway the verdict)
