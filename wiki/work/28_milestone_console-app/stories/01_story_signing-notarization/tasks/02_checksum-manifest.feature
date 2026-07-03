@cli @assets @distribution @executable
Feature: The release emits a SHA256SUMS manifest covering every artifact — the format contract the installer verifies against
  In order that Story 02's installer can verify a download before placing it on PATH (and Linux packagers can verify without OS code-signing)
  the release generates a SHA256SUMS manifest with one line per per-OS/arch artifact and sidecar, plus a GPG detached SHA256SUMS.asc,
  so that the checksum/signature format is a pinned SOFT CONTRACT (filename + line shape + the .asc companion) the installer consumes against a fixture before the real artifacts exist.

  # ARCHITECTURE ADR-005/ADR-006: the manifest is the Node/HashiCorp shape — `<sha256>  <filename>` lines
  # (two spaces, sha256sum -c compatible) covering EVERY released artifact + sidecar, with SHA256SUMS.asc
  # a GPG detached signature. This is the format seam between Story 01 (emits) and Story 02 (verifies) —
  # pinned so the installer's verify logic is unit-tested against a FIXTURE manifest in parallel.
  #
  # @executable: manifest GENERATION + LINE FORMAT + COVERS-ALL-ARTIFACTS are computed properties over
  # fixture files — asserted with no signing keys. The GPG round-trip (one scenario) is @manual (it needs
  # a real key); tagged individually below.
  #
  # DEVELOPER-SEAT (feasibility): the covers-all set-equality mirrors Story 00's bundle-manifest-complete
  # unit (a diff both directions over the released file set). Confirm the line format is EXACTLY what the
  # installer's `sha256sum -c` / Get-FileHash path expects (two-space separator, relative filenames) so
  # the soft contract does not drift between the two stories.
  Background:
    Given a fixture set of released artifact files (per-OS/arch binaries + sidecars) on disk

  # Covers every artifact — set-equality both directions (no artifact unlisted, no phantom line).
  # QA: added the SIDECAR-specific coverage assertion — ADR-002/006 ship a node-pty sidecar per leg, and
  # the installer co-downloads + can verify it; a manifest that lists binaries but silently omits sidecars
  # would leave the sidecar unverifiable. Pins that BOTH artifact classes are covered.
  Scenario: SHA256SUMS lists every released artifact exactly once and nothing that was not released
    When the manifest generator runs over the released file set
    Then every released binary AND every released node-pty sidecar has exactly one SHA256SUMS line
    And no SHA256SUMS line names a file that was not released
    And each line's hash matches the file's actual sha256

  # The line format is the sha256sum -c / Get-FileHash-compatible shape the installer parses.
  # QA: added the LINE-ENDING pin (m01/R2 recall — content-addressed manifests must pin EOL or cross-OS
  # runners diverge). The manifest is emitted on win/mac/linux runners; if a Windows runner writes CRLF the
  # POSIX `sha256sum -c` parse and the hash-over-manifest for the .asc both shift. Pins LF line endings +
  # lowercase hex as part of the soft contract.
  Scenario: each manifest line is the `<sha256>  <filename>` shape the installer verifies against
    When I read a SHA256SUMS line
    Then it is a lowercase 64-hex sha256, two spaces, then the artifact's relative filename
    And the manifest uses LF line endings (not CRLF) so the format is identical across the win/mac/linux runners
    And the file parses cleanly under `sha256sum -c` (POSIX) and a Get-FileHash comparison (PowerShell)

  # QA: added a MALFORMED-MANIFEST rejection matrix — the generator (and, downstream, the installer's
  # parser) must reject manifests that are structurally wrong, rather than emit/accept a manifest that
  # verifies vacuously or against the wrong file. These are the failure CLASSES QA owns enumerating:
  # truncated (a line cut short), a duplicate line (same file twice — ambiguous), right-hash-wrong-file
  # (the hash of file A on file B's line — a swap that a naive parser accepts), an uppercase/short hash
  # (not the pinned lowercase-64-hex), and a blank/extra-whitespace line. Each is a distinct real corruption.
  # @executable: these are computed rejections over crafted fixture manifests — no keys, no network.
  # QA FEASIBILITY FLAG (developer-amigo): is the malformed-manifest rejection asserted on the GENERATOR's
  # output (it never EMITS these) or on a shared PARSER both the generator and the installer use? The
  # soft-contract only holds if the installer's parser rejects the same classes — flag whether one parser
  # is shared, or the two stories can drift on which malformations they tolerate.
  Scenario Outline: a structurally malformed manifest is rejected, not accepted vacuously
    Given a SHA256SUMS fixture that is <defect>
    When the manifest is validated against the released file set
    Then it is rejected with a <error> error
    And no file is treated as verified on the strength of a malformed line

    Examples: manifest corruption classes
      | defect                                                   | error                         |
      | truncated (a line cut off mid-hash)                      | malformed-hash                |
      | a duplicate line for the same filename                   | duplicate-entry               |
      | a line pairing file A's hash with file B's name          | checksum-mismatch (on B)      |
      | a hash that is uppercase or not exactly 64 hex chars     | malformed-hash                |
      | a blank line or a line with a single-space separator     | malformed-line                |
      | a line naming a released file that is missing from disk   | missing-file                 |

  # NOTE (PO): the GPG SIGNING + verify of this manifest (and tamper-detection) is Story 01's signing
  # concern — 01_per-os-signing.feature's Linux scenario asserts `gpg --verify SHA256SUMS.asc` + that a
  # post-sign byte edit fails verify. This feature covers only the manifest FORMAT/generation, so it stays
  # single-lane @executable (the validator requires exactly one verification tag per scenario).
