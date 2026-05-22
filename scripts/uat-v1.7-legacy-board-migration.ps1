param(
  [switch]$RemoveTemp
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ProjectDir = Join-Path $env:TEMP ("aof-v17-legacy-uat-" + [guid]::NewGuid().ToString("N"))
$Bin = Join-Path $RepoRoot "bin\aof.mjs"

$previousFixtureJson = $env:AOF_TEST_GSD_SDK_FIXTURE_JSON
$previousToolsVersion = $env:AOF_TEST_GSD_TOOLS_VERSION

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

function Assert-Equals {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Actual -ne $Expected) {
    throw "Unexpected ${Label}: expected $Expected, got $Actual"
  }
}

try {
  New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
  Push-Location $ProjectDir

  Write-FileUtf8 ".aof\aof.config.json" @'
{
  "$schema": "../schemas/aof.schema.json",
  "name": "legacy-board-uat",
  "resources": [],
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

  Write-FileUtf8 ".planning\ROADMAP.md" @'
# Roadmap

## Phase Details

### Phase 30: Build Board Execution

**Goal:** Execute assigned board tasks through GSD.

### Phase 31: Verify Board Progress

**Goal:** Verify progress is visible in the board UI.
'@

  Write-FileUtf8 ".aof\boards\legacy\BOARD.json" @'
{
  "version": 1,
  "id": "legacy",
  "title": "Legacy",
  "objective": "Upgrade a v1.6 board",
  "status": "active",
  "columns": ["backlog", "ready", "in_progress", "blocked", "done"],
  "executionProvider": "gsd",
  "defaultExecutionRuntime": "codex",
  "gsd": {
    "milestone": {
      "status": "completed",
      "roadmapPath": ".planning/ROADMAP.md"
    },
    "taskCreation": {
      "mode": "gsd-phase",
      "addPhaseCommand": "$gsd-phase add",
      "syncCommand": "aof boards sync legacy",
      "syncBlockedReason": null
    }
  },
  "createdAt": "2026-05-18T00:00:00.000Z",
  "updatedAt": "2026-05-18T00:00:00.000Z"
}
'@

  $env:AOF_TEST_GSD_SDK_FIXTURE_JSON = '{"milestone":"v1.7","phases":[{"number":"30","name":"Build Board Execution","goal":"Execute assigned board tasks through GSD."},{"number":"31","name":"Verify Board Progress","goal":"Verify progress is visible in the board UI."}]}'
  $env:AOF_TEST_GSD_TOOLS_VERSION = "1.42.2"

  Write-Host "UAT project: $ProjectDir"
  Write-Host ""

  $repairOutput = Invoke-Aof @("boards", "repair", "legacy")
  Assert-Contains $repairOutput "Board legacy attached to milestone v1.7." "legacy repair"
  Assert-Contains $repairOutput "continue: aof boards sync legacy --milestone v1.7" "legacy repair"
  Assert-Contains $repairOutput "binding: attached" "legacy repair"

  $board = Get-Content -Raw ".aof\boards\legacy\BOARD.json" | ConvertFrom-Json
  Assert-Equals $board.gsd.milestone.id "v1.7" "repaired milestone id"
  Assert-Equals $board.gsd.milestone.binding.status "attached" "repaired binding status"
  Assert-Equals $board.gsd.taskCreation.syncCommand "aof boards sync legacy --milestone v1.7" "repaired sync command"

  $syncOutput = Invoke-Aof @("boards", "sync", "legacy", "--milestone", "v1.7")
  Assert-Contains $syncOutput "Synced board legacy with GSD roadmap" "first sync"
  Assert-Contains $syncOutput "created: 2" "first sync"

  $secondSyncOutput = Invoke-Aof @("boards", "sync", "legacy", "--milestone", "v1.7")
  Assert-Contains $secondSyncOutput "Synced board legacy with GSD roadmap" "second sync"
  Assert-Contains $secondSyncOutput "created: 0" "second sync"

  $tasks = Get-ChildItem ".aof\boards\legacy\tasks" -Filter "*.json"
  Assert-Equals $tasks.Count 2 "task file count"
  foreach ($taskId in @("phase-30", "phase-31")) {
    if (-not (Test-Path ".aof\boards\legacy\tasks\$taskId.json")) {
      throw "Expected task file does not exist: $taskId.json"
    }
  }

  Write-Host ""
  Write-Host "PASS: v1.7 legacy board migration UAT succeeded."

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
}
