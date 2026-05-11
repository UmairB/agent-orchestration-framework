$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$IntegrationDir = $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $IntegrationDir "..\..")
$CliPath = Join-Path $RepoRoot "bin\aof.mjs"
$FeaturesDir = Join-Path $IntegrationDir "features"
$StepsDir = Join-Path $IntegrationDir "steps"

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
  Write-Output "ok - PowerShell BDD integration skipped outside Windows"
  exit 0
}

. (Join-Path $StepsDir "lifecycle.steps.ps1")
. (Join-Path $StepsDir "dsl.steps.ps1")
. (Join-Path $StepsDir "packages.steps.ps1")
. (Join-Path $StepsDir "adapter-policy.steps.ps1")
. (Join-Path $StepsDir "setup-ui.steps.ps1")

function Get-FeatureFiles {
  if (Test-Path -LiteralPath $FeaturesDir -PathType Container) {
    $Files = @(Get-ChildItem -LiteralPath $FeaturesDir -Filter "*.feature" -File | Sort-Object Name | Select-Object -ExpandProperty FullName)
    if ($Files.Length -gt 0) { return $Files }
  }
  return @(Join-Path $IntegrationDir "cli.feature")
}

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
  param($FeatureFile, $Scenario)
  $Root = Join-Path ([System.IO.Path]::GetTempPath()) ("aof-bdd-" + [System.Guid]::NewGuid().ToString("N"))
  $Context = [ordered]@{ ProjectDir = Join-Path $Root "project"; DataDir = Join-Path $Root "data"; GlobalDir = Join-Path $Root "global-aof"; LastResult = $null; LastHttpResponse = $null; SetupUiProcess = $null; SetupUiUrl = $null }
  try {
    foreach ($Step in $Scenario.Steps) { Run-FeatureStep $Context $Step $FeatureFile }
  } finally {
    Stop-SetupUiServer $Context
    if (Test-Path $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
  }
}

