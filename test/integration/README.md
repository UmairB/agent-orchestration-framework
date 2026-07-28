# Integration tests — the BDD-first lane

Restructured 2026-07-28 as part of m42 wave (d) (PRD-command-spine-effects-ledger). The operator's
finding that triggered it: this folder had not been maintained since ~May, which is exactly why CLI
changes kept landing brittle — nothing black-box pinned the verbs' contracts. **The policy is now
integration-first:** a command migration or new verb lands WITH a feature scenario in the same
change; the unit/arch suites verify internals, but the feature file is the contract of record for
what `aof <verb>` does at its face.

## Layout

```
features/<name>.feature      the contracts (plain Gherkin subset: Feature/Scenario/Given-When-Then)
steps/<name>.steps.mjs       resolved BY CONVENTION from the feature's basename — no central map
support/feature-runner.mjs   the parser/runner (repo-owned, dependency-free)
support/step-registry.mjs    declarative pattern → handler registration for step modules
support/common-steps.mjs     the shared grammar (fixtures, `I run`, exit/stdout/JSON assertions)
support/work-stream-fixture.mjs  scaffolds a real workspace (.aof config + wiki/work records)
support/cli-context.mjs      per-scenario temp project + isolated AOF_GLOBAL_HOME; spawn or in-process
cli.mjs                      the entry: discovers features, resolves steps, runs
```

## Running

```bash
# everything (spawned real CLI, per-scenario isolation — safe by construction):
node test/integration/cli.mjs

# one feature, focused:
node test/integration/cli.mjs command-spine

# the embedded in-process mode is what scripts/test.mjs uses (AOF_IN_PROCESS_INTEGRATION=1).
```

Every scenario gets its own temp project dir AND its own `AOF_GLOBAL_HOME` (cli-context), so the
suite never touches the real `~/.aof` or the live soak. The repo-wide rule still applies to any
OTHER way of invoking tests: `AOF_GLOBAL_HOME="$(mktemp -d)" …`.

## Writing a feature (the migration ritual)

1. Write the scenario FIRST in `features/<name>.feature` using the shared grammar
   (see `support/common-steps.mjs`) — most migrations need no new steps at all.
2. If a step is genuinely new, add it to the feature's own `steps/<name>.steps.mjs`
   (create it: instantiate `createStepRegistry()`, call `registerCommonSteps`, define extras,
   export `runStep`). Prefer promoting a step into `common-steps.mjs` once two features want it.
3. Steps are black-box through the real CLI (`runCli`). The one sanctioned grey-box seam is
   verifying AT THE REAL STORE (e.g. the effects journal in `effects-ledger.steps.mjs`) — a claim
   about durability is a claim about the store, not stdout.
4. `command-spine.feature` is the contract every route-table verb inherits (route dispatch, flag
   spec refusal, the one `--json` error envelope, exit-code policy). A newly migrated verb usually
   only needs ONE scenario proving its own render/JSON — the envelope rules are already pinned.

## The legacy features

`adapter-policy` / `dsl` / `lifecycle` / `packages` / `setup-ui` predate the restructure and keep
their hand-rolled `runStep` if/else modules (they work; convention still resolves them). New work
uses the registry style. `cli.feature` (repo root of this folder) is a legacy alias running
lifecycle's grammar and is only picked up when `features/` is empty — i.e. never in practice.
