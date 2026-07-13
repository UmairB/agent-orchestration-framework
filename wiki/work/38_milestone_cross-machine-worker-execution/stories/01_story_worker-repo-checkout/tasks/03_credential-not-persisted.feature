@executable @cli @work @distribution
Feature: The clone leaves no credential at rest — not in .git/config, not in logs, not in the agent child's env
  In order that a credential crossing the mesh to clone a private repo cannot be exfiltrated from a worker, the
  clone writes NO credential into the checkout's `.git/config`, echoes NO credential into any log or error, and
  scopes the credential env to ONLY the clone spawn so the later headless-agent child (which inherits ambient
  env) can never read it.

  # ARCHITECTURE 38/ADR-005 + SECURITY.md. RESEARCH.md §1 MEASURED the footguns this task forbids:
  #  (a) `git clone --config http.extraHeader=<cred>` PERSISTS the raw credential in plaintext to the checkout's
  #      .git/config — so the clone must use a per-invocation `-c` or GIT_ASKPASS, never `--config`.
  #  (b) Node execFile inherits the FULL parent env into the spawned child (mesh-worker-execution.mjs:163-184,
  #      the defaultSpawnRuntime that runs `claude -p` in the worktree) — so a credential placed in worker
  #      AMBIENT env would leak to the agent child. The clone's credential (the GIT_ASKPASS token, RESEARCH.md's
  #      recommended default) must be set on a per-invocation `env` for the CLONE spawn ONLY, never on
  #      process.env / the worker's ambient env.
  # STRUCTURAL: no credential written to .git/config (no `url.<x>@` rewrite, no durable `credential.helper
  # store`), no `--config http.extraHeader`, no credential on process/ambient env, no credential in a log line
  # → acd-worker-clone-no-credential-persisted (strengthened by SECURITY). The git spawn stays argv-form,
  # shell-less. NB: the exact credential MECHANISM is SECURITY-approved (GIT_ASKPASS + control-minted
  # short-lived token) — this task pins the NO-CREDENTIAL-AT-REST invariants that hold regardless of mechanism.
  #
  # @qa: complete the Examples — after a clone the checkout's .git/config contains no credential (no url.<x>@,
  # no credential.helper store pointing at a durable file); a failed clone's surfaced error/log redacts the
  # credential; the credential is not present on the worker's process env after the clone; the agent child
  # spawned into the worktree does not inherit the credential.

  Background:
    Given a worker cloning a private repo for workspace "ws-1" with a credential

  Scenario: the finished checkout carries no credential in .git/config
    When the clone completes
    Then the checkout's .git/config contains no credential value
    And no `url.<credential>@` rewrite and no durable `credential.helper store` was written

  Scenario: the credential never reaches the worker's ambient env or the spawned agent child
    Then the credential was set only on the clone spawn's per-invocation env
    And it is absent from the worker's process env after the clone
    And the headless-agent child spawned into the worktree does not inherit it

  Scenario: a clone failure surfaces a redacted error with no credential value
    Given the clone fails with an authenticated-URL error
    Then the surfaced error and any log line redact the credential

  # THE .git/config FOOTGUNS (RESEARCH.md §1 measured / acd-worker-clone-no-credential-persisted): after a
  # successful clone the checkout's `.git/config` is inspected for every shape that would persist a secret at
  # rest — NONE may be present. The literal credential value must appear NOWHERE in the config file.
  Scenario Outline: the finished checkout's .git/config persists no credential in any shape
    When the clone completes and the checkout's .git/config is read
    Then <configSurface> <expectation>

    Examples:
      | configSurface                                            | expectation                                                             |
      # The raw credential value must not appear verbatim anywhere in the file.
      | the literal credential value                             | appears nowhere in .git/config                                          |
      # No credential embedded in the remembered origin URL (RESEARCH.md §1.A2: git records remote URL by design).
      | a `[remote "origin"] url = ` with `x-access-token:<cred>@` | is absent (the origin URL carries no embedded credential)             |
      # No per-invocation header persisted (RESEARCH.md §1.A1: `--config http.extraHeader` writes it verbatim).
      | an `[http] extraheader = Authorization: ...` entry        | is absent (the clone used no `--config http.extraHeader`)              |
      # No `url.<x>.insteadOf` credential rewrite persisted.
      | a `[url "https://<cred>@..."] insteadOf = ` rewrite       | is absent                                                               |
      # No durable credential-store helper pointing at a plaintext file on disk.
      | a `credential.helper = store` (durable, file-backed)     | is absent (no durable credential helper was configured)               |

  # THE CLONE ARGV / MECHANISM DISCIPLINE (ADR-005): the clone is spawned argv-form (no shell), and it does NOT
  # reach for the persisting flag `--config http.extraHeader` — the credential rides an ephemeral per-invocation
  # path (GIT_ASKPASS token, the SECURITY-approved default) that leaves no on-disk trace.
  Scenario: the clone spawn uses no persisting credential flag
    When the worker spawns the clone
    Then the git clone argv contains no `--config http.extraHeader=` argument
    And the git clone argv embeds no `x-access-token:<cred>@` authenticated URL
    And the clone is spawned argv-form (execFile), never a shell string carrying the credential

  # ENV SCOPING (RESEARCH.md §1.5 measured — execFile inherits the FULL parent env): the credential is set on a
  # per-invocation `env` passed to the CLONE spawn's execFile ONLY, and is never merged into the worker's ambient
  # process.env — so it is absent from process.env after the clone AND absent from the agent child's inherited
  # env (the child that runs `claude -p` in the worktree, mesh-worker-execution.mjs:163-184).
  Scenario Outline: the credential env is scoped to the clone spawn and never leaks onward
    When the clone completes and control reaches <observationPoint>
    Then the credential value <presence>

    Examples:
      | observationPoint                                         | presence                                                       |
      # On the CLONE spawn's own per-invocation env — the ONE place it is allowed.
      | the clone spawn's per-invocation env                     | is present (the only sanctioned carrier)                       |
      # Never merged into the worker Node process's ambient env.
      | the worker's process.env after the clone                 | is absent                                                      |
      # Never inherited by the headless-agent child spawned into the worktree.
      | the agent child's inherited environment                  | is absent                                                      |
      # Never on the addWorktree/worktree git spawn's env either (that step needs no credential — RESEARCH.md §1.6).
      | the addWorktree git spawn's env                          | is absent (the worktree add is a local, credential-free step)  |

  # REDACTION ON FAILURE (ADR-005, the acd-global-node-descriptors-redact-secrets discipline): a clone failure
  # surfaced up the channel and written to any log redacts the credential — regardless of which surface the raw
  # secret would otherwise ride (an authenticated URL in a git error, a header echoed in stderr, the failed frame).
  Scenario Outline: a failed clone redacts the credential on every surfaced surface
    Given the clone fails with <failure>
    Then the surfaced error message contains no credential value
    And any log line written for the failure redacts the credential
    And the streamed "failed" frame carries no credential value

    Examples:
      | failure                                                  |
      | an authenticated-URL error echoing the remote URL        |
      | an auth-rejected (HTTP 401/403) error carrying a header   |
      | a git stderr line quoting the credential-bearing argv    |
