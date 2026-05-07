$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$IntegrationDir = $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $IntegrationDir "..\..")
$CliPath = Join-Path $RepoRoot "bin\aof.mjs"
$FeatureFile = Join-Path $IntegrationDir "cli.feature"

function Parse-Feature {
  param([string] $FeatureFile)
  $Feature = [ordered]@{ Name = Split-Path $FeatureFile -Leaf; Scenarios = New-Object System.Collections.ArrayList }
  $CurrentScenario = $null

  foreach ($RawLine in Get-Content $FeatureFile) {
    $Line = $RawLine.Trim()
    if ($Line -eq "" -or $Line.StartsWith("#")) { continue }
    if ($Line.StartsWith("Feature:")) { $Feature.Name = $Line.Substring("Feature:".Length).Trim(); continue }
    if ($Line.StartsWith("Scenario:")) {
      $CurrentScenario = [ordered]@{ Name = $Line.Substring("Scenario:".Length).Trim(); Steps = New-Object System.Collections.ArrayList }
      [void]$Feature.Scenarios.Add($CurrentScenario)
      continue
    }
    if ($Line -match "^(Given|When|Then|And)\s+(.+)$") {
      if ($null -eq $CurrentScenario) { throw "Step appears before scenario in ${FeatureFile}: ${Line}" }
      [void]$CurrentScenario.Steps.Add($Matches[2])
    }
  }
  return $Feature
}

