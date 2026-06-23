@cli @adapter @memory
Feature: claude-cli is classified honestly and the chosen extraction backend is surfaced, never silent
  In order to enable graph-grounded memory as an opt-in act that never silently networks
  the system must teach graph-build.mjs the "claude-cli" value (network-crossing, docs-media egress),
  keep ollama the only data-local backend (still a docs-media hop), and SURFACE the chosen extraction
  backend + its egress label so an operator can always see which backend the graph build ran through.

  # ADR-003: claude-cli is graphify's native, credential-local default — keyless, billed-to-plan, no
  # third-party key — but NOT data-local: the prose is still sent to Anthropic for inference. The
  # classifier must therefore know it: isNetworkBackend("claude-cli") === true (it DOES cross the
  # network; billed-to-plan ≠ on-box), and classifyEgress("claude-cli") === "docs-media" (the doc/media
  # hop RAN — exactly as for claude/ollama; 09/ADR-001/005 "report the hop ran, never re-classify by
  # reachability"). ollama stays the ONLY local backend (isNetworkBackend false) but its egress is STILL
  # "docs-media" because the hop ran — locality is a SEPARATE privacy property, never folded into egress.
  #
  # These are OBSERVABLE behaviours: the pure-function classification of graph-build.mjs, and the
  # extraction backend the graphify backend surfaces in status. The structural pin — a fitness function
  # asserting these exact classifications + the enum registration — is the arch-test's
  # (acd-graphify-backend-classified, story 03), NOT a scenario here. The honest-egress data-residency
  # CLAIM itself (claude-cli is credential-local, not data-local) is a privacy-review / @manual concern;
  # this feature asserts only the classifier output + the surfacing.

  # The classification is pure over graph-build.mjs — no binary, no spawn, no config (@executable).
  @executable
  Scenario: claude-cli is a network-crossing backend (billed-to-plan is not on-box)
    Given the backend name "claude-cli"
    Then isNetworkBackend("claude-cli") is true
    And the network classification is by KNOWLEDGE, not by the unknown-name fall-through

  @executable
  Scenario: claude-cli's egress is docs-media (the doc/media hop ran)
    Given the backend name "claude-cli"
    Then classifyEgress("claude-cli") is "docs-media"

  @executable
  Scenario: ollama is the only data-local backend, yet its egress is still docs-media
    Given the backend name "ollama"
    Then isNetworkBackend("ollama") is false
    And classifyEgress("ollama") is "docs-media"
    And ollama remains the ONLY backend for which isNetworkBackend is false

  # The classifier over every backend the egress model knows — (isNetwork, egress). claude-cli JOINS the
  # network-crossing set with a docs-media hop; ollama is the lone local, still a docs-media hop; the
  # remote APIs (claude) are network + docs-media; no backend (null/absent) is local + "none" (no hop
  # ran). The null row is the floor: classifyEgress(null) === "none", isNetworkBackend(null) === false.
  @executable
  Scenario Outline: each backend classifies to its honest (isNetwork, egress) pair
    Given the backend name <backend>
    Then isNetworkBackend(<backend>) is <isNetwork>
    And classifyEgress(<backend>) is <egress>

    Examples: claude-cli joins network/docs-media; ollama is the lone local; null is the no-hop floor
      | backend      | isNetwork | egress       |
      | "claude-cli" | true      | "docs-media" |
      | "ollama"     | false     | "docs-media" |
      | "claude"     | true      | "docs-media" |
      | null         | false     | "none"       |

  # ADR-003 / 09/ADR-005 + PRD privacy: aof NEVER silently defaults to a network-egressing backend. The
  # memory.backend = graphify selection (config) is the opt-in act; the build's extraction backend is
  # then SURFACED — status reports the chosen extraction backend (claude-cli) so the operator can see
  # which backend the graph build ran through. It is visible, not a silent default.
  @executable
  Scenario: status surfaces the chosen extraction backend
    Given the graphify backend is selected
    When I run "aof work memory status --json"
    Then the command exits 0
    And the status reports the extraction backend "claude-cli"

  # The live confirmation that `--backend claude-cli` actually RUNS keyless against the pinned binary
  # (no ANTHROPIC_API_KEY, billed-to-plan) is ALREADY evidenced in the milestone VERIFICATION.md from
  # story 00's live reindex run (graphify reported `via claude-cli` / `~claude-cli: $0.0000`, key unset
  # throughout). This row REFERENCES that evidence rather than re-running the ~27-min build; it pins the
  # aof-side contract: the extraction backend graphify is driven with is claude-cli, surfaced in the
  # result's egress label as the honest "docs-media" hop.
  @manual
  Scenario: the live --backend claude-cli build runs keyless and surfaces docs-media egress
    Given the graphify binary is installed and a logged-in Claude Code session is available
    And ANTHROPIC_API_KEY is unset
    When a graphify reindex drives a real work-stream graph build
    Then the build runs the extraction through claude-cli with no metered key
    And the result surfaces the extraction backend "claude-cli" and egress "docs-media"
    # Evidenced live in this milestone's VERIFICATION.md (story 00 reindex run) — not re-run here.
