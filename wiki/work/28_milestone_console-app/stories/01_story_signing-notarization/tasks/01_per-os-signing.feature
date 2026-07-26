@cli @adapter @distribution
Feature: Each artifact is signed/notarized on its own OS so the OS trusts the downloaded binary
  In order that a binary an outsider downloads is trusted by the OS it lands on (not blocked by SmartScreen/Gatekeeper — and arm64 macOS refuses to run unsigned code at all)
  each matrix leg signs its artifact per OS — Windows Authenticode (OV/EV cert on HSM/cloud), macOS codesign+hardened-runtime→notarytool→stapler, Linux a GPG-signed SHA256SUMS,
  so that KR4's "a single SIGNED command → a working node on all three OSes" holds, and the installer (Story 02) verifies a genuinely trusted artifact.

  # ARCHITECTURE ADR-005: signing is a CI-pipeline concern (scripts + the matrix), NOT runtime code — no
  # src/ change. Windows: signtool/AzureSignTool with an OV/EV cert on HSM/cloud (CA/B June-2023 rule —
  # no file .pfx), /fd SHA256 /tr <rfc3161> /td SHA256. macOS: codesign --options runtime --timestamp →
  # notarytool submit --wait → stapler staple, with the LOAD-BEARING ordering that postject injection
  # runs BEFORE codesign (injection breaks a signature). Linux: a GPG detached signature over SHA256SUMS.
  # Secrets are CI-held.
  #
  # Verification is tagged PER-SCENARIO (the work-stream validator requires exactly ONE verification tag per
  # scenario, so this mixed-lane feature carries none at the feature level). The AGENT-runnable half — the
  # signature is PRESENT and valid (codesign --verify --deep --strict / signtool verify /pa / gpg --verify) —
  # is @manual; the OS-TRUST half (Gatekeeper/SmartScreen accepts a fresh download; arm64 macOS runs it / an
  # unsigned arm64 build does NOT) is the human @uat sign-off recorded at aof:verify. A build agent cannot
  # assert an OS-trust decision in CI; a human confirms it on a real download.
  #
  # DEVELOPER-SEAT (feasibility, RESEARCH §4): SmartScreen reputation accrues per-file-hash over time for
  # BOTH OV and EV (EV instant-trust removed 2024) — first releases WILL warn; that is documented,
  # accepted friction, not a bug. macOS: signed-but-not-notarized is Gatekeeper-blocked when quarantined;
  # notarized-but-not-stapled fails offline — all three steps are mandatory. Flag if the signing secrets
  # (Win cloud creds / mac Developer ID + ASC key / Linux GPG key) are not yet provisioned.
  Background:
    Given the built per-OS artifacts from the matrix (00_ci-build-matrix)
    And the per-OS signing secrets provisioned in CI (HSM/cloud, Developer ID + ASC key, GPG key)

  # QA: retagged the SIGNATURE-PRESENT half @uat→@manual, split out from the original combined Windows
  # scenario, because ARCHITECTURE §verification-strategy + the story note put "the signature is present
  # and valid (signtool verify /pa)" in the AGENT-runnable @manual lane — a build agent CAN run
  # signtool verify on a signed .exe and read the timestamp; it is a deterministic tool assertion, not an
  # OS-trust judgment. One concern per scenario: this asserts the signature exists + is timestamped.
  @manual
  # Windows Authenticode — the signature is present, valid, and RFC-3161 timestamped (agent-runnable verify).
  Scenario: the Windows .exe carries a valid, timestamped Authenticode signature (signtool verify)
    When the Windows leg signs its .exe with signtool/AzureSignTool against the HSM/cloud OV/EV cert
    Then signtool verify /pa reports a valid signature
    And the signature is RFC-3161 timestamped (it survives cert expiry)

  # The OS-TRUST half stays @uat — no CI assert can prove SmartScreen's per-file-hash reputation decision;
  # a human downloads and runs it. R4: pin the unaffected side — a signed download is not HARD-blocked,
  # even though a first-release "unrecognized app" warning is expected (reputation build-up, not a bug).
  @uat
  Scenario: a downloaded Windows binary is not hard-blocked by SmartScreen (reputation build-up expected on first releases)
    Given a signed, timestamped Windows .exe downloaded from the release host
    When a human runs it on a clean Windows machine
    Then it is not hard-blocked (a first-release "unrecognized app" warning may appear — reputation accrues per file hash over time, not instant trust)

  # QA: split the macOS scenario. This @manual half asserts the AGENT-runnable signing chain — the
  # inject-before-codesign ordering (load-bearing, ADR-005) and that codesign --verify + the staple check
  # pass — all deterministic tool assertions a mac build agent runs. Retagged @uat→@manual for this half.
  @manual
  # macOS codesign → notarize → staple, in that order, after injection — the agent-runnable signing chain.
  Scenario: the macOS artifact is codesigned (hardened runtime), notarized, and stapled — inject ran before codesign
    Given the SEA blob was postject-injected BEFORE codesign (injection breaks an existing signature)
    When the macOS leg runs codesign --options runtime --timestamp, then notarytool submit --wait, then stapler staple
    Then codesign --verify --deep --strict passes
    And the notarization ticket is stapled to the artifact (verifiable offline)

  # The macOS OS-TRUST half stays @uat: Gatekeeper's decision on a quarantined download, and the negative
  # (an UNSIGNED arm64 build refuses to run — arm64 mandatory-signing) are human judgments on a real Mac.
  # R4: pin BOTH sides — the notarized+stapled copy opens; the unsigned arm64 copy does NOT run.
  @uat
  Scenario: a quarantined macOS download opens (notarized+stapled) while an unsigned arm64 build refuses to run
    Given a notarized, stapled macOS artifact and, separately, an UNSIGNED arm64 build
    When a human opens a freshly-downloaded (quarantined) copy of each on a Mac
    Then the notarized, stapled copy opens without a Gatekeeper block
    And the unsigned arm64 build is confirmed to NOT run (arm64 macOS mandatory-signing — the negative a human verifies)

  # QA: retagged the Linux signing scenario @uat→@manual, because a GPG round-trip over SHA256SUMS is
  # fully agent-runnable with a test key (ARCHITECTURE puts the "GPG SHA256SUMS round-trip verify" in the
  # @manual lane; there is NO OS-trust judgment for Linux — Linux has no OS code-signing standard, so the
  # whole assertion is a deterministic gpg/sha256sum check, not a human sign-off). One concern: the
  # detached signature verifies and the sums match.
  @manual
  # Linux GPG-signed SHA256SUMS (no OS code-signing standard) — a fully agent-runnable round-trip.
  Scenario: the Linux artifacts are covered by a GPG-signed SHA256SUMS (no OS code-signing standard)
    When the Linux leg emits SHA256SUMS over its artifacts and a GPG detached signature SHA256SUMS.asc
    Then gpg --verify SHA256SUMS.asc SHA256SUMS passes against the published public key
    And sha256sum -c SHA256SUMS matches every Linux artifact
    And editing a byte of SHA256SUMS after signing makes gpg --verify fail (tamper is detected)
