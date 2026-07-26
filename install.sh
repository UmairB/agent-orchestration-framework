#!/bin/sh
# aof — the one-line POSIX installer.
#
#   curl -fsSL https://<host>/install.sh | sh
#
# ARCHITECTURE ADR-006 (milestone 28, story 02): detect OS/arch (`uname -sm`,
# the deno_install shape) -> resolve the matching signed release asset PLUS its
# node-pty sidecar (ADR-002 — a co-download, not a second product) -> fetch
# SHA256SUMS (+ SHA256SUMS.asc on Linux) -> verify BEFORE placing anything on
# PATH (refuse on ANY mismatch; on Linux additionally `gpg --verify` against a
# PINNED release-key fingerprint — an otherwise-valid signature by an unpinned
# key is refused, story Build note F2) -> place the verified binary + its
# co-located sidecar under $HOME/.aof/bin (no sudo) -> PATH guidance.
#
# Greenfield, file-disjoint from src/ (ARCHITECTURE §Story break-down
# rationale, point 3). Never touches src/frameworks.mjs's npx installer.
#
# TESTABILITY: this script is safe to `source`/`.` for unit testing. When
# AOF_INSTALL_TEST is set to a non-empty value, sourcing the script defines
# every function below but does NOT run main / touch the network / write
# files — the test then calls the functions directly with a stubbed
# `aof_download`/`aof_run_gpg`/etc. See test/installer-detect.test.mjs and
# test/installer-verify.test.mjs.
#
# TEST-ONLY KEY OVERRIDE (craft-review F1): production imports the EMBEDDED
# release public key below into the fresh per-run keyring before verifying
# (a fresh --homedir starts with NO keys, so verifying against it without an
# import always fails with "No public key" — the exact production-breaking
# bug this override exists to let a test exercise honestly). A test that
# wants to prove the real "empty homedir -> import -> verify" path against a
# THROWAWAY test keypair (never the real release key) sets
# AOF_RELEASE_GPG_PUBKEY_FILE to a path holding an ASCII-armored test public
# key, and AOF_RELEASE_GPG_FINGERPRINT to that key's fingerprint. Production
# never sets either — it always uses the embedded block + the pinned
# fingerprint below.

set -eu

# ---------------------------------------------------------------------------
# Configuration (overridable via env for testing / mirrors)
# ---------------------------------------------------------------------------

AOF_INSTALL_HOST="${AOF_INSTALL_HOST:-https://get.aof.dev}"
AOF_INSTALL_VERSION="${AOF_INSTALL_VERSION:-latest}"
AOF_INSTALL_DIR="${AOF_INSTALL_DIR:-$HOME/.aof/bin}"

# The release key fingerprint the installer trusts for the Linux GPG signature
# (ADR-006 / Build note F2 — HARD REQUIREMENT). A valid signature by any OTHER
# key is refused, never silently accepted. This MUST match the embedded public
# key block below (aof_release_gpg_pubkey) — Story 01's signing pipeline signs
# with the key this fingerprint names.
#
# PLACEHOLDER (craft-review F1): this repo does not yet hold Story 01's real
# release keypair/fingerprint — both this value and the embedded block below
# are a clearly-marked PLACEHOLDER pair, generated together so the import ->
# verify -> fingerprint-pin chain is provably correct end-to-end today. Swap
# BOTH in lockstep the moment Story 01 provisions the real signing key; a
# mismatched pair would make every production install refuse (the exact class
# of bug F1 caught) or, worse, pin the wrong key.
AOF_RELEASE_GPG_FINGERPRINT="${AOF_RELEASE_GPG_FINGERPRINT:-2755C3EEA9984BF729BC49973BAC1150DBECBC82}"

