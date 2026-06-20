@cli @planning @bug @finding-F1
Feature: aof planning init registers the marketplace over HTTPS, not SSH
  In order for `aof planning init` to install the bought planner for users who authenticate to GitHub
  over HTTPS (the common case — no SSH keys configured)
  the emitted `<runtime> plugin marketplace add` command must use an HTTPS git URL with the sha pinned
  as a `#<sha>` ref — never the bare `owner/repo` shorthand, which Claude resolves to an SSH clone
  (`git@github.com:`) that fails with `Permission denied (publickey)`.

  # Found at aof:verify (milestone 02, @uat prerequisite — VERIFICATION.md Finding F1). The live
  # `aof planning init --runtime claude` failed all 4 steps: `claude plugin marketplace add
  # phuryn/pm-skills@<sha>` cloned via SSH and was denied (no GitHub SSH key on the machine); the
  # per-plugin installs then failed (marketplace absent). aof's honesty gate correctly wrote no
  # provenance. Root cause: the emitted source is the `owner/repo` shorthand, which Claude clones over
  # SSH. Fix: emit `https://github.com/phuryn/pm-skills.git#<sha>` (RESEARCH §4 — `#ref` pins a git URL;
  # aof already holds MARKETPLACE_HEAD_URL for the ls-remote path). This SUPERSEDES ADR-001's shorthand
  # invariant and the acd-planning-install-commands fitness function, which currently pin the SSH-able
  # shorthand — the architect revises both as part of the fix.

  @executable
  Scenario: the marketplace-add command uses an HTTPS git URL pinned by sha
    When the claude install plan is built for the recommended plugin set with a resolved sha
    Then the marketplace-add command's source is an "https://" git URL for phuryn/pm-skills
    And the resolved sha is pinned on that URL as a "#<sha>" ref
    And the command does not pass the bare "phuryn/pm-skills@<sha>" shorthand that clones over SSH

  @executable
  Scenario: the per-plugin install still targets the marketplace by its manifest name
    When the claude install plan is built for the recommended plugin set with a resolved sha
    Then each plugin-install command still uses "<plugin>@pm-skills" (the manifest name, unchanged)

  @manual
  Scenario: a live marketplace add over HTTPS succeeds without a GitHub SSH key
    Given a machine with no configured GitHub SSH key
    When "aof planning init --runtime claude" registers the marketplace
    Then the marketplace clones over HTTPS and registers successfully (no "Permission denied (publickey)")
    And the recommended plugins install and a provenance manifest is written at ".aof/aof.planning.lock.json"
