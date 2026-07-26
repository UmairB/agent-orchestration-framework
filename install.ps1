# aof -- the one-line PowerShell installer.
#
#   irm https://<host>/install.ps1 | iex
#
# ARCHITECTURE ADR-006 (milestone 28, story 02): detect OS/arch via
# PROCESSOR_ARCHITECTURE + Is64BitOperatingSystem (WOW64-safe -- a 32-bit host
# process on a 64-bit Windows OS must NOT mis-detect as x86) -> resolve the
# matching signed release asset PLUS its node-pty sidecar (ADR-002 --
# co-download, not a second product) -> fetch SHA256SUMS -> Get-FileHash
# verify BEFORE placing anything on PATH (refuse on ANY mismatch) -> place the
# verified binary + its co-located sidecar under $HOME\.aof\bin (no
# admin/sudo) -> persist the user PATH by reading/writing the HKCU\Environment
# registry key DIRECTLY (Get-AofUserPath / Set-AofUserPath) -- NOT `setx`
# (setx truncates PATH values over 1024 chars, a real risk on a long user
# PATH) and NOT [Environment]::[Get|Set]EnvironmentVariable('Path', ...,
# 'User') either (F7, craft-review: that API always returns an EXPANDED value
# and always writes back REG_SZ, which permanently expands any %VAR%-style
# token a user's existing PATH already carried and silently flips
# REG_EXPAND_SZ -> REG_SZ). The registry API reads with
# DoNotExpandEnvironmentNames and writes back as
# [Microsoft.Win32.RegistryValueKind]::ExpandString, preserving both the
# literal token and the original value type.
#
# Greenfield, file-disjoint from src/ (ARCHITECTURE section Story break-down
# rationale, point 3). Never touches src/frameworks.mjs's npx installer.
#
# TESTABILITY: this script is safe to dot-source for unit testing. When
# $env:AOF_INSTALL_TEST is set to a non-empty value, dot-sourcing the script
# defines every function below but does NOT run Main / touch the network /
# write files -- the test then calls the functions directly, optionally
# overriding Invoke-AofDownload / Get-FileHash-backed verification via
# fixtures. See test/installer-detect.test.mjs and
# test/installer-verify.test.mjs.
#
# F11 (craft-review): under `irm https://.../install.ps1 | iex`, this script's
# top-level statements run IN THE CALLER'S OWN SESSION -- an unguarded
# `$ErrorActionPreference = "Stop"` here would PERMANENTLY change the user's
# interactive shell's error-handling behavior for the rest of that session,
# well after the installer itself has finished. Only Invoke-AofInstall's
# execution needs "Stop" (so every cmdlet failure is caught by its try/catch);
# that function now saves the caller's original preference and restores it in
# a finally block, regardless of success or failure. Function DEFINITIONS
# below are unaffected either way (defining a function never runs its body).

# ---------------------------------------------------------------------------
# Configuration (overridable via env for testing / mirrors)
# ---------------------------------------------------------------------------

function Get-AofInstallHost {
    if ($env:AOF_INSTALL_HOST) { return $env:AOF_INSTALL_HOST }
    return "https://get.aof.dev"
}

function Get-AofInstallVersion {
    if ($env:AOF_INSTALL_VERSION) { return $env:AOF_INSTALL_VERSION }
    return "latest"
}

function Get-AofInstallDir {
    if ($env:AOF_INSTALL_DIR) { return $env:AOF_INSTALL_DIR }
    return (Join-Path $HOME ".aof\bin")
}

# ---------------------------------------------------------------------------
# 1. OS/arch detection -> release asset name + node-pty sidecar name
#
# The pinned asset-name SOFT CONTRACT with Story 01 (byte-exact, do not
# drift): aof-windows-x64.exe, aof-windows-arm64.exe (+ macOS/Linux names
# handled by install.sh), plus `node-pty <os>-<arch>` sidecars.
#
# WOW64: a 32-bit PowerShell host process running on a 64-bit Windows OS
# reports PROCESSOR_ARCHITECTURE=x86 while the OS itself is 64-bit. Trusting
# PROCESSOR_ARCHITECTURE alone would mis-detect that machine as x86 (no build
# shipped) instead of resolving the real 64-bit asset. Is64BitOperatingSystem
# (or PROCESSOR_ARCHITEW6432, its WOW64 twin) is the source of truth for the
# OS's real bitness.
# ---------------------------------------------------------------------------