# aof_release_gpg_pubkey — the ASCII-armored EMBEDDED release public key
# (PLACEHOLDER, see above). Imported into the fresh per-run keyring by
# aof_import_release_key before any gpg --verify call — a fresh --homedir
# starts empty, so verification without this import always fails with
# "No public key" (craft-review F1: this was the actual bug — the prior
# revision created an empty keyring and never imported anything into it).
aof_release_gpg_pubkey() {
  cat <<'AOF_RELEASE_PUBKEY_EOF'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEakeiVhYJKwYBBAHaRw8BAQdAHCxtBA8QtQfdwQBPG7TVM04u3aiZF3TMcrE/
XAGsHDG0K2FvZiByZWxlYXNlIChwbGFjZWhvbGRlcikgPHJlbGVhc2VAYW9mLmRl
dj6IkwQTFgoAOxYhBCdVw+6pmEv3KbxJlzusEVDb7LyCBQJqR6JWAhsDBQsJCAcC
AiICBhUKCQgLAgQWAgMBAh4HAheAAAoJEDusEVDb7LyCWrsBAPJALpvPwBamkenf
m6SgAIR1RlwJL1fRT2wqTVJglVXKAP9ZVrm3hqX+UoBmdK+pQ4m/sz9OQduminvZ
lChd4ZDZDbg4BGpHolYSCisGAQQBl1UBBQEBB0DJ5QN+McA5pdhImmuynCjmdEwY
nrvUAI+3G3VsweVBKgMBCAeIeAQYFgoAIBYhBCdVw+6pmEv3KbxJlzusEVDb7LyC
BQJqR6JWAhsMAAoJEDusEVDb7LyCWIkBALfEH16cyZvA4x2N03gIS63dWYRuBoNt
qIiUbJ6pSNBFAPoCv0xYz5MvD4p/9ZTlv5jOvtrNN3hgS1C99u+/i1LFCw==
=Re1Q
-----END PGP PUBLIC KEY BLOCK-----
AOF_RELEASE_PUBKEY_EOF
}

# aof_import_release_key <keyring_dir>
#   Imports the release public key into the given (fresh, per-run) --homedir
#   BEFORE any gpg --verify call — never verify against an empty keyring.
#   AOF_RELEASE_GPG_PUBKEY_FILE (test-only, see the TESTABILITY note above)
#   substitutes a throwaway test key file instead of the embedded block, so a
#   test provisions the keyring EXACTLY the way production does: empty
#   homedir -> import -> verify.
aof_import_release_key() {
  keyring="$1"
  if [ -n "${AOF_RELEASE_GPG_PUBKEY_FILE:-}" ]; then
    aof_run_gpg --homedir "$keyring" --batch --import "$AOF_RELEASE_GPG_PUBKEY_FILE" >/dev/null 2>&1
  else
    aof_release_gpg_pubkey | aof_run_gpg --homedir "$keyring" --batch --import >/dev/null 2>&1
  fi
}

# ---------------------------------------------------------------------------
# 1. OS/arch detection -> release asset name + node-pty sidecar name
#
# The pinned asset-name SOFT CONTRACT with Story 01 (byte-exact, do not
# drift): aof-macos-arm64, aof-macos-x64, aof-linux-x64, aof-linux-arm64,
# aof-windows-x64.exe, aof-windows-arm64.exe, plus `node-pty <os>-<arch>`
# sidecars.
# ---------------------------------------------------------------------------

# aof_detect <os> <arch>
#   <os>/<arch> are the two `uname -sm` fields, pre-split by the caller (this
#   makes the case matrix directly testable without invoking `uname`).
#   Prints "<asset> <sidecar>" on success. Exits 3 with a clear message on an
#   unsupported combo, downloading nothing.
aof_detect() {
  uname_os="$1"
  uname_arch="$2"

  case "$uname_os" in
    Darwin)
      case "$uname_arch" in
        arm64 | aarch64) echo "aof-macos-arm64 node-pty-darwin-arm64" ;;
        x86_64) echo "aof-macos-x64 node-pty-darwin-x64" ;;
        *) aof_unsupported "$uname_os" "$uname_arch" ;;
      esac
      ;;
    Linux)
      case "$uname_arch" in
        x86_64 | amd64) echo "aof-linux-x64 node-pty-linux-x64" ;;
        aarch64 | arm64) echo "aof-linux-arm64 node-pty-linux-arm64" ;;
        *) aof_unsupported "$uname_os" "$uname_arch" ;;
      esac
      ;;
    *)
      aof_unsupported "$uname_os" "$uname_arch"
      ;;
  esac
}

