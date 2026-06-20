@cli @planning @bug @finding-F2
Feature: aof planning init pins the marketplace by a CLONABLE ref, not a bare commit sha
  In order for `aof planning init` to actually register the bought planner (the milestone's headline)
  the emitted `<runtime> plugin marketplace add <url>#<ref>` command must pin the marketplace with a ref
  the runtime can clone — a branch or a TAG name — never a bare 40-hex commit sha, which
  `claude plugin marketplace add` (a `git clone --branch <ref>`) cannot resolve.

  # Found at aof:verify (milestone 02, @uat prerequisite — VERIFICATION.md Finding F2). F1's HTTPS fix
  # (ADR-007) IS confirmed working: the live `aof planning init --runtime claude` now clones over HTTPS
  # with no `Permission denied (publickey)`. But the add STILL fails for everyone:
  #   claude plugin marketplace add https://github.com/phuryn/pm-skills.git#d384f0c9…edb
  #   → warning: Could not find remote branch d384f0c9…edb to clone.
  #   → fatal: Remote branch d384f0c9…edb not found in upstream origin
  # Root cause: `claude plugin marketplace add <url>#<ref>` runs `git clone --branch <ref>`, which only
  # accepts a branch or tag NAME — a bare commit sha is not a branch, so the clone aborts. Verified
  # directly: `git clone --branch <sha>` fails identically; `git clone --branch v2.0.0` and
  # `--branch main` both succeed. ADR-007's premise ("a full 40-hex sha is a valid `#ref`") is false for
  # this CLI. This is the SAME blind-spot class as F1, one layer in: the acd-planning-install-commands
  # fitness function asserts the command STRING shape (HTTPS `#<sha>`), which proves the string, not that
  # the clone resolves. Fix direction (architect's call — supersede ADR-007 + correct RESEARCH §4):
  # pin the command by the immutable TAG (`#v2.0.0`) — clonable AND fixed — while still resolving that
  # tag to its 40-hex commit sha for the provenance manifest (preserving ADR-002/ADR-003 unchanged). A
  # floating branch (`#main`) clones but is not an integrity anchor (ADR-002), so it is not the pin.

  @executable
  Scenario: the marketplace-add command pins a clonable ref, never a bare commit sha
    When the claude install plan is built for the recommended plugin set with a resolved marketplace ref
    Then the marketplace-add command's source is an "https://" git URL for phuryn/pm-skills
    And the ref pinned on that URL as a "#<ref>" is a branch or tag name a clone can resolve
    And the command does not pin a bare 40-hex commit sha as the "#<ref>" (a clone-by-branch cannot resolve it)

  @executable
  Scenario: provenance still records the exact 40-hex commit the clonable ref resolves to
    When the planning provenance manifest is produced from a clonable tag ref
    Then the manifest "sha" is the 40-char lowercase-hex commit the tag points at (ADR-002 unchanged)
    And the manifest path/shape is unchanged at ".aof/aof.planning.lock.json" (ADR-003 unchanged)

  @manual
  Scenario: a live marketplace add registers the marketplace and installs the plugins
    Given a machine that authenticates to GitHub over HTTPS (no SSH key) and has the claude CLI
    When "aof planning init --runtime claude" registers the marketplace
    Then the marketplace clones and registers successfully (no "not found in upstream origin")
    And the recommended plugins install and a provenance manifest is written at ".aof/aof.planning.lock.json"