function Run-FeatureStep {
  param($Context, [string] $Step, [string] $FeatureFile)
  $FeatureName = Split-Path $FeatureFile -Leaf
  switch ($FeatureName) {
    "adapter-policy.feature" { Run-AdapterPolicyStep $Context $Step; return }
    "dsl.feature" { Run-DslStep $Context $Step; return }
    "lifecycle.feature" { Run-LifecycleStep $Context $Step; return }
    "packages.feature" { Run-PackagesStep $Context $Step; return }
    "setup-ui.feature" { Run-SetupUiStep $Context $Step; return }
    "cli.feature" { Run-LifecycleStep $Context $Step; return }
    default { throw "No step module registered for $FeatureName." }
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
    $Result = Run-Cli $Context "init --codex" ""
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

  if ($Step -eq "a project with expanded .aof DSL config") {
    Run-Step $Context "an empty project"
    Write-ExpandedAofProject $Context
    return
  }

  if ($Step -eq "a project with adapter warning .aof config") {
    Run-Step $Context "an empty project"
    Write-AdapterWarningAofProject $Context
    return
  }

  if ($Step -eq "a project with .aof package config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "file-backed"; description = "File backed"; path = "assets/skills/file-backed/SKILL.md"; bodyPath = "assets/skills/file-backed/SKILL.md"; body = "File-backed body" }) @(@{ id = "gsd"; namespace = "gsd"; source = "npm:get-shit-done-cc@latest"; runtimes = @("codex") })
    return
  }

  if ($Step -eq "a project with multi-runtime .aof package config") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "file-backed"; description = "File backed"; path = "assets/skills/file-backed/SKILL.md"; bodyPath = "assets/skills/file-backed/SKILL.md"; body = "File-backed body" }) @(@{ id = "gsd"; namespace = "gsd"; source = "npm:get-shit-done-cc@latest"; runtimes = @("claude", "codex") })
    return
  }

  if ($Step -eq "a project with npm git and file package descriptors") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @() @(
      @{ id = "npm-pack"; namespace = "vendor"; source = @{ type = "npm"; package = "@vendor/npm-pack"; version = "latest" }; runtimes = @("codex") },
      @{ id = "git-pack"; namespace = "vendor"; source = @{ type = "git"; url = "https://example.test/vendor/git-pack.git"; ref = "v1" }; runtimes = @("codex") },
      @{ id = "file-pack"; namespace = "vendor"; source = @{ type = "file"; path = "../packs/file-pack" }; runtimes = @("codex"); dependencies = @(@{ id = "git-pack"; namespace = "vendor" }) }
    )
    return
  }

  if ($Step -eq "a project with package resource collision") {
    Run-Step $Context "an empty project"
    Write-AofProject $Context @(@{ kind = "skill"; id = "vendor-context"; description = "Local collision"; path = "assets/skills/vendor-context/SKILL.md"; bodyPath = "assets/skills/vendor-context/SKILL.md"; body = "Local body" }) @(@{ id = "assistant-pack"; namespace = "vendor"; source = "file:../packs/assistant-pack"; runtimes = @("codex"); resources = @(@{ kind = "skill"; id = "context"; body = "Package body" }) })
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

  if ($Step -eq "a project with referenced global assets") {
    Run-Step $Context "an empty project"
    Write-GlobalAofResource $Context @{ kind = "skill"; id = "shared-review"; description = "Shared reviewer"; body = "Global review body"; override = @{ body = "Codex global override body" } }
    Write-GlobalAofResource $Context @{ kind = "rule"; id = "team-standards"; description = "Team standards"; body = "Follow team standards" } $true
    Write-AofProject $Context @() @() @(@{ kind = "skill"; id = "shared-review" }, @{ kind = "rule"; id = "team-standards" })
    return
  }

  if ($Step -eq "a project with referenced global skill helper files") {
    Run-Step $Context "an empty project"
    Write-GlobalAofResource $Context @{ kind = "skill"; id = "research-helper"; description = "Research helper"; body = "Use the helper script."; files = @(@{ path = "search.py"; body = "print('search')`n" }) }
    Write-AofProject $Context @() @() @(@{ kind = "skill"; id = "research-helper" })
    return
  }

  if ($Step -eq "a project with unsafe global skill helper files") {
    Run-Step $Context "an empty project"
    Write-GlobalAofResource $Context @{ kind = "skill"; id = "unsafe-helper"; description = "Unsafe helper"; body = "Unsafe helper."; files = @(@{ path = "../escape.py"; body = "print('escape')`n" }) }
    Write-AofProject $Context @() @() @(@{ kind = "skill"; id = "unsafe-helper" })
    return
  }

  if ($Step -eq "a project with a missing global reference") {
    Run-Step $Context "an empty project"
    New-Item -ItemType Directory -Path $Context.GlobalDir -Force | Out-Null
    $GlobalConfig = @{ '$schema' = "https://aof.local/schemas/aof.schema.json"; name = "aof-global"; resources = @() } | ConvertTo-Json -Depth 10
    Set-Content -Path (Join-Path $Context.GlobalDir "aof.config.json") -Value $GlobalConfig
    Write-AofProject $Context @() @() @(@{ kind = "skill"; id = "missing-shared" })
    return
  }

  if ($Step -eq "a project with a local and global asset conflict") {
    Run-Step $Context "an empty project"
    Write-GlobalAofResource $Context @{ kind = "skill"; id = "shared-review"; description = "Shared reviewer"; body = "Global review body" }
    Write-AofProject $Context @(@{ kind = "skill"; id = "shared-review"; description = "Local reviewer"; path = "assets/skills/shared-review/SKILL.md"; bodyPath = "assets/skills/shared-review/SKILL.md"; body = "Local review body" }) @() @(@{ kind = "skill"; id = "shared-review" })
    return
  }

  if ($Step -eq "a malformed global AOF config") {
    Run-Step $Context "an empty project"
    New-Item -ItemType Directory -Path $Context.GlobalDir -Force | Out-Null
    Set-Content -Path (Join-Path $Context.GlobalDir "aof.config.json") -Value "{ bad`n" -NoNewline
    return
  }

  if ($Step -eq "the .aof config has no resources") {
    $Config = @{ '$schema' = "../schemas/aof.schema.json"; name = "empty"; resources = @() } | ConvertTo-Json -Depth 10
    Set-Content -Path (Join-Path $Context.ProjectDir ".aof\aof.config.json") -Value $Config
    return
  }

  if ($Step -eq "a running setup UI server") {
    Start-SetupUiServer $Context
    return
  }

  if ($Step -eq "I request setup UI capabilities") {
    Invoke-SetupUiJson $Context "GET" "/api/capabilities"
    return
  }

  if ($Step -eq "I save command resource ``prime`` through the setup UI API") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/resources/command/prime" @{
      id = "prime"
      kind = "command"
      description = "Prime repository context"
      body = "Inspect the repository."
      runtimes = @("codex")
      overrides = @{}
    }
    return
  }

  if ($Step -eq "I save expanded sections through the setup UI API") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/sections" @{
      mcpServers = @(@{ id = "docs"; transport = "http"; url = "https://example.test/mcp"; runtimes = @("codex") })
      hooks = @(@{ id = "test-after-write"; event = "PostToolUse"; command = "npm test"; runtimes = @("codex") })
      projectDocs = @(@{ id = "root"; body = "Guidance"; targets = @("AGENTS.md"); runtimes = @("codex") })
      settings = @{ codex = @{ approval_policy = "on-request" } }
    }
    return
  }

  if ($Step -eq "I save invalid expanded sections through the setup UI API") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/sections" @{ settings = "bad" }
    return
  }

  if ($Step -eq "I PUT malformed JSON to ``/api/config/resources/command/prime``") {
    Invoke-SetupUiRaw $Context "PUT" "/api/config/resources/command/prime" "{ bad"
    return
  }

  if ($Step -eq "I save a mismatched resource through the setup UI API") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/resources/command/prime" @{ id = "other"; kind = "command"; body = "Body"; runtimes = @("codex") }
    return
  }

  if ($Step -eq "I save an unsupported resource kind through the setup UI API") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/resources/unknown/prime" @{ id = "prime"; kind = "unknown"; body = "Body"; runtimes = @("codex") }
    return
  }

  if ($Step -eq "I save adapter warning sections through the setup UI API") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/sections" @{
      hooks = @(@{ id = "notify"; event = "PostToolUse"; command = "npm test"; timeout = 30; runtimes = @("codex") })
    }
    return
  }

  if ($Step -eq "I request setup UI config") {
    Invoke-SetupUiJson $Context "GET" "/api/config"
    return
  }

  if ($Step -eq "I request setup UI project config") {
    Invoke-SetupUiJson $Context "GET" "/api/config/project"
    return
  }

  if ($Step -eq "I request setup UI global config") {
    Invoke-SetupUiJson $Context "GET" "/api/config/global"
    return
  }

  if ($Step -match "^I save global skill ``(.+)`` through the setup UI API$") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/global/resources/skill/$($Matches[1])" @{
      id = $Matches[1]
      kind = "skill"
      description = "Global skill"
      body = "Use the helper script."
      runtimes = @("codex")
      overrides = @{}
    }
    return
  }

  if ($Step -match "^I save global rule ``(.+)`` through the setup UI API$") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/global/resources/rule/$($Matches[1])" @{
      id = $Matches[1]
      kind = "rule"
      description = "Global rule"
      body = "Follow team standards."
      runtimes = @("codex")
      overrides = @{}
    }
    return
  }

  if ($Step -match "^I save global skill ``(.+)`` with helper file through the setup UI API$") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/global/resources/skill/$($Matches[1])" @{
      id = $Matches[1]
      kind = "skill"
      description = "Global skill with helper"
      body = "Use the helper script."
      runtimes = @("codex")
      files = @(@{ path = "search.py"; body = "print('search')`n" })
      overrides = @{}
    }
    return
  }

  if ($Step -match "^I save global skill ``(.+)`` with unsafe helper file through the setup UI API$") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/global/resources/skill/$($Matches[1])" @{
      id = $Matches[1]
      kind = "skill"
      body = "Unsafe helper."
      runtimes = @("codex")
      files = @(@{ path = "../escape.py"; body = "bad" })
      overrides = @{}
    }
    return
  }

  if ($Step -match "^I add global skill ``(.+)`` to the project through the setup UI API$") {
    Invoke-SetupUiJson $Context "PUT" "/api/config/project/global-refs/skill/$($Matches[1])"
    return
  }

  if ($Step -match "^I remove global skill ``(.+)`` from the project through the setup UI API$") {
    Invoke-SetupUiJson $Context "DELETE" "/api/config/project/global-refs/skill/$($Matches[1])"
    return
  }

  if ($Step -match "^I run ``(.+)`` with input ``([\s\S]*)`` and resource input ``([\s\S]*)``$") {
    $Context.LastResult = Run-Cli $Context $Matches[1] ($Matches[2].Replace("|", "`n") + "`n") "" $Matches[3]
    return
  }

  if ($Step -match "^I run ``(.+)`` with input ``([\s\S]*)``$") {
    $Context.LastResult = Run-Cli $Context $Matches[1] ($Matches[2].Replace("|", "`n") + "`n")
    return
  }

  if ($Step -match "^I run ``(.+)`` with resource input ``([\s\S]*)``$") {
    $Context.LastResult = Run-Cli $Context $Matches[1] "" "" $Matches[2]
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
  if ($Step -match "^data file ``(.+)`` should not exist$") { if (Test-Path -LiteralPath (Join-Path $Context.DataDir $Matches[1]) -PathType Leaf) { throw "Expected data file not to exist: $($Matches[1])" }; return }
  if ($Step -match "^file ``(.+)`` should not exist$") { if (Test-Path -LiteralPath (Join-Path $Context.ProjectDir $Matches[1]) -PathType Leaf) { throw "Expected file not to exist: $($Matches[1])" }; return }
  if ($Step -match "^file ``(.+)`` should contain ``([\s\S]+)``$") { Assert-Contains (Get-Content (Join-Path $Context.ProjectDir $Matches[1]) -Raw) $Matches[2] "File did not contain expected text."; return }
  if ($Step -match "^file ``(.+)`` should not contain ``([\s\S]+)``$") { $Text = Get-Content (Join-Path $Context.ProjectDir $Matches[1]) -Raw; if ($Text.Contains($Matches[2])) { throw "Expected file $($Matches[1]) not to contain $($Matches[2])" }; return }

  if ($Step -match "^HTTP response status should be (\d+)$") { Assert-LastHttpResponse $Context; Assert-Equal ([int]$Matches[1]) $Context.LastHttpResponse.Status $Context.LastHttpResponse.Text; return }
  if ($Step -match "^HTTP response field ``(.+)`` should equal ``(.+)``$") { Assert-LastHttpResponse $Context; $Actual = Get-ValueAtPath $Context.LastHttpResponse.Json $Matches[1]; $Expected = Convert-ExpectedValue $Matches[2]; Assert-Equal $Expected $Actual $Context.LastHttpResponse.Text; return }
  if ($Step -match "^HTTP response diagnostics should include path ``(.+)``$") {
    Assert-LastHttpResponse $Context
    $Diagnostics = @($Context.LastHttpResponse.Json.diagnostics)
    if ($Diagnostics.Length -eq 0 -and $null -ne $Context.LastHttpResponse.Json.config) { $Diagnostics = @($Context.LastHttpResponse.Json.config.diagnostics) }
    $ExpectedPath = $Matches[1]
    if (!($Diagnostics | Where-Object { $_.path -eq $ExpectedPath })) { throw "Expected diagnostics to include $ExpectedPath" }
    return
  }
  if ($Step -match "^HTTP response diagnostics should include code ``(.+)``$") {
    Assert-LastHttpResponse $Context
    $Diagnostics = @($Context.LastHttpResponse.Json.diagnostics)
    if ($Diagnostics.Length -eq 0 -and $null -ne $Context.LastHttpResponse.Json.config) { $Diagnostics = @($Context.LastHttpResponse.Json.config.diagnostics) }
    $ExpectedCode = $Matches[1]
    if (!($Diagnostics | Where-Object { $_.code -eq $ExpectedCode })) { throw "Expected diagnostics to include code $ExpectedCode" }
    return
  }

  if ($Step -match "^JSON file ``(.+)`` should contain item ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ItemId = $Matches[2]; if (!($Json.items | Where-Object { $_.id -eq $ItemId -or $_ -eq $ItemId })) { throw "Expected $($Matches[1]) to contain item $ItemId" }; return }
  if ($Step -match "^JSON file ``(.+)`` should not contain item ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ItemId = $Matches[2]; if ($Json.items | Where-Object { $_.id -eq $ItemId -or $_ -eq $ItemId }) { throw "Expected $($Matches[1]) not to contain item $ItemId" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain runtime ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Runtime = $Matches[2]; if (!($Json.runtimes | Where-Object { $_ -eq $Runtime })) { throw "Expected $($Matches[1]) to contain runtime $Runtime" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain generated file ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ExpectedPath = Normalize-FilePath $Matches[2]; if (!($Json.files | Where-Object { (Normalize-FilePath $_.path) -eq $ExpectedPath })) { throw "Expected $($Matches[1]) to contain generated file $($Matches[2])" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain global resource ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ResourceId = $Matches[2]; if (!($Json.files | Where-Object { $_.resource.scope -eq "global" -and $_.resource.id -eq $ResourceId })) { throw "Expected $($Matches[1]) to contain global resource $ResourceId" }; return }
  if ($Step -match "^JSON file ``(.+)`` should not contain generated file ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $ExpectedPath = Normalize-FilePath $Matches[2]; if ($Json.files | Where-Object { (Normalize-FilePath $_.path) -eq $ExpectedPath }) { throw "Expected $($Matches[1]) not to contain generated file $($Matches[2])" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain framework ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Framework = $Matches[2]; if (!($Json.frameworks | Where-Object { $_.id -eq $Framework })) { throw "Expected $($Matches[1]) to contain framework $Framework" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain package ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Package = $Matches[2]; if (!($Json.packages | Where-Object { $_.id -eq $Package })) { throw "Expected $($Matches[1]) to contain package $Package" }; return }
  if ($Step -match "^JSON file ``(.+)`` package ``(.+)`` should record dependency ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Package = $Matches[2]; $Dependency = $Matches[3]; $Pkg = $Json.packages | Where-Object { $_.id -eq $Package } | Select-Object -First 1; if ($null -eq $Pkg) { throw "Expected $($Matches[1]) to contain package $Package" }; if (!($Pkg.dependencies | Where-Object { $_ -eq $Dependency -or $_.id -eq $Dependency })) { throw "Expected package $Package to record dependency $Dependency" }; return }
  if ($Step -match "^JSON file ``(.+)`` package ``(.+)`` should have resolution status ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Package = $Matches[2]; $Status = $Matches[3]; $Pkg = $Json.packages | Where-Object { $_.id -eq $Package } | Select-Object -First 1; if ($null -eq $Pkg) { throw "Expected $($Matches[1]) to contain package $Package" }; Assert-Equal $Status $Pkg.resolution.status "Expected package $Package resolution status $Status"; return }
  if ($Step -match "^JSON file ``(.+)`` should not contain adapter warning ``(.+)``$") { $Text = Get-Content (Join-Path $Context.ProjectDir $Matches[1]) -Raw; if ($Text.Contains($Matches[2])) { throw "Expected $($Matches[1]) not to contain adapter warning $($Matches[2])" }; return }
  if ($Step -match "^JSON file ``(.+)`` should contain framework install attempt ``(.+)`` with status ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Runtime = $Matches[2]; $Status = $Matches[3]; if (!($Json.frameworkInstallAttempts | Where-Object { $_.runtime -eq $Runtime -and $_.status -eq $Status })) { throw "Expected $($Matches[1]) to contain framework install attempt $Runtime with status $Status" }; return }
  if ($Step -match "^JSON file ``(.+)`` should not contain framework install attempt ``(.+)``$") { $Json = Read-ProjectJson $Context $Matches[1]; $Runtime = $Matches[2]; if ($Json.frameworkInstallAttempts | Where-Object { $_.runtime -eq $Runtime }) { throw "Expected $($Matches[1]) not to contain framework install attempt $Runtime" }; return }
  if ($Step -match "^text ``(.+)`` should appear before ``(.+)`` in file ``(.+)``$") { $Content = Get-Content (Join-Path $Context.ProjectDir $Matches[3]) -Raw; $First = $Content.IndexOf($Matches[1]); $Second = $Content.IndexOf($Matches[2]); if ($First -lt 0 -or $Second -lt 0 -or $First -ge $Second) { throw "Expected $($Matches[1]) to appear before $($Matches[2]) in $($Matches[3])" }; return }
  if ($Step -match "^text ``(.+)`` should appear before ``(.+)`` in stdout$") { Assert-LastResult $Context; $First = $Context.LastResult.Stdout.IndexOf($Matches[1]); $Second = $Context.LastResult.Stdout.IndexOf($Matches[2]); if ($First -lt 0 -or $Second -lt 0 -or $First -ge $Second) { throw "Expected $($Matches[1]) to appear before $($Matches[2]) in stdout" }; return }

  if ($Step -match "^global file ``(.+)`` should exist$") { if (!(Test-Path -LiteralPath (Join-Path $Context.GlobalDir $Matches[1]) -PathType Leaf)) { throw "Expected global file to exist: $($Matches[1])" }; return }
  if ($Step -match "^global file ``(.+)`` should contain ``([\s\S]+)``$") { Assert-Contains (Get-Content (Join-Path $Context.GlobalDir $Matches[1]) -Raw) $Matches[2] "Global file did not contain expected text."; return }

  throw "Unsupported BDD step: $Step"
}

function Run-Cli {
  param($Context, [string] $Command, [string] $InputText, [string] $FrameworkStatuses = "", [string] $ResourceInput = "")
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
  $StartInfo.Environment["AOF_GLOBAL_HOME"] = $Context.GlobalDir
  $StartInfo.Environment["NODE_NO_WARNINGS"] = "1"
  if ($InputText -ne "") {
    $InputLines = @($InputText.TrimEnd() -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
    if ($InputLines.Length -gt 0) { $StartInfo.Environment["AOF_TEST_SELECTION_INPUT"] = $InputLines[0] }
    if ($InputLines.Length -gt 1) { $StartInfo.Environment["AOF_TEST_RUNTIMES_INPUT"] = $InputLines[1] }
    if ($InputLines.Length -gt 2) { $StartInfo.Environment["AOF_TEST_CONFIRM_INPUT"] = ($InputLines[2..($InputLines.Length - 1)] -join ",") }
  }
  if ($ResourceInput -ne "") { $StartInfo.Environment["AOF_TEST_RESOURCE_INPUT"] = $ResourceInput }
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
  param($Context, [array] $ResourceInputs, [array] $Packages, [array] $GlobalRefs = @())
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
  $Config = [ordered]@{ '$schema' = "../schemas/aof.schema.json"; name = "file-backed"; resources = $Resources; globalRefs = $GlobalRefs; packages = $Packages } | ConvertTo-Json -Depth 10
  Set-Content -Path (Join-Path $WorkspaceDir "aof.config.json") -Value $Config
}

function Write-GlobalAofResource {
  param($Context, $ResourceInput, [bool] $Append = $false)
  $Plural = if ($ResourceInput.kind -eq "skill") { "skills" } elseif ($ResourceInput.kind -eq "command") { "commands" } elseif ($ResourceInput.kind -eq "agent") { "agents" } else { "rules" }
  $BodyFile = if ($ResourceInput.kind -eq "skill") { "SKILL.md" } elseif ($ResourceInput.kind -eq "command") { "COMMAND.md" } elseif ($ResourceInput.kind -eq "agent") { "AGENT.md" } else { "RULE.md" }
  $ResourcePath = "assets/$Plural/$($ResourceInput.id)/$BodyFile"
  $ResourceDir = Join-Path $Context.GlobalDir "assets\$Plural\$($ResourceInput.id)"
  New-Item -ItemType Directory -Path $ResourceDir -Force | Out-Null
  Set-Content -Path (Join-Path $ResourceDir $BodyFile) -Value ($ResourceInput.body + "`n") -NoNewline

  $Resource = [ordered]@{ kind = $ResourceInput.kind; id = $ResourceInput.id; description = $ResourceInput.description; path = $ResourcePath; runtimes = @("claude", "codex") }
  if ($ResourceInput.override) {
    $OverridePath = "assets/$Plural/$($ResourceInput.id)/overrides/codex.json"
    New-Item -ItemType Directory -Path (Join-Path $ResourceDir "overrides") -Force | Out-Null
    Set-Content -Path (Join-Path $Context.GlobalDir $OverridePath) -Value ($ResourceInput.override | ConvertTo-Json -Depth 10)
    $Resource.overrides = @{ codex = $OverridePath }
  }
  if ($ResourceInput.files) {
    $FileRefs = @()
    foreach ($File in $ResourceInput.files) {
      $AssociatedPath = Join-Path (Join-Path $ResourceDir "files") $File.path
      New-Item -ItemType Directory -Path (Split-Path $AssociatedPath -Parent) -Force | Out-Null
      $FileBody = if ($null -eq $File.body) { "" } else { $File.body }
      Set-Content -Path $AssociatedPath -Value $FileBody -NoNewline
      $FileRefs += $File.path
    }
    $Resource.files = $FileRefs
  }

  $Resources = @()
  $ConfigPath = Join-Path $Context.GlobalDir "aof.config.json"
  if ($Append -and (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    $Resources = @((Get-Content $ConfigPath -Raw | ConvertFrom-Json).resources)
  }
  $Resources += $Resource
  New-Item -ItemType Directory -Path $Context.GlobalDir -Force | Out-Null
  $Config = @{ '$schema' = "https://aof.local/schemas/aof.schema.json"; name = "aof-global"; resources = $Resources } | ConvertTo-Json -Depth 10
  Set-Content -Path $ConfigPath -Value $Config
}

function Write-ExpandedAofProject {
  param($Context)
  $WorkspaceDir = Join-Path $Context.ProjectDir ".aof"
  $DocsDir = Join-Path $WorkspaceDir "assets\docs\partials"
  New-Item -ItemType Directory -Path $DocsDir -Force | Out-Null
  Set-Content -Path (Join-Path $WorkspaceDir "assets\docs\root.md") -Value "Root guidance`n{{include partials/shared.md}}`n" -NoNewline
  Set-Content -Path (Join-Path $DocsDir "shared.md") -Value "Included guidance`n" -NoNewline
  $Config = [ordered]@{
    '$schema' = "../schemas/aof.schema.json"
    name = "expanded"
    resources = @()
    mcpServers = @(@{ id = "docs"; transport = "http"; url = "https://example.test/mcp" })
    hooks = @(@{ id = "test-after-write"; event = "PostToolUse"; matcher = "Write"; command = "npm test" })
    projectDocs = @(@{ id = "root"; path = "assets/docs/root.md"; targets = @("AGENTS.md", "CLAUDE.md") })
    settings = @{ claude = @{ permissions = @{ allow = @("Bash(npm test)") } }; codex = @{ model = "gpt-5.4"; approval_policy = "on-request" } }
  } | ConvertTo-Json -Depth 10
  Set-Content -Path (Join-Path $WorkspaceDir "aof.config.json") -Value $Config
}

function Write-AdapterWarningAofProject {
  param($Context)
  $WorkspaceDir = Join-Path $Context.ProjectDir ".aof"
  $SkillDir = Join-Path $WorkspaceDir "assets\skills\file-backed"
  New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
  Set-Content -Path (Join-Path $SkillDir "SKILL.md") -Value "File-backed body`n" -NoNewline
  $Config = [ordered]@{
    '$schema' = "../schemas/aof.schema.json"
    name = "adapter-warning"
    resources = @(@{ kind = "skill"; id = "file-backed"; path = "assets/skills/file-backed/SKILL.md"; runtimes = @("codex") })
    hooks = @(@{ id = "notify"; event = "PostToolUse"; command = "npm test"; timeout = 30; runtimes = @("codex") })
  } | ConvertTo-Json -Depth 10
  Set-Content -Path (Join-Path $WorkspaceDir "aof.config.json") -Value $Config
}

function Start-SetupUiServer {
  param($Context)
  if ($null -ne $Context.SetupUiProcess) { return }
  New-Item -ItemType Directory -Path $Context.ProjectDir -Force | Out-Null
  $Script = @"
import { serveSetupUi } from './src/setup-ui.mjs';
const projectDir = process.argv[1];
const globalDir = process.argv[2];
const savedItems = [];
const catalog = { listItems: () => savedItems, upsertItem: (item) => savedItems.push(item) };
const { server, url } = await serveSetupUi(catalog, { port: 0, projectDir, env: { AOF_GLOBAL_HOME: globalDir } });
console.log(url);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
setInterval(() => {}, 1000);
"@
  $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $StartInfo.FileName = "node"
  $StartInfo.WorkingDirectory = $RepoRoot
  $StartInfo.RedirectStandardOutput = $true
  $StartInfo.RedirectStandardError = $true
  $StartInfo.UseShellExecute = $false
  $StartInfo.Environment["AOF_GLOBAL_HOME"] = $Context.GlobalDir
  $StartInfo.Arguments = (@("--input-type=module", "-e", $Script, $Context.ProjectDir, $Context.GlobalDir) | ForEach-Object { Quote-ProcessArg $_ }) -join " "
  $Process = New-Object System.Diagnostics.Process
  $Process.StartInfo = $StartInfo
  [void]$Process.Start()
  $Context.SetupUiUrl = $Process.StandardOutput.ReadLine()
  $Context.SetupUiProcess = $Process
  if ([string]::IsNullOrWhiteSpace($Context.SetupUiUrl)) {
    $ErrorText = $Process.StandardError.ReadToEnd()
    throw "Setup UI server did not start.`n$ErrorText"
  }
}

function Stop-SetupUiServer {
  param($Context)
  if ($null -eq $Context.SetupUiProcess) { return }
  if (-not $Context.SetupUiProcess.HasExited) {
    $Context.SetupUiProcess.Kill()
    $Context.SetupUiProcess.WaitForExit()
  }
  $Context.SetupUiProcess = $null
  $Context.SetupUiUrl = $null
}

function Invoke-SetupUiJson {
  param($Context, [string] $Method, [string] $Route, $Body)
  $BodyText = if ($null -eq $Body) { $null } else { $Body | ConvertTo-Json -Depth 20 }
  Invoke-SetupUiRaw $Context $Method $Route $BodyText
}

function Invoke-SetupUiRaw {
  param($Context, [string] $Method, [string] $Route, [string] $BodyText)
  if ([string]::IsNullOrWhiteSpace($Context.SetupUiUrl)) { throw "Setup UI server has not been started." }
  [void][System.Reflection.Assembly]::LoadWithPartialName("System.Net.Http")
  $Client = New-Object System.Net.Http.HttpClient
  try {
    $Uri = [System.Uri]::new([System.Uri]$Context.SetupUiUrl, $Route.TrimStart("/"))
    $HttpMethod = [System.Net.Http.HttpMethod]::new($Method)
    $Request = New-Object System.Net.Http.HttpRequestMessage($HttpMethod, $Uri)
    if (!([string]::IsNullOrEmpty($BodyText) -and $Method -eq "GET")) {
      $Request.Content = New-Object System.Net.Http.StringContent($BodyText, [System.Text.Encoding]::UTF8, "application/json")
    }
    $Response = $Client.SendAsync($Request).GetAwaiter().GetResult()
    $Text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $Json = $null
    if (-not [string]::IsNullOrWhiteSpace($Text)) {
      try { $Json = $Text | ConvertFrom-Json } catch { $Json = $null }
    }
    $Context.LastHttpResponse = [ordered]@{ Status = [int]$Response.StatusCode; Text = $Text; Json = $Json }
  } finally {
    $Client.Dispose()
  }
}

function Read-ProjectJson { param($Context, [string] $PathValue) return Get-Content (Join-Path $Context.ProjectDir $PathValue) -Raw | ConvertFrom-Json }
function Normalize-FilePath { param([string] $PathValue) return $PathValue.Replace("\", "/") }
function Quote-ProcessArg { param([string] $Arg) if ($Arg -notmatch '[\s"]') { return $Arg }; return '"' + ($Arg -replace '\\(?=\\*")', '$0$0' -replace '"', '\"') + '"' }
function Split-Command { param([string] $Command) $Matches = [regex]::Matches($Command, '"[^"]+"|''[^'']+''|\S+'); $Args = New-Object System.Collections.ArrayList; foreach ($Match in $Matches) { [void]$Args.Add($Match.Value.Trim("'""")) }; return $Args }
function Assert-LastResult { param($Context) if ($null -eq $Context.LastResult) { throw "No command has been run in this scenario." } }
function Assert-LastHttpResponse { param($Context) if ($null -eq $Context.LastHttpResponse) { throw "No HTTP response has been captured in this scenario." } }
function Assert-Equal { param($Expected, $Actual, [string] $Message) if ($Expected -ne $Actual) { throw "$Message`nExpected: $Expected`nActual: $Actual" } }
function Assert-Contains { param([string] $Actual, [string] $Expected, [string] $Message) if (!$Actual.Contains($Expected)) { throw "$Message`nExpected text: $Expected`nActual text:`n$Actual" } }
function Format-Result { param($Result) return "status: $($Result.Status)`nstdout:`n$($Result.Stdout)`nstderr:`n$($Result.Stderr)" }

function Get-ValueAtPath {
  param($Value, [string] $PathExpression)
  $Current = $Value
  foreach ($Segment in $PathExpression.Split(".")) {
    if ($null -eq $Current) { return $null }
    if ($Segment -match "^\d+$") {
      $Current = @($Current)[$([int]$Segment)]
    } elseif ($Segment -eq "length" -and $Current -is [array]) {
      $Current = @($Current).Length
    } else {
      $Current = $Current.$Segment
    }
  }
  return $Current
}

function Convert-ExpectedValue {
  param([string] $Value)
  if ($Value -eq "true") { return $true }
  if ($Value -eq "false") { return $false }
  if ($Value -eq "null") { return $null }
  if ($Value -match "^-?\d+(\.\d+)?$") { return [double]$Value }
  return $Value
}

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
foreach ($FeatureFile in Get-FeatureFiles) {
  $Feature = Parse-Feature $FeatureFile

  foreach ($Scenario in $Feature.Scenarios) {
    $ScenarioName = "$($Feature.Name): $($Scenario.Name)"
    try {
      Run-Scenario $FeatureFile $Scenario
      Write-Output "ok - $ScenarioName"
    } catch {
      $Failures += 1
      Write-Error "not ok - $ScenarioName`n$($_.Exception.Message)" -ErrorAction Continue
    }
  }
}

if ($Failures -gt 0) { exit 1 }