# aof_unsupported <os> <arch> — the loud-fail path. Never picks a wrong asset.
aof_unsupported() {
  echo "aof install: unsupported platform '$1 $2' — no release asset is built for this OS/arch. Downloading nothing." >&2
  return 3
}

# aof_uname_pair — wraps `uname -sm`, splitting into two fields even when
# `uname -m` output has no space-safe guarantees. Kept separate from
# aof_detect so tests can call aof_detect directly with fixed strings, and so
# an unparseable string is its own testable path.
aof_uname_pair() {
  raw="$(uname -sm)" || { echo "aof install: could not run 'uname -sm' to detect this platform." >&2; return 3; }
  set -- $raw
  if [ "$#" -lt 2 ]; then
    echo "aof install: could not parse uname output '$raw' — unable to detect OS/arch. Downloading nothing." >&2
    return 3
  fi
  echo "$1 $2"
}

# ---------------------------------------------------------------------------
# 2. Download — the resolved binary AND its sidecar, together (a co-download,
#    never a second product). A failed leg aborts and leaves NO half-installed
#    tree (no binary without its sidecar).
# ---------------------------------------------------------------------------

# aof_download <url> <dest> — overridable by tests (stub this function name).
aof_download() {
  url="$1"
  dest="$2"
  curl -fsSL --progress-bar -o "$dest" "$url"
}

# aof_fetch_release <asset> <sidecar> <workdir>
#   Downloads asset + sidecar into workdir. On ANY failure, removes both
#   partial files and returns non-zero — no half-installed tree.
aof_fetch_release() {
  asset="$1"
  sidecar="$2"
  workdir="$3"

  asset_url="$AOF_INSTALL_HOST/releases/$AOF_INSTALL_VERSION/$asset"
  sidecar_url="$AOF_INSTALL_HOST/releases/$AOF_INSTALL_VERSION/$sidecar"

  if ! aof_download "$asset_url" "$workdir/$asset"; then
    echo "aof install: failed to download $asset_url" >&2
    rm -f "$workdir/$asset" "$workdir/$sidecar"
    return 1
  fi
  if ! aof_download "$sidecar_url" "$workdir/$sidecar"; then
    echo "aof install: failed to download $sidecar_url" >&2
    rm -f "$workdir/$asset" "$workdir/$sidecar"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# 3. Verify BEFORE PATH — checksum (always) + gpg (Linux only), against a
#    PINNED key fingerprint. Refuses on ANY mismatch. Never silently skips
#    verification: probe sha256sum/gpg availability and fail loudly if absent.
# ---------------------------------------------------------------------------

# aof_require_tool <name> — loud-fail if a required verification tool is
# missing, rather than silently skipping the check it gates.
aof_require_tool() {
  tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "aof install: required tool '$tool' is not available — refusing to skip verification. Install $tool and re-run." >&2
    return 4
  fi
}

# aof_require_sha256_tool — F2 (craft-review): stock macOS ships no
# sha256sum(1) at all (only Linux/coreutils does) — `command -v sha256sum`
# always fails there even though `shasum -a 256` (Perl's Digest::SHA wrapper,
# present on every macOS since Mac OS X 10.6) produces the IDENTICAL
# "<sha256>␠␠<filename>" first-field output aof_verify_checksum parses. Loud-
# fail only when NEITHER is available — never silently skip verification.
aof_require_sha256_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    return 0
  fi
  echo "aof install: neither 'sha256sum' nor 'shasum' is available — refusing to skip verification. Install one (macOS ships shasum by default; coreutils provides sha256sum on Linux) and re-run." >&2
  return 4
}

