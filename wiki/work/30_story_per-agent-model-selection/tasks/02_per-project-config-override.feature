@cli @work @validate @executable
Feature: a project overrides the per-role model default via config
  In order to let a project tune model spend to its own budget without editing the shipped bundle
  the system must let "work.agents" carry a per-role model override that wins over the bundle default in
  the rendered agent file, validate that each override targets one of the 8 frozen ACD roles with a
  well-formed model value, and leave every un-overridden role on its shipped default.

  # Refinement decision (STORY.md "Open design questions" — "Where the default lives"): BOTH. The bundle
  # ships the default (task 01) and is the source of truth; this task adds the per-project override that
  # wins over it.
  #
  # FEASIBILITY (dev) — this task is NET-NEW on three seams the drafts describe as end-state:
  #   1. Schema: `work.agents` today knows only `mode` + `productOwner` and is `additionalProperties:
  #      false` (schemas/aof.schema.json:358-372) — the per-role model key is a deliberate schema addition.
  #   2. Override-wins-at-render is NOT wired today: `aof work init`/`update` synthesise the render config
  #      from the BUNDLE ONLY (src/work-bundle-synthesis.mjs) and never read the project's aof.config.json.
  #      So the "override wins" scenarios need a NEW config-aware render pass (load project config -> build
  #      a role->model map -> apply onto the bundle resource before renderResource). The render step below
  #      binds THAT config-aware path — NOT task 01's bundle-only `renderBundleOutputs`, which ignores the
  #      override and would give this task a false green.
  #   3. `work.agents` has NO runtime validation in src/config-inspect.mjs yet; the key/value checks below
  #      are new. The schema's `additionalProperties:false` is not enforced at validate time (no Ajv load),
  #      so the observable rejections must come from new config-inspect code, surfaced by `aof project
  #      validate` (NOT `aof work validate`, which validates the work-item stream, not aof.config.json).
  #
  # Model value form: the alias floor from task 01 (a moving family alias) PLUS any pinned id — so
  # validation accepts any non-empty string and rejects only empty / non-string / whitespace-only. It does
  # NOT hard-enumerate known aliases/ids: a strict enum would need bumping every model launch, defeating
  # the "latest alias" intent (the "haiku" and forward-dated rows below pin exactly that the floor holds).
  # A stricter known-alias check is acceptable only as a NON-BLOCKING warning, never an error.
  #
  # ARCH-TEST candidate (structural invariant — a fitness function, NOT a Then here): the set of valid
  # override keys is exactly the 8 frozen ACD roles. config-inspect should DERIVE that set from the
  # exported readDescriptor() (src/bundle/bundle.json agent members) rather than a 4th hardcoded copy of
  # the list (it is already duplicated in test/arch/acd-bundle-membership.test.mjs + test/bundle.test.mjs).
  # The scenarios below assert the OBSERVABLE validation behaviour, not the invariant itself.
  #
  # All rows run OFFLINE against a fixture config. Value cells are described in prose where they carry a
  # TYPE rather than a literal ("null", "a number, not a string"); the step binds each to the concrete
  # JSON value. The exact override key path is mechanism — the step binds it.

  Background:
    Given a project whose ACD bundle has been rendered with the shipped default model map

  # The override wins over the default. The first rows pick an override that DIFFERS from the role's
  # shipped default (so a green row proves the override — not the default — drove the value); the last row
  # pins the degenerate override==default case as a clean no-op, not a duplicate/errored `model:` line.
  Scenario Outline: a configured per-role override wins over the bundle default
    Given "work.agents" configures a model override of "<override>" for "<role>"
    When the ACD bundle is rendered into the project applying its config overrides
    Then the generated ".claude/agents/<role>.md" carries "<override>" as its "model"

    Examples: override a decide-role down to sonnet (shipped default: opus)
      | role          | override |
      | aof-architect | sonnet   |

    Examples: override an execute-role up to opus (shipped default: sonnet)
      | role          | override |
      | aof-developer | opus     |

    Examples: override to a fully-pinned id (shipped default: opus)
      | role       | override        |
      | aof-qa     | claude-opus-4-8 |

    Examples: an "inherit" override is rendered verbatim, NOT reinterpreted as fall-back
      | role           | override |
      | aof-researcher | inherit  |

    Examples: override equal to the shipped default is a clean no-op (still renders once)
      | role          | override |
      | aof-architect | opus     |

  # Un-overridden roles are untouched: overriding one role does not perturb the rest of the map.
  Scenario: an un-overridden role keeps its shipped default
    Given "work.agents" configures a model override only for "aof-architect"
    When the ACD bundle is rendered into the project applying its config overrides
    Then every other role's generated agent file still carries its shipped default model

  # Validation — the override KEY must be one of the 8 ACD roles, matched case-sensitively and untrimmed.
  # A typo, wrong casing, missing prefix, or padded key is a config error the operator sees, never a
  # silently-ignored entry.
  Scenario Outline: the override key must be one of the 8 ACD roles
    Given "work.agents" configures a model override keyed by "<key>"
    When I run "aof project validate"
    Then validation <verdict>

    Examples: a real ACD role is accepted (both tiers + the longest, most typo-prone key)
      | key               | verdict                                          |
      | aof-architect     | reports no error for the override                |
      | aof-researcher    | reports no error for the override                |
      | aof-product-owner | reports no error for the override                |

    Examples: a key outside the 8 ACD roles is rejected
      | key               | verdict                                          |
      | aof-orchestrator  | reports an error that the key is not an ACD role |
      | developer         | reports an error that the key is not an ACD role |
      | aof-designerr     | reports an error that the key is not an ACD role |

    Examples: a valid role in the wrong casing or with surrounding whitespace is rejected
      | key               | verdict                                          |
      | aof-QA            | reports an error that the key is not an ACD role |
      | AOF-architect     | reports an error that the key is not an ACD role |
      | " aof-qa"         | reports an error that the key is not an ACD role |

  # Validation — the override VALUE must be a well-formed model. Floor: reject empty / whitespace-only /
  # non-string; accept ANY non-empty string (alias or pinned id), so new families and ids need no
  # validator change. The "haiku" row is load-bearing: it proves an alias aof doesn't use is still
  # accepted, so a future dev can't quietly add a known-alias enum and pass every existing green row.
  Scenario Outline: the override value must be a well-formed model string
    Given "work.agents" configures aof-architect's model override as <value>
    When I run "aof project validate"
    Then validation <verdict>

    Examples: accepted — a family alias or a pinned id, including an alias the map doesn't use
      | value                  | verdict           |
      | "opus"                 | reports no error  |
      | "sonnet"               | reports no error  |
      | "claude-opus-4-8"      | reports no error  |
      | "haiku"                | reports no error  |

    Examples: rejected — empty, whitespace-only, or not a string
      | value                  | verdict           |
      | "" (empty string)      | reports an error  |
      | "   " (whitespace only)| reports an error  |
      | a number, not a string | reports an error  |
      | null                   | reports an error  |