# Resolve-AofAsset [-ProcessorArchitecture <string>] [-Is64BitOperatingSystem <bool>]
#   Prints/returns @{ Asset = ...; Sidecar = ... } on success. Throws a clear
#   "unsupported platform" error naming the detected OS/arch on an unmapped
#   combo -- never a wrong asset.
function Resolve-AofAsset {
    param(
        [Parameter(Mandatory = $true)][string]$ProcessorArchitecture,
        [Parameter(Mandatory = $true)][bool]$Is64BitOperatingSystem
    )

    $arch = $ProcessorArchitecture.ToUpperInvariant()

    if ($arch -eq "ARM64") {
        return @{ Asset = "aof-windows-arm64.exe"; Sidecar = "node-pty-win32-arm64" }
    }

    if ($arch -eq "AMD64") {
        if (-not $Is64BitOperatingSystem) {
            throw "aof install: unsupported platform 'Windows AMD64 (32-bit OS)' -- no release asset is built for this OS/arch. Downloading nothing."
        }
        return @{ Asset = "aof-windows-x64.exe"; Sidecar = "node-pty-win32-x64" }
    }

    if ($arch -eq "X86") {
        if ($Is64BitOperatingSystem) {
            # WOW64: a 32-bit host process on a 64-bit OS. Trust the OS
            # bitness, not the (mis-detecting) host-process arch string.
            return @{ Asset = "aof-windows-x64.exe"; Sidecar = "node-pty-win32-x64" }
        }
        throw "aof install: unsupported platform 'Windows x86' -- no release asset is built for this OS/arch. Downloading nothing."
    }

    throw "aof install: unsupported platform 'Windows $ProcessorArchitecture' -- no release asset is built for this OS/arch. Downloading nothing."
}

# Get-AofDetectedPlatform -- wraps the real environment reads (kept separate
# so tests call Resolve-AofAsset directly with fixed inputs).
function Get-AofDetectedPlatform {
    $procArch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) {
        # A WOW64 process also exposes the true arch here; prefer it when set.
        $procArch = $env:PROCESSOR_ARCHITEW6432
    }
    return @{
        ProcessorArchitecture   = $procArch
        Is64BitOperatingSystem  = [Environment]::Is64BitOperatingSystem
    }
}

# ---------------------------------------------------------------------------
# 2. Download -- the resolved binary AND its sidecar, together (a co-download,
#    never a second product). A failed leg aborts and leaves NO
#    half-installed tree (no binary without its sidecar).
# ---------------------------------------------------------------------------

# Invoke-AofDownload -- overridable by tests (Set-Item function:Invoke-AofDownload).
function Invoke-AofDownload {
    param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Dest)
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
}

# Get-AofRelease -Asset <string> -Sidecar <string> -WorkDir <string>
#   Downloads asset + sidecar into WorkDir. On ANY failure, removes both
#   partial files and re-throws -- no half-installed tree. The re-thrown
#   error NAMES the exact asset (URL) that failed to download, and notes that
#   the asset may simply not be published for this platform yet (F4,
#   craft-review) -- Windows arm64 is detected per the asset-name contract
#   (Resolve-AofAsset resolves aof-windows-arm64.exe) but this repo does not
#   guarantee every detected platform has a published release leg; a bare
#   "failed to download" with only the underlying HTTP exception message left
#   a user guessing whether their network was broken or the asset simply does
#   not exist yet.
function Get-AofRelease {
    param(
        [Parameter(Mandatory = $true)][string]$Asset,
        [Parameter(Mandatory = $true)][string]$Sidecar,
        [Parameter(Mandatory = $true)][string]$WorkDir
    )

    $assetUrl = "$(Get-AofInstallHost)/releases/$(Get-AofInstallVersion)/$Asset"
    $sidecarUrl = "$(Get-AofInstallHost)/releases/$(Get-AofInstallVersion)/$Sidecar"
    $assetDest = Join-Path $WorkDir $Asset
    $sidecarDest = Join-Path $WorkDir $Sidecar

    try {
        Invoke-AofDownload -Url $assetUrl -Dest $assetDest
    } catch {
        Remove-Item -Path $assetDest, $sidecarDest -ErrorAction SilentlyContinue
        throw "aof install: failed to download $Asset from $assetUrl -- $($_.Exception.Message). This asset may not be published for this platform yet."
    }

    try {
        Invoke-AofDownload -Url $sidecarUrl -Dest $sidecarDest
    } catch {
        Remove-Item -Path $assetDest, $sidecarDest -ErrorAction SilentlyContinue
        throw "aof install: failed to download $Sidecar from $sidecarUrl -- $($_.Exception.Message). This asset may not be published for this platform yet."
    }
}