function Run-Scenario {
  param($Scenario)
  $Root = Join-Path ([System.IO.Path]::GetTempPath()) ("aof-bdd-" + [System.Guid]::NewGuid().ToString("N"))
  $Context = [ordered]@{ ProjectDir = Join-Path $Root "project"; DataDir = Join-Path $Root "data"; LastResult = $null }
  try {
    foreach ($Step in $Scenario.Steps) { Run-Step $Context $Step }
  } finally {
    if (Test-Path $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
  }
}

function Run-Step {
  param($Context, [string] $Step)

  if ($Step -eq "an empty project") {
    New-Item -ItemType Directory -Path $Context.ProjectDir -Force | Out-Null
    return
  }

  if ($Step -eq "a project initialized with legacy AOF config") {
    Run-Step $Context "an empty project"
    Set-Content -Path (Join-Path $Context.ProjectDir "aof.config.json") -Value (Legacy-Config) -NoNewline
    $Context.LastResult = $null
    return
  }

  if ($Step -eq "a project initialized with AOF config") {
    Run-Step $Context "an empty project"
    $Result = Run-Cli $Context "init --items project-context,prime --codex" ""
    Assert-Equal 0 $Result.Status (Format-Result $Result)
    $Context.LastResult = $Result
    return
  }

  if ($Step -eq "a project with .aof file-backed config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "file-backed"; description = "File backed"; path = "assets/skills/file-backed/SKILL.md"; bodyPath = "assets/skills/file-backed/SKILL.md"; body = "File-backed body" }) @()
    return
  }

  if ($Step -eq "a project with .aof runtime override config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "overridden"; description = "Shared"; path = "assets/skills/overridden/SKILL.md"; bodyPath = "assets/skills/overridden/SKILL.md"; body = "Shared body"; overridePath = "assets/skills/overridden/overrides/codex.json"; override = @{ body = "Codex override body" } }) @()
    return
  }

  if ($Step -eq "a project with .aof invalid identity override config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "bad-override"; description = "Shared"; path = "assets/skills/bad-override/SKILL.md"; bodyPath = "assets/skills/bad-override/SKILL.md"; body = "Shared body"; overridePath = "assets/skills/bad-override/overrides/codex.json"; override = @{ id = "changed" } }) @()
    return
  }

  if ($Step -eq "a project with .aof rule config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "rule"; id = "project-rule"; description = "Rule"; paths = @("src"); path = "assets/rules/project-rule/RULE.md"; bodyPath = "assets/rules/project-rule/RULE.md"; body = "Use scoped guidance" }) @()
    return
  }

  if ($Step -eq "a project with .aof multiple codex rules config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(
      @{ kind = "rule"; id = "zeta"; description = "Zeta"; path = "assets/rules/zeta/RULE.md"; bodyPath = "assets/rules/zeta/RULE.md"; body = "Zeta guidance" },
      @{ kind = "rule"; id = "alpha"; description = "Alpha"; path = "assets/rules/alpha/RULE.md"; bodyPath = "assets/rules/alpha/RULE.md"; body = "Alpha guidance" }
    ) @()
    return
  }

  if ($Step -eq "a project with .aof package config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "file-backed"; description = "File backed"; path = "assets/skills/file-backed/SKILL.md"; bodyPath = "assets/skills/file-backed/SKILL.md"; body = "File-backed body" }) @(@{ id = "gsd"; source = "npm:get-shit-done-cc@latest"; runtimes = @("codex") })
    return
  }

  if ($Step -eq "a project with multi-runtime .aof package config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "file-backed"; description = "File backed"; path = "assets/skills/file-backed/SKILL.md"; bodyPath = "assets/skills/file-backed/SKILL.md"; body = "File-backed body" }) @(@{ id = "gsd"; source = "npm:get-shit-done-cc@latest"; runtimes = @("claude", "codex") })
    return
  }

  if ($Step -eq "a project with .aof package config and stale legacy config") {
    Run-Step $Context "a project with .aof package config"
    Set-Content -Path (Join-Path $Context.ProjectDir "aof.config.json") -Value "{}" -NoNewline
    return
  }

  if ($Step -eq "a project with invalid .aof config") {
    Run-Step $Context "an empty project"
    $WorkspaceDir = Join-Path $Context.ProjectDir ".aof"
    New-Item -ItemType Directory -Path $WorkspaceDir -Force | Out-Null
    $Config = @{ resources = @(@{ kind = "skill"; id = "bad"; path = "missing.md"; runtimes = @("other") }); packages = @(@{ id = "other"; source = "git:example"; runtimes = @() }) } | ConvertTo-Json -Depth 10
    Set-Content -Path (Join-Path $WorkspaceDir "aof.config.json") -Value $Config
    return
  }

  if ($Step -eq "the .aof config has no resources") {
    $Config = @{ '$schema' = "../schemas/aof.schema.json"; name = "empty"; resources = @() } | ConvertTo-Json -Depth 10
    Set-Content -Path (Join-Path $Context.ProjectDir ".aof\aof.config.json") -Value $Config
    return
  }

  if ($Step -match "^I run ``(.+)`` with input ``([\s\S]*)``$") {
    $Context.LastResult = Run-Cli $Context $Matches[1] ($Matches[2].Replace("|", "`n") + "`n")
    return
  }

  if ($Step -match "^I run ``(.+)`` with framework statuses ``([\s\S]*)``$") {
    $Context.LastResult = Run-Cli $Context $Matches[1] "" $Matches[2]
    return
  }

  if ($Step -match "^I run ``(.+)``$") {
    $Context.LastResult = Run-Cli $Context $Matches[1] ""
    return
  }

  if ($Step -match "^I replace file ``(.+)`` with ``([\s\S]+)``$") {
    Set-Content -Path (Join-Path $Context.ProjectDir $Matches[1]) -Value ($Matches[2] + "`n") -NoNewline
    return
  }

  if ($Step -eq "the command should succeed") { Assert-LastResult $Context; Assert-Equal 0 $Context.LastResult.Status (Format-Result $Context.LastResult); return }
  if ($Step -eq "the command should fail") { Assert-LastResult $Context; if ($Context.LastResult.Status -eq 0) { throw "Expected command to fail.`n$(Format-Result $Context.LastResult)" }; return }

  if ($Step -match "^stdout should contain ``([\s\S]+)``$") { Assert-LastResult $Context; Assert-Contains $Context.LastResult.Stdout $Matches[1] (Format-Result $Context.LastResult); return }
  if ($Step -match "^stdout should not contain ``([\s\S]+)``$") { Assert-LastResult $Context; if ($Context.LastResult.Stdout.Contains($Matches[1])) { throw "$(Format-Result $Context.LastResult)`nUnexpected text: $($Matches[1])" }; return }
  if ($Step -match "^stderr should contain ``([\s\S]+)``$") { Assert-LastResult $Context; Assert-Contains $Context.LastResult.Stderr $Matches[1] (Format-Result $Context.LastResult); return }

  if ($Step -match "^file ``(.+)`` should exist$") { if (!(Test-Path -LiteralPath (Join-Path $Context.ProjectDir $Matches[1]) -PathType Leaf)) { throw "Expected file to exist: $($Matches[1])" }; return }
  if ($Step -match "^data file ``(.+)`` should exist$") { if (!(Test-Path -LiteralPath (Join-Path $Context.DataDir $Matches[1]) -PathType Leaf)) { throw "Expected data file to exist: $($Matches[1])" }; return }
  if ($Step -match "^file ``(.+)`` should not exist$") { if (Test-Path -LiteralPath (Join-Path $Context.ProjectDir $Matches[1]) -PathType Leaf) { throw "Expected file not to exist: $($Matches[1])" }; return }
  if ($Step -match "^file ``(.+)`` should contain ``([\s\S]+)``$") { Assert-Contains (Get-Content (Join-Path $Context.ProjectDir $Matches[1]) -Raw) $Matches[2] "File did not contain expected text."; return }

  if ($Step -match "^JSON file ``(.+)`` should contain item ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ItemId = $Matches[2]; if (!($Json.items | Where-Object { $_.id -eq $ItemId -or $_ -eq $ItemId })) { throw "Expected $($Matches[1]) to contain item $ItemId" }; return }
  if ($Step -match "^JSON file ``(.+)`` should not contain item ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ItemId = $Matches[2]; if ($Json.items | Where-Object { $_.id -eq $ItemId -or $_ -eq $ItemId }) { throw "Expected $($Matches[1]) not to contain item $ItemId" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain runtime ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Runtime = $Matches[2]; if (!($Json.runtimes | Where-Object { $_ -eq $Runtime })) { throw "Expected $($Matches[1]) to contain runtime $Runtime" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain generated file ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ExpectedPath = Normalize-FilePath $Matches[2]; if (!($Json.files | Where-Object { (Normalize-FilePath $_.path) -eq $ExpectedPath })) { throw "Expected $($Matches[1]) to contain generated file $($Matches[2])" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain framework ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Framework = $Matches[2]; if (!($Json.frameworks | Where-Object { $_.id -eq $Framework })) { throw "Expected $($Matches[1]) to contain framework $Framework" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain framework install attempt ``(.+)`` with status ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Runtime = $Matches[2]; $Status = $Matches[3]; if (!($Json.frameworkInstallAttempts | Where-Object { $_.runtime -eq $Runtime -and $_.status -eq $Status })) { throw "Expected $($Matches[1]) to contain framework install attempt $Runtime with status $Status" }; return }
  if ($Step -match "^text ``(.+)`` should appear before ``(.+)`` in file ``(.+)``$") { $Content = Get-Content (Join-Path $Context.ProjectDir $Matches[3]) -Raw; $First = $Content.IndexOf($Matches[1]); $Second = $Content.IndexOf($Matches[2]); if ($First -lt 0 -or $Second -lt 0 -or $First -ge $Second) { throw "Expected $($Matches[1]) to appear before $($Matches[2]) in $($Matches[3])" }; return }

  throw "Unsupported BDD step: $Step"
}

function Run-Cli {
  param($Context, [string] $Command, [string] $InputText, [string] $FrameworkStatuses = "")
  [string[]]$CliArgs = @(Split-Command $Command)
  $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $StartInfo.FileName = "node"
  $AllArgs = @("--no-warnings", $CliPath) + $CliArgs
  $StartInfo.Arguments = ($AllArgs | ForEach-Object { Quote-ProcessArg $_ }) -join " "
  $StartInfo.WorkingDirectory = $Context.ProjectDir
  $StartInfo.RedirectStandardInput = $true
  $StartInfo.RedirectStandardOutput = $true
  $StartInfo.RedirectStandardError = $true
  $StartInfo.UseShellExecute = $false
  $StartInfo.Environment["AOF_DATA_DIR"] = $Context.DataDir
  $StartInfo.Environment["NODE_NO_WARNINGS"] = "1"
  if ($InputText -ne "") {
    $InputLines = @($InputText.TrimEnd() -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
    if ($InputLines.Length -gt 0) { $StartInfo.Environment["AOF_TEST_SELECTION_INPUT"] = $InputLines[0] }
    if ($InputLines.Length -gt 1) { $StartInfo.Environment["AOF_TEST_RUNTIMES_INPUT"] = $InputLines[1] }
    if ($InputLines.Length -gt 2) { $StartInfo.Environment["AOF_TEST_CONFIRM_INPUT"] = ($InputLines[2..($InputLines.Length - 1)] -join ",") }
  }
  if ($FrameworkStatuses -ne "") { $StartInfo.Environment["AOF_TEST_FRAMEWORK_INSTALL_STATUS"] = $FrameworkStatuses }

  $Process = New-Object System.Diagnostics.Process
  $Process.StartInfo = $StartInfo
  [void]$Process.Start()
  $Process.StandardInput.Write($InputText)
  $Process.StandardInput.Close()
  $Stdout = $Process.StandardOutput.ReadToEnd()
  $Stderr = $Process.StandardError.ReadToEnd()
  $Process.WaitForExit()

  return [ordered]@{ Status = $Process.ExitCode; Stdout = $Stdout; Stderr = $Stderr }
}

function Write-AofProject {
  param($Context, [array] $ResourceInputs, [array] $Packages)
  $WorkspaceDir = Join-Path $Context.ProjectDir ".aof"
  New-Item -ItemType Directory -Path $WorkspaceDir -Force | Out-Null
  $Resources = @()
  foreach ($Input in $ResourceInputs) {
    $BodyPath = Join-Path $WorkspaceDir $Input.bodyPath
    New-Item -ItemType Directory -Path (Split-Path $BodyPath -Parent) -Force | Out-Null
    Set-Content -Path $BodyPath -Value ($Input.body + "`n") -NoNewline
    if ($Input.overridePath) {
      $OverridePath = Join-Path $WorkspaceDir $Input.overridePath
      New-Item -ItemType Directory -Path (Split-Path $OverridePath -Parent) -Force | Out-Null
      Set-Content -Path $OverridePath -Value ($Input.override | ConvertTo-Json -Depth 10)
    }
    $Resource = [ordered]@{ kind = $Input.kind; id = $Input.id; description = $Input.description; path = $Input.path; runtimes = if ($Input.runtimes) { $Input.runtimes } else { @("claude", "codex") } }
    if ($Input.paths) { $Resource.paths = $Input.paths }
    if ($Input.overridePath) { $Resource.overrides = @{ codex = $Input.overridePath } }
    $Resources += $Resource
  }
  $Config = [ordered]@{ '$schema' = "../schemas/aof.schema.json"; name = "file-backed"; resources = $Resources; packages = $Packages } | ConvertTo-Json -Depth 10
  Set-Content -Path (Join-Path $WorkspaceDir "aof.config.json") -Value $Config
}

function Read-ProjectJson { param($Context, [string] $PathValue) return Get-Content (Join-Path $Context.ProjectDir $PathValue) -Raw | ConvertFrom-Json }
function Normalize-FilePath { param([string] $PathValue) return $PathValue.Replace("\", "/") }
function Quote-ProcessArg { param([string] $Arg) if ($Arg -notmatch '[\s"]') { return $Arg }; return '"' + ($Arg -replace '\\(?=\\*")', '$0$0' -replace '"', '\"') + '"' }
function Split-Command { param([string] $Command) $Matches = [regex]::Matches($Command, '"[^"]+"|''[^'']+''|\S+'); $Args = New-Object System.Collections.ArrayList; foreach ($Match in $Matches) { [void]$Args.Add($Match.Value.Trim("'""")) }; return $Args }
function Assert-LastResult { param($Context) if ($null -eq $Context.LastResult) { throw "No command has been run in this scenario." } }
function Assert-Equal { param($Expected, $Actual, [string] $Message) if ($Expected -ne $Actual) { throw "$Message`nExpected: $Expected`nActual: $Actual" } }
function Assert-Contains { param([string] $Actual, [string] $Expected, [string] $Message) if (!$Actual.Contains($Expected)) { throw "$Message`nExpected text: $Expected`nActual text:`n$Actual" } }
function Format-Result { param($Result) return "status: $($Result.Status)`nstdout:`n$($Result.Stdout)`nstderr:`n$($Result.Stderr)" }

function Legacy-Config {
  return @"
{
  "name": "legacy",
  "resources": [
    { "kind": "skill", "id": "project-context", "description": "Context", "body": "Use project context." },
    { "kind": "command", "id": "prime", "description": "Prime", "body": "Map repository." },
    { "kind": "agent", "id": "code-reviewer", "description": "Review", "body": "Review diff." }
  ]
}
"@
}

$Failures = 0
$Feature = Parse-Feature $FeatureFile

foreach ($Scenario in $Feature.Scenarios) {
  $ScenarioName = "$($Feature.Name): $($Scenario.Name)"
  try {
    Run-Scenario $Scenario
    Write-Output "ok - $ScenarioName"
  } catch {
    $Failures += 1
    Write-Error "not ok - $ScenarioName`n$($_.Exception.Message)" -ErrorAction Continue
  }
}

if ($Failures -gt 0) { exit 1 }
