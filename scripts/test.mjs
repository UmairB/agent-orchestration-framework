import { pathToFileURL } from "node:url";
import { adapterTests } from "../test/adapters.test.mjs";
import { catalogTests } from "../test/catalog.test.mjs";
import { pathTests } from "../test/paths.test.mjs";
import { promptTests } from "../test/prompt.test.mjs";
import { modelTests } from "../test/model.test.mjs";
import { workspaceTests } from "../test/workspace.test.mjs";
import { renderPlanTests } from "../test/render-plan.test.mjs";
import { configInspectTests } from "../test/config-inspect.test.mjs";
import { configEditorTests } from "../test/config-editor.test.mjs";
import { frameworkTests } from "../test/frameworks.test.mjs";
import { cleanTests } from "../test/clean.test.mjs";
import { dslPrimitiveTests } from "../test/dsl-primitives.test.mjs";
import { setupUiTests } from "../test/setup-ui.test.mjs";
import { schemaTests } from "../test/schema.test.mjs";
import { adapterWarningTests } from "../test/adapter-warnings.test.mjs";
import { packageTests } from "../test/packages.test.mjs";
import { bundleTests } from "../test/bundle.test.mjs";
import { workInitTests } from "../test/work-init.test.mjs";
import { workUpdateTests } from "../test/work-update.test.mjs";
import { archTests as acdBundleMembershipTests } from "../test/arch/acd-bundle-membership.test.mjs";
import { archTests as acdBundleLocationTests } from "../test/arch/acd-bundle-location.test.mjs";
import { archTests as acdBundleManifestHashesTests } from "../test/arch/acd-bundle-manifest-hashes.test.mjs";
import { archTests as acdCommandNamespaceTests } from "../test/arch/acd-command-namespace.test.mjs";
import { archTests as acdReusesRenderPlanTests } from "../test/arch/acd-reuses-render-plan.test.mjs";
import { archTests as acdInstallManifestContractTests } from "../test/arch/acd-install-manifest-contract.test.mjs";
import { archTests as acdGeneratedStampTests } from "../test/arch/acd-generated-stamp.test.mjs";
import { archTests as acdCapabilityDelegationTests } from "../test/arch/acd-capability-delegation.test.mjs";
import { archTests as acdNoClobberWithoutForceTests } from "../test/arch/acd-no-clobber-without-force.test.mjs";
import { planningInitTests } from "../test/planning-init.test.mjs";
import { planningPrdTests } from "../test/planning-prd.test.mjs";
import { archTests as acdPlanningInstallCommandsTests } from "../test/arch/acd-planning-install-commands.test.mjs";
import { archTests as acdPlanningProvenanceShaTests } from "../test/arch/acd-planning-provenance-sha.test.mjs";
import { archTests as acdPlanningLockIsolationTests } from "../test/arch/acd-planning-lock-isolation.test.mjs";
import { archTests as acdPlanningNoCodexInstallTests } from "../test/arch/acd-planning-no-codex-install.test.mjs";
import { archTests as acdPlanningClonableRefTests } from "../test/arch/acd-planning-clonable-ref.test.mjs";
import { archTests as acdUnifiedLockSectionsTests } from "../test/arch/acd-unified-lock-sections.test.mjs";
import { workMemorySeamTests } from "../test/work-memory-seam.test.mjs";
import { memoryIndexingTests } from "../test/memory-indexing.test.mjs";
import { memoryRetrievalTests } from "../test/memory-retrieval.test.mjs";
import { archTests as acdMemoryBackendSelectionTests } from "../test/arch/acd-memory-backend-selection.test.mjs";
import { archTests as acdMemoryDerivedIndexTests } from "../test/arch/acd-memory-derived-index.test.mjs";
import { archTests as acdMemoryAofDigestTests } from "../test/arch/acd-memory-aof-digest.test.mjs";
import { archTests as acdMemoryIndexLocationTests } from "../test/arch/acd-memory-index-location.test.mjs";
import { archTests as acdMemoryRankingTests } from "../test/arch/acd-memory-ranking.test.mjs";
import { archTests as acdMemoryBackendInterfaceTests } from "../test/arch/acd-memory-backend-interface.test.mjs";
import { archTests as acdMemoryRecallContractTests } from "../test/arch/acd-memory-recall-contract.test.mjs";
import { memoryIntegrationTests } from "../test/memory-integration.test.mjs";
import { memoryRecallBlockTests } from "../test/memory-recall-block.test.mjs";
import { memoryHooksInertTests } from "../test/memory-hooks-inert.test.mjs";
// milestone 03 — work board UI
import { workListTests } from "../test/work-list.test.mjs";
import { archTests as acdWorkListContractTests } from "../test/arch/acd-work-list-contract.test.mjs";
import { boardApiTests } from "../test/board-api.test.mjs";
import { boardServeTests } from "../test/board-serve.test.mjs";
import { archTests as acdBoardWriteIsolationTests } from "../test/arch/acd-board-write-isolation.test.mjs";
import { boardActionTests } from "../test/board-action.test.mjs";
import { terminalDockTests } from "../test/terminal-dock.test.mjs";
import { terminalWsTests } from "../test/terminal-ws.test.mjs";
import { terminalSessionsTests } from "../test/terminal-sessions.test.mjs";
import { archTests as acdTerminalServerOnlyTests } from "../test/arch/acd-terminal-server-only.test.mjs";
import { archTests as acdVibeyardAttributionTests } from "../test/arch/acd-vibeyard-attribution.test.mjs";
import { archTests as acdBoardSingleServerTests } from "../test/arch/acd-board-single-server.test.mjs";
// milestone 04 — round-trip proof (story 00: the frozen harness)
import { roundtripHarnessTests } from "../test/roundtrip-harness.test.mjs";
import { archTests as acdRoundtripIsolationTests } from "../test/arch/acd-roundtrip-isolation.test.mjs";
import { archTests as acdRoundtripReusesShippedCodeTests } from "../test/arch/acd-roundtrip-reuses-shipped-code.test.mjs";
import { archTests as acdRoundtripHarnessContractTests } from "../test/arch/acd-roundtrip-harness-contract.test.mjs";
import { archTests as acdRoundtripRegistrationTests } from "../test/arch/acd-roundtrip-registration.test.mjs";
// milestone 04 — round-trip proof (story 01: install-proof, story 02: loop-proof)
import { installProofTests } from "../test/roundtrip-install-proof.test.mjs";
import { loopProofTests } from "../test/roundtrip-loop-proof.test.mjs";
// milestone 06 — headroom plugin (ADRs 001–005; RED-until-built fitness functions)
import { archTests as acdHeadroomConfigSchemaTests } from "../test/arch/acd-headroom-config-schema.test.mjs";
import { archTests as acdHeadroomHonestDegradeTests } from "../test/arch/acd-headroom-honest-degrade.test.mjs";
import { archTests as acdHeadroomConfigIsolationTests } from "../test/arch/acd-headroom-config-isolation.test.mjs";
import { archTests as acdHeadroomNoDependencyTests } from "../test/arch/acd-headroom-no-dependency.test.mjs";
import { archTests as acdHeadroomNoProxyRuntimeTests } from "../test/arch/acd-headroom-no-proxy-runtime.test.mjs";
// milestone 06 — headroom plugin (story 00: config-contract @executable traceability)
import { headroomConfigContractTests } from "../test/headroom-config-contract.test.mjs";
// milestone 06 — headroom plugin (story 01: toggle-cli, story 02: wrap-routing @executable traceability)
import { headroomToggleCliTests } from "../test/headroom-toggle-cli.test.mjs";
import { headroomWrapRoutingTests } from "../test/headroom-wrap-routing.test.mjs";
// milestone 07 — design-conformance verification (ADRs 001–005 carry fitness functions; ADR-006 is the
// story-partition rationale, no arch-test). NEW: role-split, verdict-contract, template-baseline,
// a11y-config-schema, and the design-conformance-bundled drift guard.
import { archTests as acdDesignRoleSplitTests } from "../test/arch/acd-design-role-split.test.mjs";
import { archTests as acdConformanceVerdictContractTests } from "../test/arch/acd-conformance-verdict-contract.test.mjs";
import { archTests as acdDesignTemplateBaselineTests } from "../test/arch/acd-design-template-baseline.test.mjs";
import { archTests as acdA11yConfigSchemaTests } from "../test/arch/acd-a11y-config-schema.test.mjs";
import { archTests as acdDesignConformanceBundledTests } from "../test/arch/acd-design-conformance-bundled.test.mjs";
// milestone 08 — CLI command core (story 00: the in-process registry of the six work operations)
import { commandCoreContractTests } from "../test/command-core-contract.test.mjs";
// milestone 08 — CLI command core (story 01: the CLI face; story 02: the board face; story 03: the
// enforcing fitness functions — the route↔command/command↔CLI bijection + the no-UI-core-import / no-subprocess guards)
import { cliFaceContractTests } from "../test/cli-face-contract.test.mjs";
import { boardFaceContractTests } from "../test/board-face-contract.test.mjs";
import { archTests as acdWorkCommandRouteCoverageTests } from "../test/arch/acd-work-command-route-coverage.test.mjs";
import { archTests as acdWorkCommandCliBijectionTests } from "../test/arch/acd-work-command-cli-bijection.test.mjs";
import { archTests as acdWorkUiNoCoreImportTests } from "../test/arch/acd-work-ui-no-core-import.test.mjs";
import { archTests as acdWorkCommandNoSubprocessTests } from "../test/arch/acd-work-command-no-subprocess.test.mjs";
// milestone 09 — graphify command core (story 00: the three graph:* commands + the
// driver/normalizer + the `aof graph` dispatch; @executable traceability)
import { graphCommandCoreTests } from "../test/graph-command-core.test.mjs";
// milestone 09 — graphify command core (story 01: binary-provisioning — the
// resolveGraphifyBinary absent-case behaviour + the doctorConfig graphify-binary
// check, ADR-002/ADR-004; @executable traceability)
import { graphBinaryProvisioningTests } from "../test/graph-binary-provisioning.test.mjs";
// milestone 09 — graphify command core (story 02: rendered-faces — the graphify
// skill + MCP config entry rendered through the existing asset/lock/drift
// machinery, invoking aof graph not graphify, ADR-005; @executable traceability)
import { graphRenderedFacesTests } from "../test/graph-rendered-faces.test.mjs";
// milestone 09 — graphify command core (story 04: mcp-server-runtime — the stdio
// MCP server `aof graph serve` whose tools map tools/call → invoke("graph:…")
// behind the registry, ADR-005 amendment + ADR-006 inv. 2; @executable traceability)
import { graphMcpServerTests } from "../test/graph-mcp-server.test.mjs";
// milestone 09 — graphify command core (story 03: the SIX enforcing fitness
// functions of ADR-006 — registration+CLI bijection, no-face-spawn, binary-absent
// clean failure, privacy-no-widening, result-from-graph.json, no-npx-install)
import { archTests as acdGraphCommandCliBijectionTests } from "../test/arch/acd-graph-command-cli-bijection.test.mjs";
import { archTests as acdGraphNoFaceSpawnTests } from "../test/arch/acd-graph-no-face-spawn.test.mjs";
import { archTests as acdGraphBinaryAbsentTests } from "../test/arch/acd-graph-binary-absent.test.mjs";
import { archTests as acdGraphPrivacyBoundaryTests } from "../test/arch/acd-graph-privacy-boundary.test.mjs";
import { archTests as acdGraphJsonNormalizationTests } from "../test/arch/acd-graph-json-normalization.test.mjs";
import { archTests as acdGraphifyNoNpxInstallTests } from "../test/arch/acd-graphify-no-npx-install.test.mjs";
// milestone 10 — graphify memory backend (story 00: the spine — the graphify backend
// module satisfying the frozen 05 interface, the $defs/memory enum + BACKEND_REGISTRY
// registration (ADR-003), reindex rebuilding the 05 records + (re)building the graph via
// invoke("graph:build") with a fail-soft binary-absent skip (ADR-001/002/004/006), and
// recall returning the frozen RecallResult over 05-sourced records; @executable traceability)
import { graphifyBackendSelectionTests } from "../test/graphify-backend-selection.test.mjs";
import { graphifyReindexTests } from "../test/graphify-reindex.test.mjs";
import { graphifyRecallTests } from "../test/graphify-recall.test.mjs";
// milestone 10 — graphify memory backend (story 01: graph-grounded-reranking — the
// pure re-ranker `rerank(records, normalizedGraph, query, scope, opts)` that layers
// the work-stream graph's file-level relatedness boost onto the 05 base ranking
// (ADR-001), driven over the committed reranking fixtures; @executable traceability)
import { graphifyRerankingTests } from "../test/graphify-reranking.test.mjs";
// milestone 10 — graphify memory backend (story 02: extraction-posture-and-fallback —
// the claude-cli classification in graph-build.mjs (isNetworkBackend/classifyEgress, by
// KNOWLEDGE) + the surfaced extraction backend (ADR-003), and the binary-absent degrade
// across recall/brief/reindex/status (un-graph-ranked 05 recall + a visible diagnostic,
// ADR-004); @executable traceability)
import { graphifyPostureTests } from "../test/graphify-posture.test.mjs";
import { graphifyDegradeTests } from "../test/graphify-degrade.test.mjs";
// milestone 10 — graphify memory backend (story 03: the SIX enforcing fitness
// functions of ADR-006 — records-from-the-05-parsers, derived-index (records + graph
// git-ignored), reach-graphify-only-via-the-09-command, selection-enum + single-read,
// claude-cli-classified-honestly, binary-absent-degrades-not-crashes)
import { archTests as acdGraphifyRecordsFromParsersTests } from "../test/arch/acd-graphify-records-from-parsers.test.mjs";
import { archTests as acdGraphifyDerivedIndexTests } from "../test/arch/acd-graphify-derived-index.test.mjs";
import { archTests as acdGraphifyBackendViaCommandTests } from "../test/arch/acd-graphify-backend-via-command.test.mjs";
import { archTests as acdGraphifyBackendSelectionTests } from "../test/arch/acd-graphify-backend-selection.test.mjs";
import { archTests as acdGraphifyBackendClassifiedTests } from "../test/arch/acd-graphify-backend-classified.test.mjs";
import { archTests as acdGraphifyBinaryAbsentDegradesTests } from "../test/arch/acd-graphify-binary-absent-degrades.test.mjs";
// milestone 11 — graphify codebase intelligence (story 03: the FOUR enforcing fitness
// functions of ADR-006 — no-parse/legible-output (the agent reads command OUTPUT, aof
// never parses; no NEW src/ module reads graph.json), reached-only-via-the-09-commands
// (no new spawn site / no new graph-reaching module; the seams invoke `aof graph
// build/query/triage`), advisory-only (no graph output feeds a gate/merge/status-write/
// work-mutation; the triage queue is ranking context, never an auto-block), and
// derived+git-ignored (graphify-out/ git-ignored at the REPO ROOT; the freshness step
// builds-then-queries). Pure prompt-wiring + spawn/parse-surface assertions — no .feature.)
import { archTests as acdCodebaseGroundingNoParseTests } from "../test/arch/acd-codebase-grounding-no-parse.test.mjs";
import { archTests as acdCodebaseGroundingViaCommandsTests } from "../test/arch/acd-codebase-grounding-via-commands.test.mjs";
import { archTests as acdCodebaseGroundingAdvisoryTests } from "../test/arch/acd-codebase-grounding-advisory.test.mjs";
import { archTests as acdCodebaseGraphDerivedTests } from "../test/arch/acd-codebase-graph-derived.test.mjs";
// milestone 11 (re-open / ADR-007) — graph:impact: the DETERMINISTIC, edge-based
// coupling command the running agents consume. The NON-VACUOUS value test (computeImpact
// returns EXACT dependents/dependencies; the build-first precondition), replacing the
// superseded "zero production code" stance with a real, tested consumer.
import { tests as graphImpactTests } from "../test/graph-impact.test.mjs";
// milestone 12 — managed tool provisioning (story 00: the spine — the store
// geometry + store-first resolver, ADR-001; the provider registry + uv lane +
// frozen tool descriptors, ADR-002; @executable traceability)
import { toolStorePathResolutionTests } from "../test/tool-store-path-resolution.test.mjs";
import { toolProviderRegistryTests } from "../test/tool-provider-registry.test.mjs";
// milestone 12 — managed tool provisioning (story 01: the lifecycle surface —
// the project:provision command + CLI dispatch, ADR-003 task 00; the three
// store-aware doctorConfig checks superseding graphify-binary, ADR-003 task 01;
// @executable traceability)
import { toolProvisionCommandTests } from "../test/tool-provision-command.test.mjs";
import { toolDoctorChecksTests } from "../test/tool-doctor-checks.test.mjs";
// milestone 12 — managed tool provisioning (story 02: graphify retrofit — the
// store-first re-point of resolveGraphifyBinary onto resolveManagedBinary, ADR-004
// task 00; @executable traceability)
import { graphifyStoreFirstTests } from "../test/graphify-store-first.test.mjs";
// milestone 12 — managed tool provisioning (story 03: headroom retrofit — the
// store-first re-point of headroom's defaultWhich onto resolveManagedBinary, ADR-004
// task 00; the headroom descriptor's uv-lane plan + the tool-platform platform-matrix
// warning, ADR-004 task 01 @executable; @executable traceability)
import { headroomStoreFirstTests } from "../test/headroom-store-first.test.mjs";
import { headroomProvisionPlatformTests } from "../test/headroom-provision-platform.test.mjs";
// milestone 12 — managed tool provisioning (story 04: the FIVE provisioning fitness
// functions of ADR-005 — store-first resolution, AOF_GLOBAL_HOME-honoured/no-hardcoded
// -home, provider-neutral registry, npx-lane-preserved, uninstall-store-scoped)
import { archTests as acdToolStoreResolutionOrderTests } from "../test/arch/acd-tool-store-resolution-order.test.mjs";
import { archTests as acdToolStoreGlobalHomeTests } from "../test/arch/acd-tool-store-global-home.test.mjs";
import { archTests as acdProviderNeutralRegistryTests } from "../test/arch/acd-provider-neutral-registry.test.mjs";
import { archTests as acdNpxLanePreservedTests } from "../test/arch/acd-npx-lane-preserved.test.mjs";
import { archTests as acdUninstallStoreScopedTests } from "../test/arch/acd-uninstall-store-scoped.test.mjs";
// milestone 13 — external milestone import (story 00: the spine — the registered
// import:milestone command + `aof import milestone` dispatch, the read-only
// source-access seam, and the FROZEN materialize artifact pair + .aof/ import-store
// layout, ADR-001/002/004/005; @executable traceability — the @manual live-remote
// rows are deferred)
import { importCommandCoreTests } from "../test/import-command-core.test.mjs";
// milestone 13 — external milestone import (story 01: source-shape recovery — the
// REAL recovery heuristics behind story 00's frozen recoverMilestone seam: an
// aof-structured source's own SPEC/ARCHITECTURE/RETROSPECTIVE, an arbitrary repo's
// README/docs/ADRs/git-log, and "absence is information" — recover what is present,
// mark what is absent, never fabricate, ADR-001/005; @executable traceability — the
// @manual real-world-repo recovery row is deferred)
import { importRecoveryTests } from "../test/import-recovery.test.mjs";
// milestone 13 — external milestone import (story 02: import reaches memory — the
// EXTENDED buildRecords scan over the .aof/ import store (the existing parsers into
// the existing index, leg-aware source) + the import command's backend reindex
// trigger so imported precedent is recall-able through the unchanged `aof work
// memory` verbs, ADR-003/001/005; @executable traceability — the @manual
// graphify-backend recall row is deferred, it needs the live binary)
import { importIntoMemoryTests } from "../test/import-into-memory.test.mjs";
// milestone 13 — external milestone import (story 04: the AOF.md digest-on-import
// follow-up — an intent-only import (no decisions/outcomes) also emits an AOF.md
// digest indexed via the EXISTING parseAof, so a zero-record import gains a recallable
// `summary` presence; ADR-006, the deferred 13×14 follow-up)
import { importDigestTests } from "../test/import-digest.test.mjs";
// milestone 13 — external milestone import (story 03: the SIX enforcing fitness
// functions of ADR-001..005 — artifact-shape (reuse the 05 doc shapes, no new
// parser/record shape, SPEC.md never indexed), read-only-source (registered command +
// no git write verb / no shell-string spawn / only read-only fetch), indexer-extends-scan
// (one index, no bespoke store, no direct index write) + no-graphify-spawn (graphify
// reached only by the backend via the 09 commands), not-a-work-item (the store is outside
// workDir, non-NN_type_slug, git-ignored via the nested ignore — the resolver never
// enumerates it), and derived-index (source resolves in the store, clean re-import
// snapshot, git-ignored). Arch-tests only; no .feature.)
import { archTests as acdImportArtifactShapeTests } from "../test/arch/acd-import-artifact-shape.test.mjs";
import { archTests as acdImportReadOnlySourceTests } from "../test/arch/acd-import-read-only-source.test.mjs";
import { archTests as acdImportIndexerExtendsScanTests } from "../test/arch/acd-import-indexer-extends-scan.test.mjs";
import { archTests as acdImportNoGraphifySpawnTests } from "../test/arch/acd-import-no-graphify-spawn.test.mjs";
import { archTests as acdImportNotAWorkItemTests } from "../test/arch/acd-import-not-a-work-item.test.mjs";
import { archTests as acdImportDerivedIndexTests } from "../test/arch/acd-import-derived-index.test.mjs";
// milestone 13 / story 04 — the AOF.md digest-on-import fitness (ADR-006): an
// intent-only import emits a recallable AOF.md digest indexed via the EXISTING
// parseAof; an ADR/retro import emits none; no new parser/record shape.
import { archTests as acdImportDigestRecallableTests } from "../test/arch/acd-import-digest-recallable.test.mjs";
// milestone 15 — work doctor core (story 00: the spine — work:doctor registered on
// the command core with the { code, severity, path, message } envelope, the
// snapshot-once doctorWork engine + pure check-group registry + injectable clock,
// the CLI face with the --strict advisory exit policy, the /api/work/doctor board
// route, the two seeded folder-only groups (orphan-folder warn / duplicate-driver-
// number error), and the registry-derived bijection generalisation; @executable
// traceability + the FOUR cross-cutting fitness functions — envelope contract,
// engine determinism, --strict exit matrix, and the two generalised bijections)
import { doctorCommandCoreTests } from "../test/doctor-command-core.test.mjs";
// milestone 15 — work doctor core (story 01: coherence & completeness — the
// status-coherence + lifecycle-completeness check-groups appended to the registry;
// story 02: freshness/date-sanity + structural-integrity — the injected-clock date
// group and the folder-first numbering/orphan/duplicate group with the opt-in
// roadmap-folder-mismatch cross-reference; @executable traceability)
import { doctorCoherenceCompletenessTests } from "../test/doctor-coherence-completeness.test.mjs";
import { doctorFreshnessStructuralTests } from "../test/doctor-freshness-structural.test.mjs";
import { archTests as acdDoctorFindingEnvelopeTests } from "../test/arch/acd-doctor-finding-envelope.test.mjs";
import { archTests as acdDoctorEngineDeterminismTests } from "../test/arch/acd-doctor-engine-determinism.test.mjs";
import { archTests as acdDoctorStrictExitTests } from "../test/arch/acd-doctor-strict-exit.test.mjs";
// milestone 15 — work doctor core (story 03: validate keystone wiring — the
// /aof:validate skill runs `aof work doctor $ARGUMENTS` AFTER `aof work validate
// $ARGUMENTS`, lane-grouped (validity / health), health beneath the agent-only
// layer; validate stays the hard gate, doctor is the advisory floor, added not
// substituted; @executable doc-content + ordering guard over the bundled skill)
import { archTests as acdDoctorValidateKeystoneTests } from "../test/arch/acd-doctor-validate-keystone.test.mjs";
// milestone 16 — context-budget lint (story 00: the doc-bloat check-group — the
// budgetGroup appended to CHECK_GROUPS, fed by the additive docSizes snapshot metric
// and the config-sourced budgetsFromConfig resolver; emits doc-over-budget warn at the
// over-budget FILE; @executable traceability across both task features + the two new
// fitness functions — finding-envelope conformance and config-sourced/no-baked-literal)
import { doctorContextBudgetTests } from "../test/doctor-context-budget.test.mjs";
import { archTests as acdContextBudgetFindingTests } from "../test/arch/acd-context-budget-finding.test.mjs";
import { archTests as acdContextBudgetConfigSourcedTests } from "../test/arch/acd-context-budget-config-sourced.test.mjs";
// cross-cutting — the CLI entry-point contract: a direct `node src/cli.mjs …` must
// dispatch like the bin (not a silent exit-0 no-op), and importing the module must
// stay inert. Guards the main-module guard in src/cli.mjs against regression.
import { archTests as acdCliEntryExecutesTests } from "../test/arch/acd-cli-entry-executes.test.mjs";
// milestone 17 — Notion work-board sync (story 00: the spine — notion:sync-work
// registered on the command core + `aof work integrations notion sync-work`
// dispatch (ADR-002); the opt-in no-op gate when work.integrations.notion is absent
// (ADR-004); the `.aof/notion.work-map.json` mapping sidecar round-trip (ADR-001);
// @executable traceability — the projection/apply + arch-tests are later stories)
import { notionSpineCommandTests } from "../test/notion-spine-command.test.mjs";
import { notionSpineOptinNoopTests } from "../test/notion-spine-optin-noop.test.mjs";
import { notionMappingSidecarTests } from "../test/notion-mapping-sidecar.test.mjs";
// milestone 17 — Notion work-board sync (story 01: the projection + one-way sync —
// the PURE projectMilestone plan (00_projection-plan), the --dry-run zero-call
// preview (02_dry-run-zero-calls), and the statusMap projection + honest skip
// (03_status-map-and-honest-skip); ADR-003. @executable traceability — the
// live-Notion create/resync/one-way rows (01/04) are @manual, deferred to verify.)
import { notionProjectionPlanTests } from "../test/notion-projection-plan.test.mjs";
import { notionApplyIdempotentTests } from "../test/notion-apply-idempotent.test.mjs";
import { notionDryRunTests } from "../test/notion-dry-run.test.mjs";
import { notionStatusMapSkipTests } from "../test/notion-status-map-skip.test.mjs";
// milestone 17 — Notion work-board sync (story 02: the managed Notion CLI + opt-in
// config + doctor — the work.integrations.notion schema block (00_config-block-validates),
// the npx-lane NOTION_DESCRIPTOR (01_descriptor-registered), the env-var-reference
// auth spawn (02_auth-env-reference), and the project-doctor surface
// (03_doctor-surfaces-notion); ADR-004. @executable traceability — the live `ntn`
// install / auth round-trip rows are @manual, deferred to verify.)
import { notionConfigSchemaTests } from "../test/notion-config-schema.test.mjs";
import { notionDescriptorTests } from "../test/notion-descriptor.test.mjs";
import { notionAuthEnvTests } from "../test/notion-auth-env.test.mjs";
import { notionDoctorTests } from "../test/notion-doctor.test.mjs";
// milestone 17 — Notion work-board sync (story 03: the SEVEN fitness functions —
// ADR-005's structural invariants, each a test/arch/acd-notion-*.test.mjs arch-test,
// now GREEN over the as-built stories 00/01/02 modules: mapping-sidecar-only (ADR-001),
// one-way / Notion-never-authoritative (ADR-003), opt-in-no-op (ADR-004), auth-env-ref /
// no-committed-secret (ADR-004), never-touch-board-schema (ADR-003), CLI-not-MCP
// (ADR-004), fail-honestly / never-half-write (ADR-003/004).)
import { archTests as acdNotionMappingSidecarTests } from "../test/arch/acd-notion-mapping-sidecar.test.mjs";
import { archTests as acdNotionOneWayTests } from "../test/arch/acd-notion-one-way.test.mjs";
import { archTests as acdNotionOptInNoopTests } from "../test/arch/acd-notion-opt-in-noop.test.mjs";
import { archTests as acdNotionAuthEnvRefTests } from "../test/arch/acd-notion-auth-env-ref.test.mjs";
import { archTests as acdNotionNoSchemaWriteTests } from "../test/arch/acd-notion-no-schema-write.test.mjs";
import { archTests as acdNotionCliNotMcpTests } from "../test/arch/acd-notion-cli-not-mcp.test.mjs";
import { archTests as acdNotionFailHonestlyTests } from "../test/arch/acd-notion-fail-honestly.test.mjs";