# aof_sha256 <path> — prints "<sha256>  <path>"-shaped output (the exact
# first-field shape aof_verify_checksum's `awk '{print $1}'` already parses),
# preferring sha256sum (GNU coreutils, Linux) and falling back to
# `shasum -a 256` (stock macOS, no coreutils sha256sum) when sha256sum is
# absent. aof_require_sha256_tool must be called first — this function does
# not itself loud-fail on total absence (its caller's probe already did).
aof_sha256() {
  path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path"
  else
    shasum -a 256 "$path"
  fi
}

# aof_manifest_line <manifest_file> <filename> — prints the matching
# "<sha256>  <filename>" line, or nothing if not listed.
aof_manifest_line() {
  manifest="$1"
  name="$2"
  # F9 (craft-review, optional hardening): a CRLF-mangled manifest (e.g.
  # fetched/re-saved through a tool that normalizes line endings to CRLF on
  # Windows) leaves a trailing \r on awk's $2 field, so `$2 == f` never
  # matches even though the filename is visually identical -- install.ps1's
  # own Get-AofManifestEntry already tolerates this via .Trim(). Strip a
  # trailing \r from $2 defensively before comparing, mirroring that
  # tolerance, so both installers agree on a CRLF manifest.
  awk -v f="$name" '{ field2 = $2; sub(/\r$/, "", field2); if (field2 == f) { print; found=1 } } END { if (!found) exit 1 }' "$manifest"
}

# aof_verify_checksum <manifest_file> <asset_path> <asset_name>
#   Returns 0 on match. Returns 5 = not-in-manifest, 6 = mismatch.
aof_verify_checksum() {
  manifest="$1"
  asset_path="$2"
  asset_name="$3"

  line="$(aof_manifest_line "$manifest" "$asset_name")" || {
    echo "aof install: $asset_name is not listed in SHA256SUMS — refusing to install." >&2
    return 5
  }
  expected="$(printf '%s' "$line" | awk '{print $1}')"
  actual="$(aof_sha256 "$asset_path" | awk '{print $1}')"
  if [ "$expected" != "$actual" ]; then
    echo "aof install: checksum mismatch for $asset_name (expected $expected, got $actual) — refusing to install." >&2
    return 6
  fi
}

# aof_run_gpg <args...> — overridable by tests (stub this function name).
aof_run_gpg() {
  gpg "$@"
}

# aof_verify_gpg_signature <manifest_file> <asc_file> <keyring_dir>
#   Linux-only. Verifies SHA256SUMS.asc against SHA256SUMS AND asserts the
#   signer's fingerprint is the PINNED one (F2 — a valid signature by an
#   UNPINNED key is refused). Returns 0 on trusted-valid, 7 on gpg verify
#   failure, 8 on untrusted/unpinned key.
aof_verify_gpg_signature() {
  manifest="$1"
  asc="$2"
  keyring="$3"

  if [ ! -f "$asc" ]; then
    echo "aof install: missing-signature error — SHA256SUMS.asc is missing — refusing to install (verification cannot be skipped)." >&2
    return 9
  fi

  gpg_out="$(aof_run_gpg --homedir "$keyring" --status-fd 1 --verify "$asc" "$manifest" 2>/dev/null)" || {
    echo "aof install: gpg signature verification failed for SHA256SUMS.asc — refusing to install." >&2
    return 7
  }

  # Extract the signer fingerprint from GnuPG's machine-readable status output
  # (VALIDSIG line, field 3) and compare against the pinned fingerprint.
  signer_fpr="$(printf '%s\n' "$gpg_out" | awk '/VALIDSIG/ { print $3 }')"
  pinned_fpr="$(printf '%s' "$AOF_RELEASE_GPG_FINGERPRINT" | tr -d ' ')"
  if [ -z "$signer_fpr" ] || [ "$signer_fpr" != "$pinned_fpr" ]; then
    echo "aof install: SHA256SUMS.asc is signed by an untrusted/unpinned key ($signer_fpr) — refusing to install." >&2
    return 8
  fi
}

