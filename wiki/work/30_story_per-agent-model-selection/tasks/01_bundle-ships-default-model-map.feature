@cli @assets @distribution @executable
Feature: the ACD bundle ships a default model per agent role
  In order to spend top-tier model budget where reasoning quality actually changes the outcome
  the bundle must ship each of the 8 ACD agents with a default model — the roles that decide
  "what's correct" (author / gate / review) on the most capable family, the roles that execute or
  gather against an already-locked target on a faster one — so a freshly rendered project inherits the
  differentiated map with no per-project setup at all.

  # The locked default map (STORY.md "Locked intent — the default model map", flagged "must survive
  # into refinement"):
  #   opus   -> aof-architect, aof-security, aof-compliance, aof-product-owner, aof-qa, aof-designer
  #             (the roles that decide what's correct)
  #   sonnet -> aof-developer, aof-researcher
  #             (the roles that execute or gather against a locked target)
  #
  # Refinement decisions pinned here (see STORY.md "Open design questions"):
  #   - Form: a MOVING FAMILY ALIAS ("opus" / "sonnet"), NOT a dated/pinned id. The alias tracks the
  #     latest of that family at resolve time (today: Opus 4.8 / Sonnet 4.6), so a model bump needs no
  #     re-render. aof renders the alias verbatim and leaves resolution to the Claude Code runtime.
  #   - Where: the default ships in the bundle source (this task); a per-project config override is a
  #     separate task (02) that wins over this default.
  #
  # The seam is small and already carries `model` through, CONFIRMED at feasibility: bundle frontmatter
  # `model:` -> loadBundle sets resource.model (src/work-bundle.mjs:86) -> renderResource emits a
  # verbatim `model:` line in the generated Claude Code agent file (src/adapters.mjs:415). No agent
  # declares one today, so all roles inherit the session default; this task fills the map.
  #
  # OFFLINE render binding (dev): `renderBundleOutputs(loadBundle())` returns each output's `path`
  # (".claude/agents/aof-<role>.md" for the Claude runtime — the copy the Claude Code runtime honours;
  # an agent also renders to ".codex/agents/…", out of scope here) + `content`, so every row below reads
  # a rendered file with no live runtime. Pattern already used in test/bundle.test.mjs.
  #
  # ARCH-TEST candidates (structural invariants — a fitness function, NOT a Then here):
  #   - every one of the 8 frozen ACD roles declares a model in the bundle SOURCE (no role un-mapped);
  #   - the declared SOURCE value is a family alias, never a dated/fully-pinned id.
  # These check the bundle source; the Thens below check the RENDERED file (distinct surfaces — don't
  # collapse them). The frozen 8-role set is already fixed by test/arch/acd-bundle-membership.test.mjs.

  Background:
    Given the ACD bundle source under "src/bundle/agents/" holding the 8 frozen ACD roles

  # The differentiated map is the load-bearing product acceptance: which role gets which family. Every
  # row asserts one role's rendered default, so a future change can't quietly move a role off its tier.
  Scenario Outline: each ACD role's shipped default renders into its generated agent file
    When the ACD bundle is rendered into a project
    Then the generated ".claude/agents/<role>.md" carries "<model>" as its "model" frontmatter

    Examples: opus — the roles that decide "what's correct" (author / gate / review)
      | role              | model  |
      | aof-architect     | opus   |
      | aof-security      | opus   |
      | aof-compliance    | opus   |
      | aof-product-owner | opus   |
      | aof-qa            | opus   |
      | aof-designer      | opus   |

    Examples: sonnet — the roles that execute or gather against a locked target
      | role              | model  |
      | aof-developer     | sonnet |
      | aof-researcher    | sonnet |

  # "Latest" tracking: the rendered value is the alias itself — lowercase and un-expanded — so when a
  # newer Opus/Sonnet ships the generated files need no edit. This pins that aof neither resolves the
  # alias to a concrete id nor re-cases it (a downstream runtime match depends on the exact literal).
  Scenario: the shipped default is a moving family alias, rendered verbatim
    When the ACD bundle is rendered into a project
    Then each generated agent file's "model" value is the family alias exactly as declared ("opus" / "sonnet")
    And no generated "model" value is a re-cased variant (e.g. "Opus" / "OPUS")
    And no generated "model" value contains a version-dated id (e.g. "claude-opus-4-8")
