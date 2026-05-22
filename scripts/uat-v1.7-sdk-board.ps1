param(
  [switch]$RemoveTemp
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ProjectDir = Join-Path $env:TEMP ("aof-v17-uat-" + [guid]::NewGuid().ToString("N"))
$Bin = Join-Path $RepoRoot "bin\aof.mjs"

$previousFixtureJson = $env:AOF_TEST_GSD_SDK_FIXTURE_JSON
$previousToolsVersion = $env:AOF_TEST_GSD_TOOLS_VERSION
$previousPhaseResult = $env:AOF_TEST_GSD_PHASE_RESULT_JSON

function Write-FileUtf8 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $resolvedParent = (Resolve-Path -LiteralPath $parent).Path
  $targetPath = Join-Path $resolvedParent (Split-Path -Leaf $Path)
  [System.IO.File]::WriteAllText($targetPath, $Content, $utf8NoBom)
}

function Invoke-Aof {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $output = & node $Bin @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $text = ($output | Out-String).TrimEnd()
  if ($text) {
    Write-Host $text
  }
  if ($exitCode -ne 0) {
    throw "Command failed ($exitCode): aof $($Arguments -join ' ')"
  }
  return $text
}

function Assert-Contains {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not $Text.Contains($Expected)) {
    throw "Missing expected text for ${Label}: $Expected"
  }
}

function Assert-FileContains {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Expected
  )
  if (-not (Test-Path $Path)) {
    throw "Expected file does not exist: $Path"
  }
  $content = Get-Content -Raw $Path
  if (-not $content.Contains($Expected)) {
    throw "Expected file $Path to contain: $Expected"
  }
}

try {
  New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
  Push-Location $ProjectDir

  Write-FileUtf8 ".aof\aof.config.json" @'
{
  "$schema": "../schemas/aof.schema.json",
  "name": "uat-fixture",
  "resources": [
    {
      "kind": "agent",
      "id": "builder",
      "description": "Builder agent",
      "path": "assets/agents/builder/AGENT.md",
      "runtimes": ["claude", "codex"]
    }
  ],
  "packages": [
    {
      "id": "gsd",
      "namespace": "gsd",
      "source": "npm:get-shit-done-cc@latest",
      "runtimes": ["claude", "codex"]
    }
  ]
}
'@

  Write-FileUtf8 ".aof\assets\agents\builder\AGENT.md" "Build assigned board tasks."

  Write-FileUtf8 ".planning\ROADMAP.md" @'
# Roadmap

## Phase Details

### Phase 30: Build Board Execution

**Goal:** Execute assigned board tasks through GSD.

### Phase 31: Verify Board Progress

**Goal:** Verify progress is visible in the board UI.
'@

  $env:AOF_TEST_GSD_SDK_FIXTURE_JSON = '{"milestone":"v1.7","phases":[{"number":"30","name":"Build Board Execution","goal":"Execute assigned board tasks through GSD."},{"number":"31","name":"Verify Board Progress","goal":"Verify progress is visible in the board UI."}]}'
  $env:AOF_TEST_GSD_TOOLS_VERSION = "1.42.2"
  $env:AOF_TEST_GSD_PHASE_RESULT_JSON = '{"phaseName":"Build Board Execution","success":true,"totalCostUsd":0,"totalDurationMs":1,"steps":[]}'

  Write-Host "UAT project: $ProjectDir"
  Write-Host ""

  $createOutput = Invoke-Aof @("boards", "create", "delivery", "--title", "Delivery", "--objective", "Ship board state", "--execution-runtime", "claude")
  Assert-Contains $createOutput "execution: gsd runtime=claude" "board creation"
  Assert-Contains $createOutput "binding: pending-attachment" "board creation"

  $attachOutput = Invoke-Aof @("boards", "milestone", "attach", "delivery", "--milestone", "v1-7", "--roadmap", ".planning/ROADMAP.md")
  Assert-Contains $attachOutput "binding: attached" "milestone attach"

  $syncOutput = Invoke-Aof @("boards", "sync", "delivery", "--milestone", "v1-7")
  Assert-Contains $syncOutput "created: 2" "board sync"
  Assert-FileContains ".aof\boards\delivery\tasks\phase-30.json" '"phase": "30"'
  Assert-FileContains ".aof\boards\delivery\tasks\phase-31.json" '"phase": "31"'

  $doctorOutput = Invoke-Aof @("boards", "doctor", "delivery")
  Assert-Contains $doctorOutput "doctor: healthy" "board doctor"
  Assert-Contains $doctorOutput "PASS BOARD_TASKS_MATCH_ROADMAP" "board doctor"
  Assert-Contains $doctorOutput "WARN SDK_VERSION_DRIFT" "board doctor"

  $assignOutput = Invoke-Aof @("boards", "task", "assign", "delivery", "phase-30", "builder")
  Assert-Contains $assignOutput "Started gsd execution status=complete phase=30" "task assignment"
  Assert-FileContains ".aof\boards\delivery\executions\phase-30.json" '"status": "complete"'

  Write-Host ""
  Write-Host "PASS: v1.7 SDK board UAT smoke succeeded."

  if ($RemoveTemp) {
    Pop-Location
    Remove-Item -Recurse -Force $ProjectDir
    Write-Host "Removed UAT project: $ProjectDir"
  } else {
    Pop-Location
    Write-Host "Kept UAT project for inspection: $ProjectDir"
  }
} catch {
  try {
    Pop-Location
  } catch {
  }
  Write-Error $_
  Write-Host "UAT project retained for debugging: $ProjectDir"
  exit 1
} finally {
  if ($null -eq $previousFixtureJson) {
    Remove-Item Env:AOF_TEST_GSD_SDK_FIXTURE_JSON -ErrorAction SilentlyContinue
  } else {
    $env:AOF_TEST_GSD_SDK_FIXTURE_JSON = $previousFixtureJson
  }

  if ($null -eq $previousToolsVersion) {
    Remove-Item Env:AOF_TEST_GSD_TOOLS_VERSION -ErrorAction SilentlyContinue
  } else {
    $env:AOF_TEST_GSD_TOOLS_VERSION = $previousToolsVersion
  }

  if ($null -eq $previousPhaseResult) {
    Remove-Item Env:AOF_TEST_GSD_PHASE_RESULT_JSON -ErrorAction SilentlyContinue
  } else {
    $env:AOF_TEST_GSD_PHASE_RESULT_JSON = $previousPhaseResult
  }
}
