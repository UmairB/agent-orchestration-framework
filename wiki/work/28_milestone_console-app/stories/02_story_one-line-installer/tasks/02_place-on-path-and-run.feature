@cli @adapter @distribution @uat
Feature: One verified line places a working aof (binary + sidecar) per-user on PATH — node mode and relay mode both run
  In order that "install anywhere, one tool" is literally true — a single signed command yields a working aof with no Node and no sudo
  the installer places the verified binary and its co-located node-pty sidecar under $HOME/.aof/bin, adds it to PATH, and a fresh shell runs aof --version AND aof mesh relay,
  so that KR4 holds end-to-end on the operator's real OS, and the README one-liner is all a new user needs.

  # ARCHITECTURE ADR-006/ADR-002: per-user install to $HOME/.aof/bin (no sudo — avoids Windows admin +
  # macOS system-dir friction, RESEARCH §5); the binary and its node-pty sidecar are co-located so the
  # createRequire(process.execPath) load (ADR-002) finds the sidecar beside the binary. The README carries
  # the one-liner. This story is FILE-DISJOINT GREENFIELD.
  #
  # @uat: the end-to-end one-liner (curl -fsSL …/install.sh | sh ; irm …/install.ps1 | iex) runs on the
  # operator's real OS against the real signed release — a human confirms a working aof, on each OS. This
  # is KR4's headline ("a single signed command → a working node on all three OSes") — intrinsically a
  # cross-OS human sign-off, recorded at aof:verify, not a CI assert.
  #
  # DEVELOPER-SEAT (feasibility): the PATH step differs per shell (POSIX profile vs PowerShell $PROFILE /
  # setx) — deno defers PATH to a shell-setup hint; confirm whether we edit the profile or print the
  # export line. Flag the Windows PATH-persistence approach (setx vs profile) as the one real portability
  # wrinkle.
  Background:
    Given the verified binary + its node-pty sidecar for the operator's OS/arch (01_verify-before-path passed)

  # The headline UAT: the one-liner produces a working aof in a fresh shell.
  Scenario: the one-liner installs a working aof that runs both modes in a fresh shell
    When the operator runs the one-liner for their OS (curl|sh or irm|iex)
    Then the verified binary and its sidecar are placed under $HOME/.aof/bin (no sudo)
    And a fresh shell finds aof on PATH
    And "aof --version" runs (node mode) and "aof mesh relay --json" responds (relay mode)

  # The sidecar travels with the binary so the PTY feature works post-install. R4: pin the unaffected
  # side — a missing sidecar would degrade only the terminal dock (ADR-002), never the install.
  Scenario: the node-pty sidecar is co-located with the binary so a real PTY session works after install
    Given the installed $HOME/.aof/bin holding the binary and its sidecar
    When the operator starts a terminal session through the installed aof
    Then node-pty loads from the co-located sidecar and the PTY runs
    And had the sidecar been absent, only the terminal dock would degrade (an error frame), not the install

  # QA: added the RE-INSTALL / UPGRADE idempotence case — a real user re-runs the one-liner to upgrade;
  # it must replace the binary + sidecar in place and NOT duplicate the PATH entry or leave a stale
  # sidecar. R4: pin the unaffected side — re-running does not corrupt an existing working install.
  # Stays @uat: re-running the real one-liner against the real release on a real shell is a human check.
  Scenario: re-running the one-liner upgrades in place without duplicating PATH or leaving a stale sidecar
    Given aof is already installed under $HOME/.aof/bin from a prior run
    When the operator re-runs the one-liner
    Then the binary and its sidecar are replaced in place
    And PATH is not duplicated (no second $HOME/.aof/bin entry accrues)
    And no stale prior-version sidecar remains beside the new binary

  # QA: added the PATH-PERSISTENCE boundary the developer-seat flag raises — after install, a NEW shell
  # (not the install shell) must find aof, which is the real test of whether the profile/PATH edit
  # persisted (POSIX profile vs PowerShell $PROFILE/setx). This is the portability wrinkle made observable.
  # Stays @uat: only a genuinely fresh login shell on the real OS proves persistence.
  # QA FEASIBILITY FLAG (developer-amigo): on Windows, does the installer use setx (persistent user PATH)
  # or a $PROFILE edit — and does a brand-new terminal (not just a re-sourced one) then find aof? Flag
  # which mechanism, so the @uat check targets the right "fresh shell" (new login vs re-sourced profile).
  Scenario: a brand-new login shell finds aof on PATH after install (the PATH edit persisted)
    Given aof was installed by the one-liner in a prior shell session
    When the operator opens a brand-new login shell (not the install shell, not a re-sourced one)
    Then aof is found on PATH without any manual export
    And "aof --version" runs in that fresh shell

  # KR4 cross-OS: the same one-liner works on all three OSes (the milestone's outsider-verifiable bar).
  Scenario: a single signed command produces a working node on all three OSes (KR4)
    When the operator runs the one-liner on Windows, on macOS, and on Linux
    Then each produces a working aof with no Node.js or toolchain prerequisite
    And the same binary runs in relay mode on each
