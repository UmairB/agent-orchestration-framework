@cli @adapter @scaffold @executable
Feature: the Notion CLI is a first-class managed tool — NOTION_DESCRIPTOR in the registry, resolvable, and provisioned on the npx lane
  In order that the Notion CLI is a version-pinned, doctor-surfaced managed tool the m12 registry owns, not a hand-installed binary
  NOTION_DESCRIPTOR joins TOOL_DESCRIPTORS as a provider:"npx" descriptor (packageSpec "ntn", version "0.17.0", binaries ["ntn"], a win32-x64 platform matrix) that descriptorFor resolves and provisioning plans on the npx lane,
  so that the registry knows the descriptor, descriptorFor("notion") returns it, its fields match the frozen ADR-004 shape, its platform matrix carries the x64-only / Node-22+ note, and provisioning targets the npx lane — NOT the version-keyed store.

  # ADR-004 (the m12 npx-lane tension, resolved as option ii): the Notion CLI is added as a frozen
  # m12 descriptor (12/ADR-002 shape) with provider:"npx" — so it is a first-class managed tool the
  # registry enumerates and the doctor surfaces, provisioned by the npx lane exactly as any node
  # framework today (12/ADR-002), NOT re-homed into the version-keyed ~/.aof/tools/<name>/<version>/
  # store. The frozen descriptor (ADR-004 / RESEARCH §A1):
  #   NOTION_DESCRIPTOR = { name:"notion", provider:"npx", packageSpec:"ntn", version:"0.17.0",
  #     binaries:["ntn"], platforms:{ win32:{ supported:true, prereqs:["node>=22","npm>=10"],
  #     note:"x64 only (no win32-arm64)" } } }
  # Hermetic: the registry / descriptorFor / the npx provisioning planner all run in-process with no
  # live install, so the whole feature is @executable (the verification tag is on the Feature line —
  # every scenario inherits it). The LIVE install of ntn is @manual in task 03.
  Background:
    Given the m12 tool registry loaded in-process

  # The descriptor is registered and resolvable through the registry door — descriptorFor("notion")
  # returns it, exactly as it does for the uv-lane tools. The registry, not a hand-rolled lookup, is
  # the source of truth for the descriptor.
  Scenario: NOTION_DESCRIPTOR is registered and resolves through descriptorFor
    When I list the registered tool descriptor names
    Then the names include "notion"
    And descriptorFor("notion") returns the NOTION_DESCRIPTOR

  # The descriptor's fields are the frozen ADR-004 shape: the npx provider, the ntn packageSpec, the
  # pinned 0.17.0 version, and the ntn binary. The m12 packageSpec ≠ binaries[0] rule does NOT bite
  # here (both are "ntn"), but the descriptor still declares both fields explicitly — the registry
  # never derives the binary name from the package spec.
  Scenario: the descriptor carries the frozen provider, package, version, and binary
    Given the registered "notion" descriptor
    Then its provider is "npx"
    And its packageSpec is "ntn"
    And its version is "0.17.0"
    And its binaries are exactly ["ntn"]

  # The platform matrix marks win32 supported with the x64-only / Node-22+ / npm-10+ note
  # (RESEARCH §A1) — the per-tool platforms? field 12/ADR-002 exists for. This is what the
  # tool-platform doctor check (task 03) reads to warn on an unsupported platform.
  Scenario: the descriptor's platform matrix marks win32 supported with the x64-only / Node-22+ note
    Given the registered "notion" descriptor
    Then its platform matrix marks "win32" supported
    And the win32 entry records the prerequisites node>=22 and npm>=10
    And the win32 entry notes x64-only (no win32-arm64)

  # provider:"npx" means the m12 NPX LANE plans the provision — the node-framework scope model
  # (planNpxProvision delegating to frameworks.mjs), NOT the version-keyed store. The npx-lane
  # decision (12/ADR-002) is HONOURED, not extended: provisioning the descriptor never targets a
  # ~/.aof/tools/notion/<version>/ store dir.
  Scenario: provisioning the descriptor plans the npx lane, not the version-keyed store
    Given the registered "notion" descriptor
    When provisioning plans the descriptor
    Then the plan uses the npx provider lane
    And the plan does not target a version-keyed store directory under the tool store root

  # The whole npx-vs-store provider routing, over each lane. The npx-lane (notion) descriptor plans
  # the framework lane and stays out of the store; a uv-lane descriptor (the existing graphify) plans
  # the store lane — the two lanes do not blur. This guards that adding NOTION_DESCRIPTOR did not
  # quietly route an npx tool into the store (the 12/ADR-002 boundary).
  Scenario Outline: a descriptor plans its own provider lane
    Given a registered "<tool>" descriptor with provider "<provider>"
    When provisioning plans the descriptor
    Then the plan uses the "<lane>" lane
    And the plan "<store-target>" a version-keyed store directory

    Examples:
      | tool     | provider | lane | store-target |
      | notion   | npx      | npx  | does not target |
      | graphify | uv       | uv   | targets        |
