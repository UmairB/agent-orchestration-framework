@cli @adapter @scaffold @executable
Feature: The tool store derives from the aof global home and resolves managed binaries store-first then PATH
  In order that aof owns a relocatable, version-pinned dependency store where a managed install wins over a stray global
  the store path helpers derive from defaultGlobalWorkspaceDir and resolveManagedBinary checks the store before any PATH walk,
  so that AOF_GLOBAL_HOME relocates the whole store, a pinned store copy is preferred, and an unprovisioned tool still resolves a global binary.

  # ADR-001: src/paths.mjs gains toolStoreRoot/toolVersionDir (PURE geometry off
  # defaultGlobalWorkspaceDir — AOF_GLOBAL_HOME-relocatable, NO homedir/".aof" literal);
  # src/tool-store.mjs owns resolveManagedBinary (store-first, PATH-fallback), the
  # cross-platform exe rule (win32 Scripts/.exe, POSIX bin/), and the package→binary
  # map. The resolver is hermetic via injected seams (env/platform/pathValue/useLocator/
  # probe). The "store binary STRUCTURALLY wins over PATH" and "root has no homedir/.aof
  # literal" facts are fitness functions (ADR-005 inv. 1 / inv. 2) — here we assert only
  # the OBSERVABLE resolution outcome (which copy is returned, where the path points).
  Background:
    Given the tool-store module loaded in-process with injectable env/platform/path seams

  # The store root + a tool's version dir derive from the global home, and relocate
  # when AOF_GLOBAL_HOME is set. Rows: unset (the default home), a POSIX override, and
  # a Windows-style absolute override — the relocation is observable in every case.
  Scenario Outline: the store root derives from the global home and relocates under AOF_GLOBAL_HOME
    When I compute toolStoreRoot with AOF_GLOBAL_HOME "<home>"
    Then the store root is "<root>"
    And toolVersionDir for "graphify" "0.8.44" is "<root>/graphify/0.8.44"

    Examples:
      | home                  | root                      |
      | (unset)               | <defaultGlobalHome>/tools |
      | /tmp/aof-home         | /tmp/aof-home/tools       |
      | D:\aof-store          | D:\aof-store/tools        |

  # The exe path is platform-shaped: Scripts/<bin>.exe on Windows, bin/<bin> on POSIX
  # (darwin shares the POSIX shape). The package→binary map is exercised by resolving
  # graphify's SECOND binary (graphify-mcp) — the install spec ≠ the binary name.
  Scenario Outline: the managed binary path is platform-shaped under the version dir
    When I resolve the exe path for binary "<binary>" version "0.8.44" on platform "<platform>"
    Then the path ends with "<tail>"

    Examples:
      | binary       | platform | tail                                     |
      | graphify     | win32    | graphify/0.8.44/Scripts/graphify.exe     |
      | graphify     | linux    | graphify/0.8.44/bin/graphify             |
      | graphify     | darwin   | graphify/0.8.44/bin/graphify             |
      | graphify-mcp | win32    | graphify/0.8.44/Scripts/graphify-mcp.exe |
      | graphify-mcp | linux    | graphify/0.8.44/bin/graphify-mcp         |

  # A store hit AND a PATH hit are both available → the store copy is the one resolved.
  Scenario: resolveManagedBinary prefers the store copy over a PATH copy
    Given a managed "graphify" present BOTH in the store and on PATH
    When I resolve the managed "graphify" binary
    Then the result source is "store"
    And the resolved path is under the tool store, not the PATH location

  # No store copy, but a PATH copy → falls back to PATH (the 06/09 behaviour, preserved).
  Scenario: resolveManagedBinary falls back to PATH when the store has no copy
    Given a managed "graphify" present ONLY on PATH
    When I resolve the managed "graphify" binary
    Then the result source is "path"
    And it resolves the PATH location

  # Absent from both → a structured miss carrying the install hint, never a thrown ENOENT.
  Scenario: a total miss is a structured result with an install hint, not a throw
    Given a managed "graphify" present in neither the store nor PATH
    When I resolve the managed "graphify" binary
    Then it returns found false with an install hint
    And it does not throw

  # The version probe is honest: a clean `<bin> --version` reports the version; a probe
  # that fails or returns nothing degrades to a null version — the result is still a
  # found hit, never a throw (RESEARCH §A4 — the live probe is unconfirmed for some tools,
  # so the no-throw degrade is the contract the resolver must hold in-process).
  Scenario Outline: a store hit degrades the version cleanly when the probe is unreliable
    Given a managed "graphify" present in the store with a "<probe>" version probe
    When I resolve the managed "graphify" binary
    Then the result source is "store"
    And the reported version is "<version>"
    And it does not throw

    Examples:
      | probe              | version             |
      | clean (0.8.44)     | 0.8.44              |
      | failing (non-zero) | null                |
      | empty output       | null                |
