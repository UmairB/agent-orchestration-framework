@cli @adapter @distribution @executable
Feature: The installer verifies the download's checksum (and GPG signature on Linux) BEFORE placing anything on PATH — and refuses on a mismatch
  In order that a SIGNED-binary milestone actually USES the signature (an installer that skips verification throws the signature's value away)
  the installer fetches SHA256SUMS (+ SHA256SUMS.asc on Linux), verifies the downloaded asset against it, and installs only on a match — aborting on any mismatch,
  so that trust is checked at install time, and the verify+refuse logic is proven against a fixture manifest (the soft contract from Story 01) before real artifacts exist.

  # ARCHITECTURE ADR-006: verify-BEFORE-PATH is the point of this milestone (deno's installer notably
  # skips it — RESEARCH §5). Fetch SHA256SUMS; `sha256sum -c` (POSIX) / Get-FileHash compare (PowerShell);
  # on Linux additionally `gpg --verify SHA256SUMS.asc`; macOS/Windows additionally lean on
  # Gatekeeper-staple / Authenticode at run time. A mismatch ABORTS — nothing is placed on PATH.
  #
  # @executable: the verify + refuse-on-mismatch logic is a pure decision over a FIXTURE SHA256SUMS + a
  # fixture asset — asserted with no network and no real keys (the soft-contract format from Story 01's
  # 02_checksum-manifest). The real end-to-end verify rides the @uat 02_place-on-path-and-run.
  #
  # DEVELOPER-SEAT (feasibility): the fixture manifest MUST be byte-identical in shape to Story 01's real
  # SHA256SUMS (two-space `<sha256>  <filename>`), or the parser passes fixtures and fails production.
  # Confirm the GPG step is Linux-only (mac/win lean on OS trust) so a missing gpg on mac/win is not a
  # false failure. Flag if `sha256sum`/`gpg` availability must be probed (some minimal images lack them).
  Background:
    Given a downloaded asset and a fixture SHA256SUMS (+ SHA256SUMS.asc) in Story 01's format

  # The verify+install / refuse decision matrix. R4: pin BOTH sides — a match installs, EVERY mismatch
  # class refuses and places nothing on PATH.
  #
  # QA: extended the verify matrix with the full failure surface the task calls for, each a distinct real
  # corruption/attack the verify step must catch:
  #  - the SIDECAR checksum mismatches (binary OK, sidecar tampered — a partial-tamper the binary-only
  #    check would miss; ADR-006 co-downloads BOTH so BOTH must verify);
  #  - the downloaded asset is NOT LISTED in the manifest at all (a right-format manifest that simply omits
  #    this file — sha256sum -c passes vacuously if the file is not checked, so "not listed" must refuse);
  #  - (Linux) SHA256SUMS.asc is MISSING (present-and-invalid is covered; absent is a distinct class);
  #  - (Linux) the GPG key is NOT TRUSTED / not in the keyring (the .asc is a valid signature but by an
  #    unknown key — the task's "GPG-key-not-trusted" case; must refuse, not accept an untrusted signer).
  # QA FEASIBILITY FLAG (developer-amigo): does the installer import/pin the expected GPG public key
  # (fingerprint) so "signed by SOME key" is not mistaken for "signed by OUR key"? A gpg --verify against
  # an untrusted-but-valid key can return success on the SIGNATURE while the SIGNER is wrong — confirm the
  # installer checks the key fingerprint, not just gpg's exit code.
  Scenario Outline: the installer installs only on a verified match and refuses on any mismatch
    Given the download and manifest are in state <state>
    When the installer verifies before placing on PATH
    Then it <outcome>
    And on refusal nothing is written to the install dir or PATH

    Examples: verify outcomes
      | state                                                      | outcome                                |
      | checksum matches (and Linux GPG verifies against the pinned key) | proceeds to install             |
      | the binary's checksum does not match its line              | refuses with a checksum error          |
      | the sidecar's checksum does not match its line             | refuses with a checksum error          |
      | the downloaded asset is not listed in SHA256SUMS at all     | refuses with a not-in-manifest error   |
      | SHA256SUMS is missing or unfetchable                        | refuses with a missing-manifest error  |
      | (Linux) SHA256SUMS.asc is missing                           | refuses with a missing-signature error |
      | (Linux) SHA256SUMS.asc fails gpg --verify                   | refuses with a signature error         |
      | (Linux) SHA256SUMS.asc is valid but signed by an untrusted / unpinned key | refuses with an untrusted-key error |

  # Verification precedes any PATH mutation — ordering is load-bearing (never place-then-verify).
  Scenario: verification happens before any file is placed on PATH (never place-then-check)
    Given a download whose checksum will not match
    When the installer runs
    Then it verifies first and aborts before creating $HOME/.aof/bin or touching PATH
    And no partial install remains

  # QA: added the BOTH-ARTIFACTS-VERIFIED-BEFORE-INSTALL ordering — since the binary and sidecar are a
  # co-download (ADR-006), the install must proceed only after BOTH verify; a binary that verifies must NOT
  # be placed while its sidecar is still unverified (or fails). R4: pin the unaffected side — a good binary
  # + a bad sidecar installs NEITHER.
  Scenario: a verified binary is not installed while its co-downloaded sidecar fails verification
    Given the binary's checksum matches but the sidecar's checksum does not
    When the installer verifies before placing on PATH
    Then it refuses the whole install (both artifacts must verify before either is placed)
    And neither the binary nor the sidecar is written to $HOME/.aof/bin
