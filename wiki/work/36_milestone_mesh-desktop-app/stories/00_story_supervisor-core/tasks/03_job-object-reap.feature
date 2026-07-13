@manual @ui @distribution @adapter
Feature: Each supervised child is Job-Object-contained so quitting or crashing the supervisor reaps the whole child tree with no orphans
  In order that no orphaned aof/Node process ever survives the supervisor, each spawned child is assigned to a
  Windows Job Object with kill-on-close, so on Quit the entire child tree (aof, its Node process, any
  grandchildren) is reaped — and even a supervisor crash/kill reaps the tree when the job handle drops — via
  the Windows-first hard-kill path, expecting no POSIX SIGTERM handshake.

  # ARCHITECTURE 36/ADR-002 d3 (Windows Job Object kill-on-close is the child-tree reaper, behind a neutral
  # containment seam). Each spawned child is assigned to a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  # (RESEARCH §2) so closing/dropping the job handle — on Quit OR on the supervisor's OWN crash/exit — kills every
  # process in the job transitively (aof, its Node process, grandchildren). A bare `child.kill()` signals only the
  # DIRECT child, orphaning the Node process's descendants; Windows has no SIGKILL-to-process-group, so the Job
  # Object is the correct documented primitive (RESEARCH §2, ADR-002 Alternatives). On Windows `Child::kill()` is
  # `TerminateProcess` (hard kill) — no true POSIX SIGTERM delivery, no Node SIGTERM handler runs — so the reap is
  # the realistic Windows-first shutdown path, exactly what kill-on-close implies (RESEARCH §2). The Job Object is
  # a Windows-only containment detail behind a platform-neutral "kill the supervised tree" seam so the portable
  # core (ADR-001) doesn't leak the Win32 primitive. This is OBSERVABLE supervisor behaviour — a `@manual`
  # scenario (spawn a tree, quit/kill the supervisor, assert no orphan), NOT an arch grep (ARCHITECTURE §Fitness
  # functions, "armed at build by story 00").
  #
  # RESOLVED (developer-amigo): `@manual` — proving no orphan survives requires spawning a real child tree, tearing
  # the supervisor down two ways (graceful Quit, and a hard supervisor kill), and enumerating surviving processes
  # afterward, which no source grep can assert. Proposed exercise: spawn a stub `aof`-shaped child that itself
  # spawns a grandchild (a Node process that spawns a sleeper), assign the child to a kill-on-close Job Object,
  # then (a) Quit the supervisor and (b) in a second run hard-kill the supervisor's process, each time enumerating
  # the descendant PIDs and asserting none remain. Confirm the process-enumeration harness on Windows next.

  Background:
    Given a supervisor that spawns a child which itself spawns a Node process and a grandchild
    And every spawned child is assigned to a Job Object with kill-on-close

  # KILL-ON-CLOSE CONTAINMENT (ADR-002 d3 / RESEARCH §2): the spawned child is assigned to a Job Object carrying
  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE — the containment primitive that makes tree-reaping automatic.
  Scenario: each spawned child is assigned to a kill-on-close Job Object
    Given a freshly spawned supervised child
    When the child's containment is inspected
    Then the child is assigned to a Job Object
    And that Job Object carries the JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE limit

  # QUIT REAPS THE WHOLE TREE (ADR-002 d3): on Quit the job handle drops and the ENTIRE child tree — aof, its Node
  # process, grandchildren — is reaped; no orphan survives.
  Scenario: Quit reaps the entire child tree with no orphan surviving
    Given a supervised child tree is running (aof, its Node process, a grandchild)
    When the operator selects Quit
    Then the supervisor drops the Job Object handle
    And the aof process is reaped
    And its Node process is reaped
    And the grandchild is reaped
    And no process from the child tree survives as an orphan

  # A SUPERVISOR CRASH STILL REAPS (ADR-002 d3 / RESEARCH §2): kill-on-close fires when the handle DROPS — so even
  # an ungraceful supervisor crash/kill (no clean Quit path) still reaps the tree.
  Scenario: a supervisor crash reaps the tree because kill-on-close fires when the handle drops
    Given a supervised child tree is running
    When the supervisor process is hard-killed without a graceful Quit
    Then the Job Object handle is dropped by the OS on supervisor exit
    And kill-on-close fires and reaps the entire child tree
    And no aof, Node, or grandchild process survives as an orphan

  # WINDOWS-FIRST HARD-KILL, NO SIGTERM HANDSHAKE (ADR-002 d3 / RESEARCH §2): the reap is a hard kill; the
  # supervisor expects no POSIX SIGTERM handshake — a bare direct-child kill would orphan the descendants.
  Scenario: the reap is the Windows hard-kill path and expects no POSIX SIGTERM handshake
    Given a supervised child tree is running
    When the supervised tree is torn down
    Then the teardown does not depend on a POSIX SIGTERM handshake to the children
    And a bare direct-child kill (no Job Object) would leave the Node process's descendants orphaned
    And only the Job Object kill-on-close reaps the descendants transitively