# ---------------------------------------------------------------------------
# 3. Verify BEFORE PATH -- Get-FileHash against SHA256SUMS. Refuses on ANY
#    mismatch. (GPG is Linux-only, handled by install.sh; Windows leans on
#    Authenticode at run time per ADR-005/ADR-006.)
# ---------------------------------------------------------------------------

# Get-AofManifestEntry -Manifest <path> -Name <string>
#   Returns the expected lowercase hex sha256 for $Name, or $null if the
#   manifest doesn't list it. Manifest lines are `<sha256>  <filename>` (two
#   spaces, LF) -- Story 01's soft-contract shape.
function Get-AofManifestEntry {
    param([Parameter(Mandatory = $true)][string]$Manifest, [Parameter(Mandatory = $true)][string]$Name)

    if (-not (Test-Path $Manifest)) { return $null }
    foreach ($line in Get-Content -Path $Manifest) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line -split "  ", 2
        if ($parts.Length -eq 2 -and $parts[1].Trim() -eq $Name) {
            return $parts[0].Trim().ToLowerInvariant()
        }
    }
    return $null
}

# Test-AofChecksum -Manifest <path> -AssetPath <path> -Name <string>
#   Throws a "not-in-manifest" or "checksum mismatch" error on any refusal;
#   returns quietly on a verified match.
function Test-AofChecksum {
    param(
        [Parameter(Mandatory = $true)][string]$Manifest,
        [Parameter(Mandatory = $true)][string]$AssetPath,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $expected = Get-AofManifestEntry -Manifest $Manifest -Name $Name
    if ($null -eq $expected) {
        throw "aof install: $Name is not listed in SHA256SUMS -- refusing to install."
    }
    $actual = (Get-FileHash -Path $AssetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "aof install: checksum mismatch for $Name (expected $expected, got $actual) -- refusing to install."
    }
}

# Test-AofRelease -Manifest <path> -WorkDir <path> -Asset <string> -Sidecar <string>
#   Both artifacts must verify before EITHER is installed (a good binary + a
#   bad sidecar installs neither -- the whole install is refused).
function Test-AofRelease {
    param(
        [Parameter(Mandatory = $true)][string]$Manifest,
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][string]$Asset,
        [Parameter(Mandatory = $true)][string]$Sidecar
    )

    if (-not (Test-Path $Manifest)) {
        throw "aof install: SHA256SUMS is missing or unfetchable -- refusing to install."
    }

    Test-AofChecksum -Manifest $Manifest -AssetPath (Join-Path $WorkDir $Asset) -Name $Asset
    Test-AofChecksum -Manifest $Manifest -AssetPath (Join-Path $WorkDir $Sidecar) -Name $Sidecar
}

# ---------------------------------------------------------------------------
# 4. Place on PATH -- per-user, no admin. The binary + its sidecar travel
#    together (ADR-002). Re-install is idempotent: replaces in place, no
#    duplicate PATH entry, no stale sidecar left behind.
# ---------------------------------------------------------------------------

