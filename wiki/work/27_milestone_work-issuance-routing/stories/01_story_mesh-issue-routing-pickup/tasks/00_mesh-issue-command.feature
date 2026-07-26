@cli @work @distribution @executable
Feature: aof mesh issue <ref> [--to <node|cap>] writes ONE own-partition directive, resolves the ref EXACTLY, disambiguates --to against the synced roster, and pushes one default-root sync
  In order to enqueue/target work into the fleet from any node so an eligible peer picks it up (KR3) without hand-shuffling a file
  aof mesh issue resolves its ref EXACTLY (a typo issues nothing — write-isolation), assembles the frozen six-key directive under THIS node's issuer partition, DATA-DRIVEN disambiguates a single --to token against the synced roster (a known node id ⇒ a node target, any other token ⇒ a capability target, absent ⇒ any), writes it own-path via mesh-issuance, and pushes one default-[meshDir] sync so peers pull it within one interval,
  so that a member on any node issues into its OWN partition (never a contested path), a mistyped ref never writes a wrong directive, and a failed push degrades to the git cadence with the directive already durable locally — never a lost directive.

  # ARCHITECTURE ADR-002 (the mesh:issue command) + ADR-001 (the per-issuer directive) +
  # ADR-003 (the target union) + ADR-005 (the default-root propagation):
  #   1. resolve input.ref with resolveItemExact — NO slug fallback; a miss ⇒ ref-not-found,
  #      NO directive written (08/ADR-003 write-isolation, the run-start precedent);
  #   2. parse --to into the target union DATA-DRIVEN against the roster (readNodeRecords):
  #      matches a synced node id ⇒ { kind:"node", nodeId }; any other token ⇒
  #      { kind:"capability", value }; absent ⇒ { kind:"any" } — ONE flag, the PRD's
  #      [--to <node|cap>], the matcher stays a typed union (ADR-003);
  #   3. assemble the frozen six-key record (issuer = config.mesh.nodeId, state:"issued")
  #      and write it own-path via issueDirective (atomic writeText at
  #      issuanceDirectivePath(ws, ownNodeId, ref) — the command ORCHESTRATES, the seam WRITES);
  #   4. syncMesh(ws) once (default [meshDir] roots — the directive is under .mesh/, no runs
  #      pathspec) so it reaches the remote within the call. A push failure is HONEST (a coded
  #      envelope) but the directive is already durable locally (degrades to the git cadence).
  #   v1 does NOT push over the relay (no third relay kind) — a directive has no race to win.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #1 (acd-issuance-write-scope): every directive write joins issuanceDirectivePath/
  #    meshDir via writeText, references ZERO record-doc filename, is own-issuer-partitioned, and
  #    withdrawal is a STATE write never a delete — SOURCE assertions over mesh-issuance.mjs, NOT
  #    scenarios here.
  #  - fitness #6 (acd-mesh-command-cli-bijection, re-armed): mesh:issue is a registered mesh:*
  #    command with a cli adapter + a `subcommand === "issue"` branch in meshCommand — a
  #    registry-DERIVED gate, NOT a scenario here.
  #  - THIS feature asserts the OBSERVABLE command outcomes: which target kind is written for a
  #    given --to, that a typo'd ref writes nothing, that the record lands under this node's
  #    partition, that --json emits it, that the sync ran, and that a push failure surfaces coded
  #    while the directive stays durable.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the command rows stay @executable ONLY if
  #  (a) mesh:issue takes an INJECTED sync closure the way the m26 claim path takes runSync — so
  #      the push-success and push-failure rows are reachable with NO real remote round-trip
  #      needed for the coded-error assertion (the run-start injected-sync idiom); if the command
  #      can only build the production syncMesh from config, the push-failure row needs a bare
  #      remote whose push is made to fail (a harness lever) — keep it @executable either way;
  #  (b) --to disambiguation reads the roster off DISK node records (readNodeRecords over the
  #      synced tree) so a "known node id" vs "unknown token" fixture is just two planted
  #      descriptor files — a data fixture, no live fleet;
  #  (c) the directive stamp (issuedAt) accepts a FIXED INJECTED instant (the mesh:heartbeat /
  #      mesh:status input.now precedent) so the written record is byte-deterministic for the
  #      --json / on-disk assertions.
  # RAISED — do NOT silently retag to @manual; the command surface (resolve → disambiguate →
  # write → sync) must stay unit-testable over local fixtures. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): all three sub-flags CONFIRMED — @executable stands unchanged.
  #  (a) INJECTED SYNC CLOSURE — YES, the exact run-start idiom. `commands/run-start.mjs:209`
  #      already does `const runSync = () => syncMesh(ws, { roots: [...] });` and threads it into
  #      `acquireLease({ runSync, ... })` (src/mesh-lease.mjs:297) — the SAME shape composes here:
  #      `mesh-issue.mjs`'s `run` builds `const runSync = () => syncMesh(ws);` (default roots — no
  #      `runsPathspec`, ADR-002.4) and calls it directly (no lease/arbitration loop needed — a
  #      directive push is a single fire-and-observe, not a raced acquire). The test double is a
  #      plain closure the harness swaps in (`test/mesh-lease-claim-arbitration.test.mjs:166`'s
  #      `scriptedSync(steps)` pattern) returning `{ committed, pushed, pulled, noop }` (success) or
  #      `{ synced:false, reason:"push-failed", ... }` (failure) — `src/mesh-sync.mjs`'s real
  #      envelope shapes (`mesh-sync.mjs:220`/`241`). No real remote round-trip is needed for either
  #      push-outcome row. `ctx.syncRunner` (or an equivalent test-only ctx key, mirroring
  #      `ctx.relayClient` at `run-start.mjs:210`) is the injection point; production defaults to
  #      `() => syncMesh(ws)` when absent.
  #  (b) DATA-DRIVEN --to OFF DISK — YES. `readNodeRecords(workspace)` (`src/mesh-store.mjs:132`)
  #      is a pure directory walk over `.mesh/nodes/*.json`, already proven fixture-drivable (every
  #      `mesh:status`/`mesh:identity` test plants node records directly, e.g.
  #      `test/mesh-identity-cli-face.test.mjs`). The "synced roster holds a node whose id is
  #      build-server" background row is exactly one planted `.mesh/nodes/build-server.json` file —
  #      no live fleet, no sync call needed to exercise disambiguation.
  #  (c) FIXED INJECTED issuedAt — YES, the `mesh:heartbeat`/`mesh:status` `input.now` precedent
  #      (`src/commands/mesh-identity.mjs:172-177`, `188`: `typeof input?.now === "string" ...`).
  #      `mesh:issue`'s input schema gains the identical optional `now` (ISO-8601 UTC-Z, a white-box
  #      test input per 22/R2 — never a CLI flag), threaded into `assembleDirective`'s `issuedAt`.
  #      Byte-deterministic --json/on-disk assertions follow directly.
  # Composition confirmed against ADR-002.2: `mesh-issue.mjs` calls `resolveItemExact` (never
  # `resolveItem` — `src/commands/resolve.mjs:24-28`, the `run-start.mjs:91-92` write-isolation
  # precedent) BEFORE any directive write, so a ref-not-found miss leaves the issuance tree
  # byte-unchanged (no directive assembled, no `issueDirective` call reached).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh is configured with a stable config.mesh.nodeId "node-a" for this node
    And a shared bare git remote this workspace syncs its .mesh/ records to
    And a synced roster holding peer descriptors I write directly
    And the issue path takes an injected sync closure whose outcome I control
    And a ready task item "27/00" this node can issue

  # NO --to ⇒ AN "ANY" DIRECTIVE (ADR-003.1): an untargeted issue writes a { kind:"any" }
  # directive under this node's issuer partition, fleet-wide claimable. The --json face emits the
  # directive record so a caller can read back exactly what was written.
  Scenario: aof mesh issue with no --to writes an any-targeted directive under this node's partition and --json emits it
    When I invoke mesh:issue for "27/00" with no --to
    Then a directive is written at the issuance path for issuer "node-a" and item "27/00"
    And the directive's target is { kind:"any" }
    And the directive carries issuer "node-a", itemRef "27/00", and state "issued"
    And the --json result is the directive record itself

  # --to DISAMBIGUATION IS DATA-DRIVEN (ADR-002.3 / ADR-003): ONE --to token, resolved against
  # the synced roster. A token that IS a known node id ⇒ a node target; any other token ⇒ a
  # capability target. The node-vs-capability decision is made ONCE, at issue time (it needs the
  # roster), and frozen into target.kind — the matcher (story 02 routing) never re-disambiguates.
  Scenario Outline: --to disambiguates node vs capability against the synced roster and freezes the target kind
    Given the synced roster holds a node whose id is "build-server"
    When I invoke mesh:issue for "27/00" with --to "<to>"
    Then the written directive's target is <target>

    Examples:
      | to           | target                                       |
      | build-server | { kind:"node", nodeId:"build-server" }       |
      | codex        | { kind:"capability", value:"codex" }         |
      | claude       | { kind:"capability", value:"claude" }        |
      | typescript   | { kind:"capability", value:"typescript" }    |

  # WRITE-ISOLATION (ADR-002.2; 08/ADR-003, the run-start precedent): the ref resolves EXACTLY —
  # NO slug fallback. A typo'd / partial / nonexistent ref returns ref-not-found and writes
  # NOTHING (the issuance tree is byte-unchanged) — a mistake never issues the wrong item.
  Scenario Outline: a ref that does not resolve exactly is ref-not-found and writes no directive
    Given the issuance tree's current on-disk state is recorded
    When I invoke mesh:issue for "<ref>"
    Then the command fails with code "ref-not-found"
    And NO directive was written (the issuance tree is byte-unchanged)

    Examples:
      | ref        |
      | 27/0       |
      | 99/00      |
      | issuance   |
      | 27/00-typo |

  # THE PUSH IS ONE DEFAULT-ROOT SYNC (ADR-002.4 / ADR-005.1): after the durable write the
  # command runs syncMesh(ws) ONCE (default [meshDir] roots — the directive is under .mesh/, no
  # runs pathspec) so the directive reaches the remote within the call, ready for a peer's pull
  # (the ≤2-sync-interval KR3 budget). No relay push (v1 — the directive has no race, ADR-002.4).
  Scenario: a successful issue commits and pushes the directive over one default-root sync
    When I invoke mesh:issue for "27/00" with no --to
    Then exactly one default-root mesh sync ran (roots = [meshDir], no runs pathspec)
    And the directive reached the shared remote
    And no relay push was attempted (a directive has no race to win in v1)

  # PUSH FAILS BUT THE DIRECTIVE IS DURABLE (ADR-002.4 / ADR-005.1): the write happens BEFORE
  # the sync, so a push failure surfaces an HONEST coded error while the directive is already
  # durable locally — it degrades to the git cadence (the next successful sync carries it),
  # never a lost directive. The push-for-liveness/poll-for-durability posture the whole mesh rides.
  Scenario: when the push fails the error is coded but the directive is already durable locally
    Given the injected sync closure fails its push
    When I invoke mesh:issue for "27/00" with no --to
    Then the directive is already durable at the local issuance path (state "issued")
    And the command surfaces a coded push-failure error (never a lost or half-written directive)
    And a later successful sync carries the durable directive to the remote (the git cadence)

  # OWN-PARTITION ONLY (ADR-001.1 / fitness #1's behavioural face): the command writes ONLY under
  # THIS node's issuer partition — the third path arg is this node's OWN config.mesh.nodeId, never
  # a foreign issuer. Two nodes issuing the SAME item write TWO files under two partitions (the
  # reader unions them, story 02) — never one contested path (the 26/ADR-003 wedge avoided).
  Scenario: the directive is written under THIS node's issuer partition, never a foreign one
    Given a peer "build-server" already issued "27/00" (its own directive sits under its own partition)
    When I invoke mesh:issue for "27/00" with no --to
    Then this node's directive is written under the "node-a" issuer partition
    And the peer's directive under the "build-server" partition is left byte-unchanged (never a foreign write)
    And the two directives coexist add-only (no contested path — two files, two partitions)