# aof_verify_all <manifest> <workdir> <asset> <sidecar> <asc-or-empty> <keyring-or-empty> <is_linux>
#   Orchestrates the full verify step for BOTH co-downloaded artifacts. Both
#   must verify before EITHER is installed (a good binary + a bad sidecar
#   installs neither).
aof_verify_all() {
  manifest="$1"
  workdir="$2"
  asset="$3"
  sidecar="$4"
  asc="$5"
  keyring="$6"
  is_linux="$7"

  aof_require_sha256_tool || return $?

  if [ ! -f "$manifest" ]; then
    echo "aof install: SHA256SUMS is missing or unfetchable — refusing to install." >&2
    return 10
  fi

  # Explicit status checks (not bare `set -e` reliance) so this function is
  # equally correct whether the caller runs under `set -e` (production) or
  # `set +e` (tests exercising the refusal paths without killing the shell).
  # Both artifacts must verify before EITHER is installed.
  aof_verify_checksum "$manifest" "$workdir/$asset" "$asset" || return $?
  aof_verify_checksum "$manifest" "$workdir/$sidecar" "$sidecar" || return $?

  if [ "$is_linux" = "1" ]; then
    aof_require_tool gpg || return $?
    aof_verify_gpg_signature "$manifest" "$asc" "$keyring" || return $?
  fi
}

# ---------------------------------------------------------------------------
# 4. Place on PATH — per-user, no sudo. The binary + its sidecar travel
#    together (ADR-002). Re-install is idempotent: replaces in place, no
#    duplicate PATH entry, no stale sidecar left behind.
# ---------------------------------------------------------------------------

# aof_extract_sidecar <archive_path> <install_dir>
#   PO pin (2026-07-03, STATE.md "sidecar shape gap") + the CURRENT
#   scripts/release/stage-release-assets.mjs packSidecarArchive (re-confirmed
#   2026-07-03 against the real exported function, not a hand-rolled
#   invocation): the sidecar release asset is a gzip'd tar ARCHIVE (POSIX
#   legs) under the pinned extensionless name (node-pty-<darwin|linux>-<arch>),
#   whose root entries reproduce EXACTLY the directory layout
#   scripts/build-sea.mjs emits beside the exe: node-pty-sidecar/** (the raw
#   prebuild, kept for inspection) AND node_modules/node-pty/** (the whole
#   installed package — the piece createRequire(process.execPath)("node-pty")
#   — ADR-002 — actually resolves against, since Node module resolution walks
#   up from the anchor looking for node_modules/<id>). Extracting the tar
#   directly into install_dir reproduces both root entries verbatim.
#   Verifies the two expected root entries are ACTUALLY present in the
#   archive listing BEFORE extracting, and fails LOUDLY naming what was found
#   instead if they are not — never a silent partial/empty extraction (guards
#   against any future shape drift in the release packer, the same discipline
#   install.ps1's Expand-AofSidecar carries).
aof_extract_sidecar() {
  archive_path="$1"
  install_dir="$2"
  aof_require_tool tar || return $?

  listing="$(tar -tzf "$archive_path" 2>/dev/null)" || {
    echo "aof install: could not read the sidecar archive's contents ($archive_path) — refusing to extract." >&2
    return 11
  }
  if ! printf '%s\n' "$listing" | grep -q '^node-pty-sidecar/' || ! printf '%s\n' "$listing" | grep -q '^node_modules/node-pty/'; then
    found="$(printf '%s\n' "$listing" | awk -F/ '{print $1}' | sort -u | tr '\n' ' ')"
    echo "aof install: the sidecar archive's root entries do not match the expected shape (node-pty-sidecar/ + node_modules/node-pty/) — found instead: [$found]. Refusing to install a possibly-broken sidecar rather than silently extracting a partial tree." >&2
    return 12
  fi

  tar -xzf "$archive_path" -C "$install_dir"
}