# Expand-AofSidecar -ArchivePath <path> -InstallDir <path>
#   PO pin (2026-07-03, STATE.md "sidecar shape gap") + the CURRENT
#   scripts/release/stage-release-assets.mjs packSidecarArchive (story 01,
#   re-confirmed 2026-07-03 after that script staged BOTH root entries under a
#   temp dir before Compress-Archive specifically so the two-root-entry shape
#   comes out NESTED, matching the POSIX tar leg byte-for-byte): the sidecar
#   release asset is a ZIP archive (Windows legs) under the pinned
#   extensionless name (node-pty-win32-<arch>) whose ROOT ENTRIES are exactly
#   "node-pty-sidecar/**" and "node_modules/node-pty/**" -- the SAME shape
#   scripts/build-sea.mjs emits beside the exe. Extracting straight into
#   InstallDir therefore reproduces that layout directly -- NO re-nesting
#   step (an earlier revision of this function assumed a FLAT
#   Compress-Archive `-Path 'dir\*','otherDir'` shape that no longer exists;
#   that assumption silently installed NO sidecar at all when run against the
#   real nested packer -- fixed here, and guarded below so any FUTURE shape
#   drift fails loudly instead of repeating that silent-degrade).
#   Expand-Archive requires a .zip extension, but the pinned asset name has
#   none -- ExtractToDirectory works on any path regardless of extension.
function Expand-AofSidecar {
    param([Parameter(Mandatory = $true)][string]$ArchivePath, [Parameter(Mandatory = $true)][string]$InstallDir)

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ("aof-sidecar-extract-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $stagingDir)

        $sidecarSrc = Join-Path $stagingDir "node-pty-sidecar"
        $moduleSrc = Join-Path (Join-Path $stagingDir "node_modules") "node-pty"

        if (-not (Test-Path $sidecarSrc) -or -not (Test-Path $moduleSrc)) {
            $found = Get-ChildItem -Path $stagingDir -Force | Select-Object -ExpandProperty Name
            throw ("aof install: the sidecar archive's root entries do not match the expected shape " +
                "(node-pty-sidecar/ + node_modules/node-pty/) -- found instead: [" + ($found -join ", ") + "]. " +
                "Refusing to install a possibly-broken sidecar rather than silently skipping it (a missing " +
                "node_modules/node-pty means createRequire cannot resolve node-pty and the terminal dock would " +
                "silently degrade with no diagnostic).")
        }

        Copy-Item -Path $sidecarSrc -Destination (Join-Path $InstallDir "node-pty-sidecar") -Recurse -Force
        New-Item -ItemType Directory -Path (Join-Path $InstallDir "node_modules") -Force | Out-Null
        Copy-Item -Path $moduleSrc -Destination (Join-Path (Join-Path $InstallDir "node_modules") "node-pty") -Recurse -Force
    } finally {
        Remove-Item -Path $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Install-AofFiles -WorkDir <path> -Asset <string> -Sidecar <string> -InstallDir <path>
#   Places the verified binary and EXTRACTS the verified sidecar archive into
#   the install dir (never copies the archive file itself into place -- a
#   copied-but-unextracted archive means createRequire can't resolve
#   node_modules\node-pty and the terminal dock silently degrades even after a
#   "successful" install).
#
#   F5 (craft-review): NEVER leave a half-install. A failed sidecar extraction
#   (Expand-AofSidecar's shape-mismatch throw) must leave ANY PRIOR install
#   fully intact -- the earlier revision of this function removed the prior
#   sidecar tree AND overwrote the prior binary BEFORE calling
#   Expand-AofSidecar, so a shape-mismatch there left a broken half-install
#   (new binary, no sidecar) with no way back. Fixed by staging BOTH
#   artifacts into a fresh temp dir first -- extraction failure aborts before
#   anything under InstallDir is touched -- and only moving the staged binary
#   + sidecar tree into InstallDir (destroying the old ones) once staging has
#   FULLY succeeded. Clears any stale prior extracted tree (AND any stale
#   archive-as-file from an older installer version) only at that final move,
#   so an upgrade never leaves two sidecar generations side by side either.
function Install-AofFiles {
    param(
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][string]$Asset,
        [Parameter(Mandatory = $true)][string]$Sidecar,
        [Parameter(Mandatory = $true)][string]$InstallDir
    )

    $stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ("aof-install-stage-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
    try {
        # Stage the binary + extracted sidecar tree OUTSIDE InstallDir first --
        # nothing under InstallDir is touched until staging fully succeeds.
        Copy-Item -Path (Join-Path $WorkDir $Asset) -Destination (Join-Path $stagingDir "aof.exe") -Force
        Expand-AofSidecar -ArchivePath (Join-Path $WorkDir $Sidecar) -InstallDir $stagingDir

        # Staging fully succeeded (Expand-AofSidecar would have thrown on a
        # shape mismatch, leaving InstallDir untouched) -- NOW it is safe to
        # clear the prior install and move the new one into place.
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        $staleSidecarDir = Join-Path $InstallDir "node-pty-sidecar"
        $staleModulesDir = Join-Path $InstallDir "node_modules"
        Remove-Item -Path $staleSidecarDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $staleModulesDir -Recurse -Force -ErrorAction SilentlyContinue
        Get-ChildItem -Path $InstallDir -Filter "node-pty-*" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

        # F6 (craft-review): -ErrorAction SilentlyContinue above means a
        # LOCKED file (e.g. pty.node held open by a live terminal session)
        # makes the Remove-Item calls fail SILENTLY -- the stale directory
        # would still exist here, and the Move-Item calls below would then
        # nest the new tree INSIDE the stale one (Move-Item's semantics: "move
        # X into existing directory Y" rather than "replace Y with X") and
        # still report success, silently corrupting the sidecar layout
        # createRequire needs. Verify the removal actually took before
        # proceeding -- loud failure naming the fix, never a silent nest.
        if ((Test-Path $staleSidecarDir) -or (Test-Path $staleModulesDir)) {
            throw ("aof install: could not remove the prior install at '$InstallDir' -- a file may be locked by a " +
                "running aof process (e.g. an open terminal session holding node-pty's pty.node). Close all aof " +
                "terminal sessions and re-run the installer.")
        }

        Move-Item -Path (Join-Path $stagingDir "aof.exe") -Destination (Join-Path $InstallDir "aof.exe") -Force
        Move-Item -Path (Join-Path $stagingDir "node-pty-sidecar") -Destination (Join-Path $InstallDir "node-pty-sidecar") -Force
        New-Item -ItemType Directory -Path (Join-Path $InstallDir "node_modules") -Force | Out-Null
        Move-Item -Path (Join-Path (Join-Path $stagingDir "node_modules") "node-pty") -Destination (Join-Path (Join-Path $InstallDir "node_modules") "node-pty") -Force
    } finally {
        Remove-Item -Path $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Get-AofUserPath / Set-AofUserPath -- F7 (craft-review): read/write the
# HKCU\Environment "Path" value DIRECTLY via the registry API, rather than
# [Environment]::[Get|Set]EnvironmentVariable('Path', ..., 'User').
# [Environment]::GetEnvironmentVariable always returns the EXPANDED value
# (any %USERPROFILE%-style token in the user's existing PATH is resolved to
# its literal value before we ever see it), and
# [Environment]::SetEnvironmentVariable always writes back as REG_SZ -- so a
# round-trip through those two calls PERMANENTLY expands any %VAR%-style
# entry a user already had in their PATH (a real, silent, one-way data-loss
# bug: their PATH no longer tracks that variable if it later changes) and
# flips the registry value's type from REG_EXPAND_SZ to REG_SZ even when nothing
# needed expanding. Fixed by reading raw (DoNotExpandEnvironmentNames) and
# writing back as ExpandString, preserving both the literal %VAR% tokens and
# the original REG_EXPAND_SZ type. The injectable-function seam is UNCHANGED
# (tests still override Get-AofUserPath/Set-AofUserPath via
# Set-Item function:Get-AofUserPath / function:Set-AofUserPath) so no test
# ever touches the real registry.
function Get-AofUserPath {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment")
    if ($null -eq $key) { return $null }
    try {
        return $key.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    } finally {
        $key.Close()
    }
}

function Set-AofUserPath {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
    try {
        $key.SetValue("Path", $Value, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    } finally {
        $key.Close()
    }
}

# Add-AofToUserPath -InstallDir <path>
#   Persists the per-user PATH via the HKCU\Environment registry API
#   (Get-AofUserPath / Set-AofUserPath above) -- NOT setx (setx truncates
#   values over 1024 chars, corrupting a long existing user PATH) and NOT
#   [Environment]::[Get|Set]EnvironmentVariable (which round-trips through an
#   EXPANDED value and always writes back REG_SZ, permanently losing any
#   %VAR%-style token a user's PATH already carried -- F7, craft-review).
#   Idempotent: does not duplicate the entry on re-install.
function Add-AofToUserPath {
    param([Parameter(Mandatory = $true)][string]$InstallDir)

    $currentPath = Get-AofUserPath
    if ($null -eq $currentPath) { $currentPath = "" }

    $entries = $currentPath -split ";" | Where-Object { $_ -ne "" }
    if ($entries -contains $InstallDir) {
        return
    }

    $newPath = if ($currentPath.Trim() -eq "") { $InstallDir } else { "$currentPath;$InstallDir" }
    Set-AofUserPath -Value $newPath
    # Make the CURRENT session see it too (persistence is the registry write
    # above; this just avoids forcing a restart to use the install shell).
    $env:Path = "$env:Path;$InstallDir"
}

# ---------------------------------------------------------------------------
# Main -- glues the pipeline together. Not invoked when this file is
# dot-sourced for testing ($env:AOF_INSTALL_TEST set).
# ---------------------------------------------------------------------------

function Invoke-AofInstall {
    # F11 (craft-review): save the CALLER's $ErrorActionPreference (this
    # script runs in the caller's own session under `irm | iex`) and restore
    # it in `finally` -- regardless of success or failure -- so the installer
    # never permanently changes the user's interactive shell's error-handling
    # behavior after it finishes.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Stop"

    # F11: force TLS 1.2 before any download. Windows PowerShell 5.1's
    # default SecurityProtocol on older Windows versions can exclude TLS 1.2,
    # in which case Invoke-WebRequest against an HTTPS-only host fails with an
    # opaque "underlying connection was closed" error rather than a clear
    # TLS-version message. PowerShell 7+/pwsh already defaults to the OS's
    # modern TLS set, so this is a no-op there -- but it is REQUIRED for
    # Windows PowerShell 5.1 compatibility (the one-liner's `irm | iex` may
    # run under either).
    $previousSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("aof-install-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null

    try {
        $platform = Get-AofDetectedPlatform
        $resolved = Resolve-AofAsset -ProcessorArchitecture $platform.ProcessorArchitecture -Is64BitOperatingSystem $platform.Is64BitOperatingSystem

        Get-AofRelease -Asset $resolved.Asset -Sidecar $resolved.Sidecar -WorkDir $workDir

        $manifestPath = Join-Path $workDir "SHA256SUMS"
        try {
            Invoke-AofDownload -Url "$(Get-AofInstallHost)/releases/$(Get-AofInstallVersion)/SHA256SUMS" -Dest $manifestPath
        } catch {
            # Verification below refuses cleanly on the missing manifest.
        }

        Test-AofRelease -Manifest $manifestPath -WorkDir $workDir -Asset $resolved.Asset -Sidecar $resolved.Sidecar

        $installDir = Get-AofInstallDir
        Install-AofFiles -WorkDir $workDir -Asset $resolved.Asset -Sidecar $resolved.Sidecar -InstallDir $installDir
        Add-AofToUserPath -InstallDir $installDir

        Write-Host "aof installed to $installDir\aof.exe"
        Write-Host ('Open a new shell to pick up the PATH change (or run: $env:Path += ";' + $installDir + '")')
    } finally {
        Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
        [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

if (-not $env:AOF_INSTALL_TEST) {
    Invoke-AofInstall
}
