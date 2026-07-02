@cli @work @distribution @executable
Feature: aof mesh join <code> presents the code to the control node's endpoint, stores the issued credential in config.mesh.credential, and provisions git-remote via the shell-less git-argv idiom
  In order to let a fresh machine join with one 6-digit code and be fully set up — no manual credential copying
  the mesh:join command reads config.mesh.relay.url, POSTs the presented code to the device-flow endpoint, on a MATCH merge-writes the issued credential into config.mesh.credential (preserving the other mesh keys) and runs git remote add on the joining node's OWN clone via spawnSync("git", ["remote","add",name,url]) — the shell-less argv form, never a shell string,
  so that a matched code leaves the node holding its credential + a configured git-remote (other config.mesh.* keys intact), a rejected code stores nothing (config byte-unchanged), and the git spawn never word-splits a url on Windows.

  # ARCHITECTURE ADR-002 (move 3) + ADR-003 (move 3, git-remote provisioning): mesh:join reads
  # config.mesh.relay.url (the mesh-relay-client.mjs precedent), POSTs the code to task 01's endpoint,
  # and on a MATCH (a) merge-writes the issued credential into config.mesh.credential (the
  # resolveInstallSalt read-merge-write of the free-form mesh subtree — the OTHER config.mesh.* keys
  # survive), and (b) provisions git-remote access via spawnSync("git", ["remote","add",name,url]) —
  # the 13/ADR-002 shell-less argv idiom against the joining node's OWN clone. This feature asserts the
  # OBSERVABLE join behaviour: the credential is stored (the { relayAuth, nodeId, gitRemote } SHAPE,
  # crypto OPAQUE), the mesh subtree is MERGED not clobbered (R4), the git spawn is the argv form
  # (never a shell string / concatenated command), and a rejection stores nothing (config byte-
  # unchanged, R4). The shell-less-argv discipline is ALSO the STRUCTURAL acd-enroll-git-argv-no-shell
  # fitness (a source-grep) — here the OBSERVABLE is that the remote is configured on the joining
  # node's OWN repo via argv, and a url with a space is NOT word-split (the Windows hazard). The --json
  # bijection rides the EXISTING acd-mesh-command-cli-bijection gate — asserted below as the observable
  # "runs clean + parseable", not restated as a gate.
  #
  # QA FEASIBILITY FLAG (developer-amigo): drive join against the SAME in-process serveRelay endpoint
  # as task 01 (serveRelay on port 0, the story-00 registry seeded via writeRegistry) — no spawned
  # relay. The git-remote provision runs spawnSync("git", …) against a LOCAL fixture clone (a real git
  # repo the test controls); assert the remote is configured on the JOINING node's OWN repo, with a
  # url carrying a space to prove the argv form does NOT word-split it (the 13/ADR-002 Windows hazard —
  # a shell string would split "url with space" into two argv tokens). Whether a real PUSH against a
  # real remote actually works is the @manual half (task 03) — here assert only that `git remote add`
  # was invoked argv-form and the remote is listed in the fixture repo's config. Buildable @executable
  # for the argv + config-merge observables — do NOT retag to @manual.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And a control node's device-flow endpoint stood up in-process via serveRelay on an ephemeral port (port 0), the story-00 registry seeded
    And config.mesh.relay.url points at that in-process endpoint
    And the joining node's own clone is a local git fixture repo I control

  # The headline match: mesh:join reads config.mesh.relay.url, POSTs the code, and on a MATCH stores
  # the issued credential in config.mesh.credential. R4: pin the UNAFFECTED side — the merge PRESERVES
  # the other config.mesh.* keys (nodeId, relay.url), it does NOT clobber the mesh subtree
  # (read-merge-write, the resolveInstallSalt precedent).
  Scenario: mesh:join on a match stores the credential in config.mesh.credential and preserves the other mesh keys
    Given a live pending invite exists for a 6-digit code on the control node's endpoint
    And config.mesh already carries a nodeId and relay.url before the join
    When I invoke mesh:join with that code
    Then config.mesh.credential is stored carrying { relayAuth, nodeId, gitRemote }
    And config.mesh.nodeId and config.mesh.relay.url are byte-unchanged (the merge preserved them, not a clobber)
    And no other config.mesh.* key was dropped by the write (read-merge-write, not overwrite)

  # git-remote provisioning via the shell-less argv idiom (13/ADR-002; acd-enroll-git-argv-no-shell).
  # On a match, `git remote add <name> <url>` is invoked against the JOINING node's OWN clone via
  # spawnSync("git", ["remote","add",name,url]) — the argv form, NEVER a shell string. The load-
  # bearing observable: a url carrying a SPACE is NOT word-split (a shell string would split it into
  # two tokens — the Windows hazard the idiom guards). R4: pin the UNAFFECTED side — the provisioning
  # writes only the joining node's OWN repo config, never a write verb against a foreign source tree.
  Scenario: on a match git-remote access is provisioned via the shell-less git-argv form on the joining node's own clone
    Given a live pending invite whose issued gitRemote grant carries a url that contains a space
    When I invoke mesh:join with that code
    Then git remote add was invoked as spawnSync("git", ["remote","add",name,url]) — the argv form, not a shell string
    And the named remote is configured in the joining node's OWN clone with the exact granted url (the space was NOT word-split)
    And no git WRITE verb was run against any foreign source tree (only the joining node's own clone was configured)

  # A rejection (bad / expired / consumed code) surfaces a clean face-level error and stores NOTHING.
  # R4: pin the UNAFFECTED side HARD — config is BYTE-UNCHANGED (no config.mesh.credential written),
  # and NO git remote is added on a rejection.
  Scenario: mesh:join on a rejection surfaces a clean error and stores nothing
    Given the presented code is rejected by the endpoint (bad / expired / already-consumed)
    And I record config's on-disk state and the joining node's git remotes
    When I invoke mesh:join with that code
    Then the result is a clean face-level error (a rejected code did not admit)
    And config is byte-unchanged (no config.mesh.credential was written)
    And no git remote was added to the joining node's clone

  # The bijection observable (22/R1): mesh:join <code> --json runs clean + parseable — the cli adapter
  # + the argsFor case land in the SAME change (the acd-mesh-command-cli-bijection gate throws on an
  # unmapped sub). This asserts the OBSERVABLE, not the gate (the gate is an arch-test).
  Scenario: mesh:join <code> --json runs clean and parseable (rides the existing bijection gate)
    Given a live pending invite exists for a 6-digit code on the control node's endpoint
    When I run aof mesh join <code> --json
    Then the command exits cleanly
    And the emitted JSON parses to the join result shape (reporting the admission + the stored credential)