# aof_install_files <workdir> <asset> <sidecar_archive> <install_dir>
#   Places the verified binary and EXTRACTS the verified sidecar archive into
#   the install dir (never copies the archive file itself into place — a
#   copied-but-unextracted archive means createRequire can't resolve
#   node_modules/node-pty and the terminal dock silently degrades even after a
#   "successful" install).
#
#   F5 (craft-review): NEVER leave a half-install. A failed sidecar extraction
#   (e.g. a wrong-shaped archive, aof_extract_sidecar's return 11/12) must
#   leave ANY PRIOR install fully intact -- the earlier revision of this
#   function destroyed the prior sidecar tree AND overwrote the prior binary
#   BEFORE attempting extraction, so a failure here left a broken half-install
#   (new binary, no sidecar at all) with no way back. Fixed by staging BOTH
#   artifacts into a fresh temp dir first -- extraction failure aborts before
#   anything under install_dir is touched -- and only moving the staged binary
#   + sidecar tree into install_dir (destroying the old ones) once staging has
#   FULLY succeeded. Removes any stale prior extracted tree (AND any stale
#   archive-as-file from an older installer version) only at that final move,
#   so an upgrade never leaves two sidecar generations side by side either.
aof_install_files() {
  install_workdir="$1"
  install_asset="$2"
  install_sidecar="$3"
  # NOTE (F5 footgun, do not rename back to a bare `install_dir`): POSIX sh
  # has no function-local variable scoping -- aof_extract_sidecar below ALSO
  # assigns its own second positional arg to a local named `install_dir`,
  # which silently clobbers a same-named variable here (confirmed
  # empirically: without the `install_` prefix, the final mkdir/mv block
  # below operated against aof_extract_sidecar's staging-dir parameter
  # instead of the real target, since both functions share sh's single
  # global namespace). Captured under a name that cannot collide with any
  # callee's own locals.
  install_target_dir="$4"

  staging_dir="$(mktemp -d)"

  # Stage the binary + extracted sidecar tree OUTSIDE install_target_dir
  # first -- nothing under install_target_dir is touched until staging fully
  # succeeds.
  cp "$install_workdir/$install_asset" "$staging_dir/aof" || { rm -rf "$staging_dir"; return 1; }
  chmod +x "$staging_dir/aof"
  aof_extract_sidecar "$install_workdir/$install_sidecar" "$staging_dir" || {
    extract_status=$?
    rm -rf "$staging_dir"
    return "$extract_status"
  }

  # Staging fully succeeded -- NOW it is safe to destroy the prior install and
  # move the new one into place. mkdir -p is idempotent for a genuinely fresh
  # install (no prior tree to preserve).
  mkdir -p "$install_target_dir"
  rm -rf "$install_target_dir/node-pty-sidecar" "$install_target_dir/node_modules"
  rm -f "$install_target_dir"/node-pty-*
  mv "$staging_dir/aof" "$install_target_dir/aof"
  mv "$staging_dir/node-pty-sidecar" "$install_target_dir/node-pty-sidecar"
  mkdir -p "$install_target_dir/node_modules"
  mv "$staging_dir/node_modules/node-pty" "$install_target_dir/node_modules/node-pty"

  rm -rf "$staging_dir"
}

# aof_profile_file — the shell profile to append PATH guidance to, detected
# from $SHELL (the deno_install pattern).
aof_profile_file() {
  case "${SHELL:-}" in
    */zsh) echo "$HOME/.zshrc" ;;
    */bash) echo "$HOME/.bashrc" ;;
    */fish) echo "$HOME/.config/fish/config.fish" ;;
    *) echo "$HOME/.profile" ;;
  esac
}

# aof_is_fish_profile <profile_file> — true (0) when the profile targeted is
# fish's config.fish, false (1) otherwise. Kept as its own testable decision
# rather than re-deriving from $SHELL, so aof_persist_path stays correct even
# when a test drives it against an arbitrary fixture profile path.
aof_is_fish_profile() {
  case "$1" in
    */config.fish) return 0 ;;
    *) return 1 ;;
  esac
}

