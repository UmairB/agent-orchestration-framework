@cli @work @distribution @executable
Feature: A node derives a stable, human-readable id and assembles its capability descriptor
  In order to let work later be routed by what a node can run, with no central id allocator (there is no server)
  each install derives a deterministic, stable node id and assembles a capability descriptor carrying its host, OS, runtimes, and installed skills,
  so that a node advertises who it is and what it can do as a derived, rebuildable record — stable across publishes so peers track a node, not a churn of ids.

  # ARCHITECTURE ADR-003: src/node-identity.mjs derives the id + assembles the descriptor.
  # The id is a DOCUMENTED-DEFAULT derivation (sanitized hostname, persisted to mesh.nodeId,
  # collision -> hash suffix); the descriptor is the frozen, additive-friendly schema. This
  # feature asserts the DERIVATION + the COMPLETE schema; persisting it is story 00's store,
  # publishing/reading it is task 01's commands. The descriptor is a projection of config +
  # environment (rebuildable) — it holds no absolute paths.
  Background:
    Given an initialised aof project whose config I control
    And the node-identity mechanic loaded in-process from src/node-identity.mjs

  # Derivation sanitizes the raw hostname to a path-safe, human-readable form: lowercased,
  # every run of non-[a-z0-9-] characters collapsed to a single "-", with leading/trailing
  # separators trimmed. This matrix pins the SANITIZATION equivalence classes + boundaries the
  # ADR-003 default prescribes:
  #   - already-clean (idempotent), mixed case (lowercased),
  #   - spaces / dots / underscores / other punctuation -> "-",
  #   - a RUN of illegal chars collapses to ONE "-" (not one per char),
  #   - leading / trailing illegal chars trimmed (no edge "-"),
  #   - digits and hyphens preserved.
  # NOTE: the all-illegal hostname that sanitizes to EMPTY (e.g. "***", or "") was a QA
  # mis-spec flag (no ADR-003 collapse target). RESOLVED at refine — documented default taken
  # under `--autonomous` (reversible; recorded in STATE §Notes): an empty sanitized stem falls
  # back to a deterministic `node-<install-hash>` id (reusing the stable per-install hash that
  # disambiguates collisions). So the id is always non-empty, deterministic, stable, and
  # [a-z0-9-]-only. The empty case is therefore NOT in the sanitization matrix below (it is a
  # fallback, not a sanitization) — it is its own scenario after it.
  Scenario Outline: the node id is the sanitized, lowercased hostname with illegal runs collapsed to one "-"
    Given the host name is "<hostname>"
    When I derive this node's id
    Then the id is "<id>"
    And deriving it again yields the same id (deterministic)
    And the id contains only characters in [a-z0-9-]
    And the id has no leading or trailing "-"

    Examples:
      | hostname           | id            |
      | build-server       | build-server  |
      | Umair-Desktop      | umair-desktop |
      | Umair Desktop      | umair-desktop |
      | umair.desktop      | umair-desktop |
      | umair_desktop      | umair-desktop |
      | umair@desktop!     | umair-desktop |
      | umair--__--desktop | umair-desktop |
      | -leading-trailing- | leading-trailing |
      | node01             | node01        |

  # The empty-stem fallback (the resolved mis-spec flag): a hostname that sanitizes to nothing
  # yields a deterministic node-<install-hash> id rather than an empty or invalid id. Reuses the
  # stable per-install hash, so the id is stable across re-derivation and [a-z0-9-]-only.
  Scenario Outline: a hostname that sanitizes to empty falls back to a deterministic node-<install-hash> id
    Given the host name is "<hostname>"
    And there is no operator-set "mesh.nodeId"
    When I derive this node's id
    Then the id is non-empty and matches "node-<install-hash>" (the empty-stem fallback)
    And the id contains only characters in [a-z0-9-]
    And deriving it again on this install yields the same id (deterministic + stable)

    Examples:
      | hostname |
      | ***      |
      |          |

  # Stability across publishes: the id is persisted to config (mesh.nodeId) on first derivation
  # and reused thereafter — so a later hostname rename does NOT churn the node's identity.
  # R4: pin the UNAFFECTED side — the rename happened, yet the persisted id is what is returned
  # (the live hostname is ignored once an id is pinned).
  Scenario: the first derivation persists the id to config and later derivations reuse it
    Given config has no "mesh.nodeId" yet
    When I derive this node's id
    Then config "mesh.nodeId" is now "umair-desktop"
    When the host name later changes to "Umair-Laptop"
    And I derive this node's id again
    Then the id is still "umair-desktop" (the persisted id, not the new hostname)
    And config "mesh.nodeId" is still "umair-desktop" (the rename did not rewrite the pinned id)

  # An operator override wins: a pre-set mesh.nodeId is used verbatim (the derivation is a
  # default, not a mandate).
  # R4: pin the UNAFFECTED side — deriving against an operator-set id neither re-derives from
  # the hostname NOR overwrites the operator's value, even when the hostname would sanitize
  # to something different.
  Scenario: an operator-set mesh.nodeId overrides the derived default and is never rewritten
    Given config "mesh.nodeId" is already "build-server"
    And the host name is "Umair-Desktop"
    When I derive this node's id
    Then the id is "build-server"
    And config "mesh.nodeId" is still "build-server" (deriving did not overwrite the operator's value)

  # Collision handling: two installs that would derive the same id are disambiguated by a
  # stable per-install hash suffix, preserving ADR-002's one-node-per-path invariant.
  Scenario: a hostname collision is disambiguated by a stable per-install hash suffix
    Given two installs both with host name "laptop" but distinct per-install salts
    When each install derives its node id
    Then the two ids differ (e.g. "laptop-a1b2" and "laptop-c3d4")
    And each id keeps the sanitized hostname as its stem before the suffix
    And each id is stable across re-derivation on its own install
    And each id contains only characters in [a-z0-9-]

  # The descriptor carries the COMPLETE frozen schema, every field present + correctly typed.
  # QA: this scenario pins EVERY frozen field — nodeId, host, os, runtimes, skills, aofVersion,
  # publishedAt — so no field can drift out of the advertised shape unnoticed.
  Scenario: the capability descriptor carries the complete frozen schema
    Given config runtimes are ["claude", "codex"]
    And the install has known skills installed
    When I assemble this node's capability descriptor
    Then the descriptor "nodeId" is a non-empty string
    And the descriptor "host" is the raw host name
    And the descriptor "os" is the platform (one of win32, darwin, linux)
    And the descriptor "runtimes" equals ["claude", "codex"] from config
    And the descriptor "skills" is the array of installed skill ids
    And the descriptor "aofVersion" is the install's aof version
    And the descriptor "publishedAt" is an ISO-8601 UTC instant (a trailing-Z toISOString form)
    And the descriptor carries no field outside the frozen schema's known + additive keys

  # The descriptor's array fields reflect config/environment faithfully at the equivalence
  # boundaries: an empty runtimes list assembles as [] (not absent, not crash), and a single
  # runtime assembles as a one-element array — so the advertisement is honest about a minimal
  # install. skills likewise empties to [] when no skills are installed.
  Scenario Outline: the descriptor's capability arrays reflect config faithfully at the boundaries
    Given config runtimes are <runtimes>
    And the install has <skills-state>
    When I assemble this node's capability descriptor
    Then the descriptor "runtimes" equals <runtimes>
    And the descriptor "skills" is <skills-result>

    Examples:
      | runtimes            | skills-state           | skills-result           |
      | ["claude", "codex"] | known skills installed | the installed skill ids |
      | ["claude"]          | known skills installed | the installed skill ids |
      | []                  | no skills installed    | []                      |

  # The descriptor is REBUILDABLE — a fresh assembly from the same config + environment yields
  # an equivalent descriptor (publishedAt aside), proving it is a derived projection, not state.
  # R4: pin the UNAFFECTED side — re-assembling reads config but does not WRITE it (the
  # descriptor is a projection; assembling it twice leaves mesh.* config byte-unchanged, only
  # publishedAt differs between the two outputs).
  Scenario: the descriptor is a rebuildable projection that reads config without mutating it
    Given config "mesh.nodeId" is already pinned
    When I assemble the descriptor twice from the same config and environment
    Then the two descriptors are equivalent in every field except "publishedAt"
    And each "publishedAt" is at or after the previous assembly
    And the mesh.* config is byte-unchanged across both assemblies (assembly reads, never writes)