export const tests = [
  ...adapterWarningTests,
  ...packageTests,
  ...bundleTests,
  ...workInitTests,
  ...workUpdateTests,
  ...acdBundleMembershipTests,
  ...acdBundleLocationTests,
  ...acdBundleManifestHashesTests,
  ...acdCommandNamespaceTests,
  ...acdReusesRenderPlanTests,
  ...acdInstallManifestContractTests,
  ...acdGeneratedStampTests,
  ...acdCapabilityDelegationTests,
  ...acdNoClobberWithoutForceTests,
  ...planningInitTests,
  ...planningPrdTests,
  ...acdPlanningInstallCommandsTests,
  ...acdPlanningProvenanceShaTests,
  ...acdPlanningLockIsolationTests,
  ...acdPlanningNoCodexInstallTests,
  ...acdPlanningClonableRefTests,
  ...acdUnifiedLockSectionsTests,
  ...workMemorySeamTests,
  ...memoryIndexingTests,
  ...memoryRetrievalTests,
  ...acdMemoryBackendSelectionTests,
  ...acdMemoryDerivedIndexTests,
  ...acdMemoryAofDigestTests,
  ...acdMemoryIndexLocationTests,
  ...acdMemoryRankingTests,
  ...acdMemoryBackendInterfaceTests,
  ...acdMemoryRecallContractTests,
  ...memoryIntegrationTests,
  ...memoryRecallBlockTests,
  ...memoryHooksInertTests,
  ...workListTests,
  ...acdWorkListContractTests,
  ...boardApiTests,
  ...boardServeTests,
  ...acdBoardWriteIsolationTests,
  ...boardActionTests,
  ...terminalDockTests,
  ...terminalWsTests,
  ...terminalSessionsTests,
  ...acdTerminalServerOnlyTests,
  ...acdVibeyardAttributionTests,
  ...acdBoardSingleServerTests,
  ...roundtripHarnessTests,
  ...acdRoundtripIsolationTests,
  ...acdRoundtripReusesShippedCodeTests,
  ...acdRoundtripHarnessContractTests,
  ...acdRoundtripRegistrationTests,
  ...installProofTests,
  ...loopProofTests,
  ...acdHeadroomConfigSchemaTests,
  ...acdHeadroomHonestDegradeTests,
  ...acdHeadroomConfigIsolationTests,
  ...acdHeadroomNoDependencyTests,
  ...acdHeadroomNoProxyRuntimeTests,
  ...headroomConfigContractTests,
  ...headroomToggleCliTests,
  ...headroomWrapRoutingTests,
  ...acdDesignRoleSplitTests,
  ...acdConformanceVerdictContractTests,
  ...acdDesignTemplateBaselineTests,
  ...acdA11yConfigSchemaTests,
  ...acdDesignConformanceBundledTests,
  ...commandCoreContractTests,
  ...cliFaceContractTests,
  ...boardFaceContractTests,
  ...acdWorkCommandRouteCoverageTests,
  ...acdWorkCommandCliBijectionTests,
  ...acdWorkUiNoCoreImportTests,
  ...acdWorkCommandNoSubprocessTests,
  ...graphCommandCoreTests,
  ...graphBinaryProvisioningTests,
  ...graphRenderedFacesTests,
  ...graphMcpServerTests,
  ...acdGraphCommandCliBijectionTests,
  ...acdGraphNoFaceSpawnTests,
  ...acdGraphBinaryAbsentTests,
  ...acdGraphPrivacyBoundaryTests,
  ...acdGraphJsonNormalizationTests,
  ...acdGraphifyNoNpxInstallTests,
  ...graphifyBackendSelectionTests,
  ...graphifyReindexTests,
  ...graphifyRecallTests,
  ...graphifyRerankingTests,
  ...graphifyPostureTests,
  ...graphifyDegradeTests,
  ...acdGraphifyRecordsFromParsersTests,
  ...acdGraphifyDerivedIndexTests,
  ...acdGraphifyBackendViaCommandTests,
  ...acdGraphifyBackendSelectionTests,
  ...acdGraphifyBackendClassifiedTests,
  ...acdGraphifyBinaryAbsentDegradesTests,
  ...graphImpactTests,
  ...acdCodebaseGroundingNoParseTests,
  ...acdCodebaseGroundingViaCommandsTests,
  ...acdCodebaseGroundingAdvisoryTests,
  ...acdCodebaseGraphDerivedTests,
  ...toolStorePathResolutionTests,
  ...toolProviderRegistryTests,
  ...toolProvisionCommandTests,
  ...toolDoctorChecksTests,
  ...graphifyStoreFirstTests,
  ...headroomStoreFirstTests,
  ...headroomProvisionPlatformTests,
  ...acdToolStoreResolutionOrderTests,
  ...acdToolStoreGlobalHomeTests,
  ...acdProviderNeutralRegistryTests,
  ...acdNpxLanePreservedTests,
  ...acdUninstallStoreScopedTests,
  ...importCommandCoreTests,
  ...importRecoveryTests,
  ...importIntoMemoryTests,
  ...importDigestTests,
  ...acdImportArtifactShapeTests,
  ...acdImportReadOnlySourceTests,
  ...acdImportIndexerExtendsScanTests,
  ...acdImportNoGraphifySpawnTests,
  ...acdImportNotAWorkItemTests,
  ...acdImportDerivedIndexTests,
  ...acdImportDigestRecallableTests,
  ...doctorCommandCoreTests,
  ...doctorCoherenceCompletenessTests,
  ...doctorFreshnessStructuralTests,
  ...acdDoctorFindingEnvelopeTests,
  ...acdDoctorEngineDeterminismTests,
  ...acdDoctorStrictExitTests,
  ...acdDoctorValidateKeystoneTests,
  ...doctorContextBudgetTests,
  ...acdContextBudgetFindingTests,
  ...acdContextBudgetConfigSourcedTests,
  ...acdCliEntryExecutesTests,
  ...notionSpineCommandTests,
  ...notionSpineOptinNoopTests,
  ...notionMappingSidecarTests,
  ...notionProjectionPlanTests,
  ...notionApplyIdempotentTests,
  ...notionDryRunTests,
  ...notionStatusMapSkipTests,
  ...notionConfigSchemaTests,
  ...notionDescriptorTests,
  ...notionAuthEnvTests,
  ...notionDoctorTests,
  ...acdNotionMappingSidecarTests,
  ...acdNotionOneWayTests,
  ...acdNotionOptInNoopTests,
  ...acdNotionAuthEnvRefTests,
  ...acdNotionNoSchemaWriteTests,
  ...acdNotionCliNotMcpTests,
  ...acdNotionFailHonestlyTests,
  ...adapterTests,
  ...renderPlanTests,
  ...configInspectTests,
  ...configEditorTests,
  ...frameworkTests,
  ...cleanTests,
  ...dslPrimitiveTests,
  ...setupUiTests,
  ...schemaTests,
  ...modelTests,
  ...workspaceTests,
  ...pathTests,
  ...promptTests,
  ...catalogTests
];

// Run the suite ONLY when this module is the entry point. The
// acd-roundtrip-registration meta-test imports the assembled `tests` array above
// to verify every arch-test is registered; that import must NOT re-run the suite.
async function runSuite() {
  let failures = 0;

  console.log("# unit");
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(error.stack ?? error.message);
    }
  }

  console.log("# integration");
  const previousInProcess = process.env.AOF_IN_PROCESS_INTEGRATION;
  process.env.AOF_IN_PROCESS_INTEGRATION = "1";
  await import("../test/integration/cli.mjs");

  if (previousInProcess === undefined) {
    delete process.env.AOF_IN_PROCESS_INTEGRATION;
  } else {
    process.env.AOF_IN_PROCESS_INTEGRATION = previousInProcess;
  }

  if (failures > 0 || process.exitCode) {
    process.exitCode = 1;
  }
}

// Invoke WITHOUT a blocking top-level await: the acd-roundtrip-registration
// meta-test resolves the assembled suite by `import()`-ing this module, and a
// pending top-level await here would deadlock that import. Letting runSuite()
// run on its own keeps the event loop alive until it settles and sets the exit
// code, while the module's evaluation completes immediately for importers.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  runSuite().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