# aof_persist_path <install_dir> <profile_file>
#   Appends PATH-persistence guidance to the shell profile, idempotently
#   (never duplicates the entry on re-install; replaces a STALE entry when
#   install_dir has changed between installs rather than silently skipping —
#   F10, craft-review).
#
#   F10: fish is NOT bash-syntax-compatible -- `export PATH="$install_dir:$PATH"`
#   is not valid fish syntax at all (fish has no `export NAME=value` form; the
#   nearest equivalent is `set -gx NAME value`), so a config.fish carrying the
#   bash-shaped line this function used to emit would produce a syntax error
#   on every fish shell start, not merely fail to persist PATH. Fish's own
#   idiomatic, IDEMPOTENT-BY-DESIGN primitive for exactly this is
#   `fish_add_path` (it already de-duplicates internally) -- used here for the
#   fish leg instead of a hand-rolled export line.
aof_persist_path() {
  install_dir="$1"
  profile="$2"
  marker="# aof install (added by install.sh)"
  if aof_is_fish_profile "$profile"; then
    persist_line="fish_add_path $install_dir"
  else
    persist_line="export PATH=\"$install_dir:\$PATH\""
  fi

  if [ -f "$profile" ] && grep -qF "$marker" "$profile" 2>/dev/null; then
    # F10: the marker exists, but AOF_INSTALL_DIR may have CHANGED since the
    # prior install (a different $HOME, a relocated install, etc.) -- a bare
    # early-return here would silently leave a STALE persisted path in place
    # forever. Replace the marker's immediately-following line (the persisted
    # PATH/fish_add_path line) in place when it differs, rather than skipping.
    if grep -qF "$persist_line" "$profile" 2>/dev/null; then
      return 0
    fi
    awk -v marker="$marker" -v newline="$persist_line" '
      { lines[NR] = $0 }
      $0 == marker { markerLine = NR }
      END {
        for (i = 1; i <= NR; i++) {
          if (i == markerLine + 1) { print newline } else { print lines[i] }
        }
      }
    ' "$profile" > "$profile.aof-tmp" && mv "$profile.aof-tmp" "$profile"
    return 0
  fi
  mkdir -p "$(dirname "$profile")"
  {
    echo ""
    echo "$marker"
    echo "$persist_line"
  } >> "$profile"
}

# ---------------------------------------------------------------------------
# main — glues the pipeline together. Not invoked when this file is sourced
# for testing (AOF_INSTALL_TEST set).
# ---------------------------------------------------------------------------

aof_main() {
  pair="$(aof_uname_pair)"
  set -- $pair
  detected_os="$1"
  detected_arch="$2"

  resolved="$(aof_detect "$detected_os" "$detected_arch")"
  set -- $resolved
  asset="$1"
  sidecar="$2"

  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' EXIT

  aof_fetch_release "$asset" "$sidecar" "$workdir"

  manifest="$workdir/SHA256SUMS"
  aof_download "$AOF_INSTALL_HOST/releases/$AOF_INSTALL_VERSION/SHA256SUMS" "$manifest" || true

  is_linux=0
  asc=""
  keyring=""
  if [ "$detected_os" = "Linux" ]; then
    is_linux=1
    asc="$workdir/SHA256SUMS.asc"
    aof_download "$AOF_INSTALL_HOST/releases/$AOF_INSTALL_VERSION/SHA256SUMS.asc" "$asc" || true
    keyring="$workdir/gpg-home"
    mkdir -p "$keyring"
    chmod 700 "$keyring"
  fi

  aof_verify_all "$manifest" "$workdir" "$asset" "$sidecar" "$asc" "$keyring" "$is_linux"

  aof_install_files "$workdir" "$asset" "$sidecar" "$AOF_INSTALL_DIR"
  aof_persist_path "$AOF_INSTALL_DIR" "$(aof_profile_file)"

  echo "aof installed to $AOF_INSTALL_DIR/aof"
  echo "Open a new shell, or run: export PATH=\"$AOF_INSTALL_DIR:\$PATH\""
}

if [ -z "${AOF_INSTALL_TEST:-}" ]; then
  aof_main "$@"
fi
