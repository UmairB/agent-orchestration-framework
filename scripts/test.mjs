import { pathToFileURL } from "node:url";
import { adapterTests } from "../test/adapters.test.mjs";
import { catalogTests } from "../test/catalog.test.mjs";
import { pathTests } from "../test/paths.test.mjs";
import { promptTests } from "../test/prompt.test.mjs";
import { modelTests } from "../test/model.test.mjs";
import { workspaceTests } from "../test/workspace.test.mjs";
import { globalWorkStoreTests } from "../test/global-work-store.test.mjs";
import { globalWorkPropagationTests } from "../test/global-work-propagation.test.mjs";
import { globalNodeRegistryTests } from "../test/global-node-registry.test.mjs";
import { archTests as acdGlobalMeshPathsHomeTests } from "../test/arch/acd-global-mesh-paths-home.test.mjs";
import { archTests as acdGlobalStoreNoNativeDepTests } from "../test/arch/acd-global-store-no-native-dep.test.mjs";
import { archTests as acdGlobalPropagationSinglePredicateTests } from "../test/arch/acd-global-propagation-single-predicate.test.mjs";
import { archTests as acdGlobalPublisherSingleSeamTests } from "../test/arch/acd-global-publisher-single-seam.test.mjs";
import { archTests as acdGlobalNodeDescriptorsRedactSecretsTests } from "../test/arch/acd-global-node-descriptors-redact-secrets.test.mjs";
import { archTests as acdGlobalNodeRegistryProjectionOnlyTests } from "../test/arch/acd-global-node-registry-projection-only.test.mjs";
// milestone 34 / story 04 — worker live-state stream to control node (ADR-007): the
// worker-role/control-address resolution, the persistent worker stream client
// (snapshot-first-then-deltas, reconnect+backoff, failure isolation), the always-on
// control-node stream server (tailnet-only admission, apply+redact, liveness), and
// the stream retry/reconciliation/freshness lanes, plus the story's 4 fitness
// units. Tasks 00–03 are @executable; task 04 (the real two-machine soak) is @manual
// and deliberately has no test file here.
import { workerRoleAddressTests } from "../test/worker-role-address.test.mjs";
import { workerStreamClientTests } from "../test/worker-stream-client.test.mjs";
import { controlStreamServerTests } from "../test/control-stream-server.test.mjs";
import { meshLauncherStreamRoleTests } from "../test/mesh-launcher-stream-role.test.mjs";
import { meshLauncherLockTests } from "../test/mesh-launcher-lock.test.mjs";
import { globalNodeIdentityTests } from "../test/global-node-identity.test.mjs";
import { archTests as acdGlobalNodeIdentityHomeTests } from "../test/arch/acd-global-node-identity-home.test.mjs";
import { archTests as acdWorkerStreamSinglePredicateTests } from "../test/arch/acd-worker-stream-single-predicate.test.mjs";
import { archTests as acdWorkerStreamFabricAddressedTests } from "../test/arch/acd-worker-stream-fabric-addressed.test.mjs";
import { archTests as acdWorkerStreamNonBlockingTests } from "../test/arch/acd-worker-stream-non-blocking.test.mjs";
import { archTests as acdControlStreamTailnetOnlyTests } from "../test/arch/acd-control-stream-tailnet-only.test.mjs";
import { archTests as acdControlStreamAddressBoundTests } from "../test/arch/acd-control-stream-address-bound.test.mjs";
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
// milestone 25 / story 00 — the `aof work board` → `aof work ui` serve-verb rename
// (task 00: the verb surface; task 01: the board serves the frozen /api/work envelope
// unchanged under the renamed verb). ADR-001.
import { workUiVerbRenameTests } from "../test/work-ui-verb-rename.test.mjs";
import { workUiBoardServesUnchangedTests } from "../test/work-ui-board-serves-unchanged.test.mjs";
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
// story 29 — migrate-command (the migrate:folder command — convert a source folder
// INTO a managed milestone under work.dir; @executable traceability across the four
// task features, the @manual architect-judgement / real-world-folder rows deferred)
// PLUS the two story arch-tests: the migrate:* command-cli bijection and the
// read-only-source boundary (no git write verb / no fs write into the source; the
// source tree byte-for-byte unchanged after a run).
import { migrateCommandCoreTests } from "../test/migrate-command-core.test.mjs";
import { archTests as acdMigrateCommandCliBijectionTests } from "../test/arch/acd-migrate-command-cli-bijection.test.mjs";
import { archTests as acdMigrateReadOnlySourceTests } from "../test/arch/acd-migrate-read-only-source.test.mjs";
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
// milestone 18 — per-folder integration descriptor (story 00: the AUTHORING SPINE —
// the new src/integrations/routing.mjs reader/resolver (ADR-001/002/003), the boards
// registry schema oneOf with the flat m17 back-compat arm at the Ajv-2020 seam
// (ADR-002), and the notion:associate rewrite writing/clearing the per-folder
// .integrations.json descriptor as its ONLY mutation (ADR-004/006); all @executable).
// NOTE: the prior frontmatter-mechanism tests (notion-associate*, notion-parents-schema)
// were superseded here and the arch-test FFs (FF-A..F) are authored in story 02.
import { integrationsRoutingReaderTests } from "../test/integrations-routing-reader.test.mjs";
import { integrationsBoardsRegistryTests } from "../test/integrations-boards-registry.test.mjs";
import { integrationsAssociateTests } from "../test/integrations-associate.test.mjs";
// milestone 18 — per-folder integration descriptor (story 01: the CONSUMPTION side —
// the projection reads routing via story 00's resolver and addresses the chosen board's
// dataSourceId, nesting the milestone under its resolved parent via that board's
// relationProperty (ADR-003); no descriptor/parent ⇒ byte-for-byte the m17 projection
// (the no-regression invariant); the v2 multi-board per-data-source sidecar (ADR-005),
// with v1 migration; all @executable. The STRUCTURAL invariants (FF-A/FF-C/FF-D) are
// arch-tests authored in story 02 — the frontmatter-projection tests they supersede
// (notion-parent-projection, acd-notion-parent-projection, acd-notion-association-committed)
// are deleted+unwired HERE as their mechanism is removed by the projection rewrite.)
import { integrationsProjectionBoardRoutingTests } from "../test/integrations-projection-board-routing.test.mjs";
import { integrationsProjectionParentNestingTests } from "../test/integrations-projection-parent-nesting.test.mjs";
import { integrationsMultiboardSidecarTests } from "../test/integrations-multiboard-sidecar.test.mjs";
// milestone 18 — per-folder integration descriptor (story 02: the CLEANUP + FITNESS
// story — the src/work.mjs parseScalarOrCollection revert (drop the `{}` inline-flow-map
// branch, ADR-007) + the notion-top-level `parents` removal, locked by the two task
// feature tests; and the SIX milestone fitness invariants FF-A..F authored here, atomically
// with deleting the five superseded arch-tests (acd-notion-associate-frontmatter-only,
// -association-committed, -parent-no-read, -parent-projection, -parents-schema) and their
// behavioural tests. FF-A descriptor-committed (supersedes -association-committed); FF-B
// reader-is-JSON + the revert (new); FF-C board-resolution + the m17 no-regression arm
// (subsumes -parent-projection); FF-D no-Notion-read + the one-way snapshot (supersedes
// -parent-no-read); FF-E descriptor-extensible (supersedes -parents-schema's extensibility);
// FF-F boards-registry schema at the Ajv-2020 seam (supersedes -parents-schema). KEPT:
// acd-notion-one-way (reaffirmed by FF-D) + acd-notion-mapping-sidecar (re-pointed by story 01).
import { integrationsParserRevertedTests } from "../test/integrations-parser-reverted.test.mjs";
import { integrationsLegacyRemovedTests } from "../test/integrations-legacy-removed.test.mjs";
import { archTests as acdIntegrationsDescriptorCommittedTests } from "../test/arch/acd-integrations-descriptor-committed.test.mjs";
import { archTests as acdIntegrationsReaderIsJsonTests } from "../test/arch/acd-integrations-reader-is-json.test.mjs";
import { archTests as acdIntegrationsBoardResolutionTests } from "../test/arch/acd-integrations-board-resolution.test.mjs";
import { archTests as acdIntegrationsNoNotionReadTests } from "../test/arch/acd-integrations-no-notion-read.test.mjs";
import { archTests as acdIntegrationsDescriptorExtensibleTests } from "../test/arch/acd-integrations-descriptor-extensible.test.mjs";
import { archTests as acdIntegrationsBoardsSchemaTests } from "../test/arch/acd-integrations-boards-schema.test.mjs";
// milestone 19 — work-run-lifecycle (story 00: run-store — the SPINE src/run-store.mjs:
// the per-run JSON store under runs/ (ADR-002 path seam runsDir/runRecordPath), the frozen
// run-record schema (ADR-003), and the state-machine transition table (ADR-001). The three
// task features (00_run-record-store / 01_state-machine / 02_derived-log-lifecycle) +
// the three fitness arch-tests — derived-record invariant (FF#1, prune AND rebuild),
// write-scope guard (FF#2), partition-ready layout (FF#3).
import { runStoreRecordTests } from "../test/run-store-record.test.mjs";
import { runStoreStateMachineTests } from "../test/run-store-state-machine.test.mjs";
import { runStoreDerivedLogTests } from "../test/run-store-derived-log.test.mjs";
import { archTests as acdRunRecordDerivedTests } from "../test/arch/acd-run-record-derived.test.mjs";
import { archTests as acdRunWriteScopeTests } from "../test/arch/acd-run-write-scope.test.mjs";
import { archTests as acdRunPartitionReadyTests } from "../test/arch/acd-run-partition-ready.test.mjs";
// milestone 19 — work-run-lifecycle (story 01: run-commands — the three work:run-*
// commands (run-start/run-complete/run-status, ADR-003) registered into the SAME
// core + the CLI `work run-*` dispatch/--json face; each a thin wrapper over story
// 00's src/run-store.mjs. The three task features (00_run-commands in-process via
// invoke / 01_cli-face via real CLI spawn / 02_lifecycle-survives-restart via fresh
// CLI processes); the bijection extension (fitness #4) is the EXTENDED
// acd-work-command-cli-bijection arch-test already wired above.
import { runCommandsTests } from "../test/run-commands.test.mjs";
import { runCliFaceTests } from "../test/run-cli-face.test.mjs";
import { runLifecycleRestartTests } from "../test/run-lifecycle-restart.test.mjs";
// milestone 20 — autonomous-run-resilience (story 00: resilience-core — the run-store
// resilience spine: the four additive record keys (ADR-001), the closed classification
// table + attempt ceiling (ADR-002), the retry-lineage mint (ADR-003 store side), the
// heartbeat + path-walking orphan-reclaim scan (ADR-004), the dedup guard +
// collision-safe mint (ADR-006), and the atomic persist (ADR-007). Five @executable
// behavioural test files + five fitness-function arch-tests.
import { runResilienceRecordKeysTests } from "../test/run-resilience-record-keys.test.mjs";
import { runFailureClassificationTests } from "../test/run-failure-classification.test.mjs";
import { runRetryLineageTests } from "../test/run-retry-lineage.test.mjs";
import { runHeartbeatReclaimTests } from "../test/run-heartbeat-reclaim.test.mjs";
import { runDedupAtomicPersistTests } from "../test/run-dedup-atomic-persist.test.mjs";
import { archTests as acdRunRetryClassificationTests } from "../test/arch/acd-run-retry-classification.test.mjs";
import { archTests as acdRunRetryResumesLineageTests } from "../test/arch/acd-run-retry-resumes-lineage.test.mjs";
import { archTests as acdRunReclaimStaleOnlyTests } from "../test/arch/acd-run-reclaim-stale-only.test.mjs";
import { archTests as acdRunPersistAtomicTests } from "../test/arch/acd-run-persist-atomic.test.mjs";
import { archTests as acdRunDedupNoDuplicateTests } from "../test/arch/acd-run-dedup-no-duplicate.test.mjs";
// milestone 20 — autonomous-run-resilience (story 01: resilience-commands — work:run-retry
// (command + CLI face, ADR-003), the --reason producer half on work:run-complete (ADR-001/002),
// rollbackItemStatus the first item-status writer (ADR-005), and the outsider-verifiable
// CLI acceptance. Five @executable behavioural test files + one new bounding fitness function
// (acd-status-rollback-bounded); the acd-run-retry-resumes-lineage arch-test (imported above)
// gains a command-path test object riding the same import.
import { runRetryCommandTests } from "../test/run-retry-command.test.mjs";
import { runRetryCliFaceTests } from "../test/run-retry-cli-face.test.mjs";
import { runStatusRollbackTests } from "../test/run-status-rollback.test.mjs";
import { runResilienceAcceptanceTests } from "../test/run-resilience-acceptance.test.mjs";
import { runCompleteReasonTests } from "../test/run-complete-reason.test.mjs";
import { archTests as acdStatusRollbackBoundedTests } from "../test/arch/acd-status-rollback-bounded.test.mjs";
// milestone 21 — board-run-observability. story 00 (run-observability): the
// additive /api/work/run-status read route (the server-side @executable scenarios)
// + the PURE run-observability helpers (relative-time formatter, current-run
// selection, the run-state chip ramp) shared headlessly. story 01
// (rerun-affordance): the pure rerun verb-resolution + the in-flight disabled
// predicate. The read-path fitness functions are EXTENSIONS of existing m08/m15
// guards (acd-work-command-route-coverage drops run-status from BOARD_DEFERRED;
// acd-board-write-isolation extended to the run/rerun surface) — already wired
// above; milestone 21 adds NO new arch-test file (21/ADR-003).
import { boardRunStatusRouteTests } from "../test/board-run-status-route.test.mjs";
import { boardRunsPureTests } from "../test/board-runs-pure.test.mjs";
// milestone 22 — mesh-foundation (story 00: mesh-store spine + face skeleton — the
// SPINE src/mesh-store.mjs: the partition path seam meshDir/nodeRecordPath (ADR-002),
// the frozen node-record schema's OPAQUE per-node persist/read (ADR-003) through the
// atomic writeText seam (19/R2), plus the greenfield `aof mesh` CLI dispatcher
// SKELETON (meshCommand in cli.mjs, ADR-001). Three task features (00_mesh-record-store
// / 01_path-partition-convention / 02_aof-mesh-face-skeleton) + the three fitness
// arch-tests — partition-write (FF#1), write-scope guard (FF#2), and the NEW
// registry-derived mesh-namespace bijection gate (FF#3, RED-until-commands, vacuous now).
import { meshRecordStoreTests } from "../test/mesh-record-store.test.mjs";
import { meshPartitionConventionTests } from "../test/mesh-partition-convention.test.mjs";
import { meshFaceSkeletonTests } from "../test/mesh-face-skeleton.test.mjs";
import { archTests as acdMeshPartitionWriteTests } from "../test/arch/acd-mesh-partition-write.test.mjs";
import { archTests as acdMeshWriteScopeTests } from "../test/arch/acd-mesh-write-scope.test.mjs";
import { archTests as acdMeshCommandCliBijectionTests } from "../test/arch/acd-mesh-command-cli-bijection.test.mjs";
// milestone 25 — mesh-ui (Decide-stage arch tests, ADR-001/002/003): the board→ui
// rename-complete XOR gate + the single-fleet-data-command gate. Both are vacuous-safe
// (green on the current tree) and tighten as milestone 25's code lands.
import { archTests as acdWorkUiRenameCompleteTests } from "../test/arch/acd-work-ui-rename-complete.test.mjs";
import { archTests as acdMeshUiSingleDataCommandTests } from "../test/arch/acd-mesh-ui-single-data-command.test.mjs";
// milestone 25 — mesh-ui (story 01: the fleet data model + the `aof mesh status` CLI
// mirror — mesh:status EXTENDED with a boards projection joining the m24 registry to
// each board's active runs). Three @executable task features: 00_boards-projection
// (the aggregate shape + the joins + the pure read), 01_mesh-status-render (the human
// text + the boards section + --json purity), 02_graceful-degradation (absent / torn /
// foreign-shaped / empty registry + stale + ownerless + non-local). The
// acd-mesh-ui-single-data-command gate tightens: mesh-identity.mjs is now the SOLE
// fleet-data joiner (readRegistry + readNodeRecords).
import { meshFleetBoardsProjectionTests } from "../test/mesh-fleet-boards-projection.test.mjs";
import { meshStatusFleetRenderTests } from "../test/mesh-status-fleet-render.test.mjs";
import { meshFleetGracefulDegradationTests } from "../test/mesh-fleet-graceful-degradation.test.mjs";
// milestone 25 — mesh-ui (story 02: the read-only fleet web surface — the NEW
// src/mesh-ui-serve.mjs thin serve-face (a board-serve.mjs sibling) behind the
// CLI-only `aof mesh ui` verb; one 127.0.0.1 server on default port 4181 serving
// ui/dist with ?mode=fleet + the single GET /api/mesh/status route
// (invoke("mesh:status")). One @executable task feature (00_mesh-ui-serve): the verb
// stands up ONE server, /api/mesh/status deep-equals `aof mesh status --json`, the
// /api/mesh namespace is disjoint from /api/work, unknown-route + missing-bundle +
// occupied-port are friendly refusals. The three SPECIFY'd face guards now activate
// against the as-built module: acd-mesh-ui-no-core-import (only ./command-core.mjs +
// no fs write), acd-mesh-ui-single-server (one http.createServer on 127.0.0.1;
// /api/mesh* never /api/work*), acd-mesh-ui-write-isolation (zero fs write / no
// shell-out / no /ws/terminal / no write route). The phase-2 half of
// acd-mesh-ui-single-data-command activates now the module exists (it invoke's
// mesh:status, imports no mesh-core module).
import { meshUiServeTests } from "../test/mesh-ui-serve.test.mjs";
// Spawn-level coverage for the `aof mesh ui` CLI verb (meshUiCommand, cli.mjs) — the
// verb-face the in-process serveMeshUi tests don't reach: the human announce line, the
// default-port (4181) bind, --port override, and the exact EADDRINUSE refusal + exit 1.
import { meshUiCliFaceTests } from "../test/mesh-ui-cli-face.test.mjs";
// The server-observable @executable halves of tasks 03/04/05 (the fleet face issues
// no /api/work on a drill-in; the client opens no event stream / a ws upgrade is
// refused; a write-method is a clean method-rejection with no state change; serving
// mutates no file). The rendered-view @manual halves + the Playwright browser lane
// are QA-owned, judged at Review.
import { meshUiReadOnlyContractTests } from "../test/mesh-ui-read-only-contract.test.mjs";
import { archTests as acdMeshUiNoCoreImportTests } from "../test/arch/acd-mesh-ui-no-core-import.test.mjs";
import { archTests as acdMeshUiSingleServerTests } from "../test/arch/acd-mesh-ui-single-server.test.mjs";
import { archTests as acdMeshUiWriteIsolationTests } from "../test/arch/acd-mesh-ui-write-isolation.test.mjs";
// milestone 34 / story 03 — mesh UI global scope (ADR-006): `aof mesh ui` /
// `/api/mesh/status` default to the GLOBAL projection query (src/global-mesh-
// query.mjs, the ONE composition seam over the story 00/02 query surfaces);
// `--local` (or `?scope=local`) keeps the pre-existing invoke("mesh:status")
// current-workspace aggregate, byte-unchanged. Four @executable task features:
// 00_cli-scope-selection, 01_mesh-ui-api-scope-switch, 02_fleet-ui-scope-
// rendering, 03_empty-error-and-health-states. Three fitness units:
// acd-mesh-ui-global-default, acd-mesh-ui-local-filter-preserves-status,
// acd-mesh-ui-scope-visible. The React fleet surface's scope/region/state/
// credential-guard logic lives in the pure ui/src/fleet/scope.mjs helper (no
// React test harness in this repo), exercised headlessly by fleet-scope.test.mjs.
import { globalMeshQueryTests } from "../test/global-mesh-query.test.mjs";
import { meshUiGlobalScopeTests } from "../test/mesh-ui-global-scope.test.mjs";
import { fleetScopeTests } from "../test/fleet-scope.test.mjs";
import { archTests as acdMeshUiGlobalDefaultTests } from "../test/arch/acd-mesh-ui-global-default.test.mjs";
import { archTests as acdMeshUiLocalFilterPreservesStatusTests } from "../test/arch/acd-mesh-ui-local-filter-preserves-status.test.mjs";
import { archTests as acdMeshUiScopeVisibleTests } from "../test/arch/acd-mesh-ui-scope-visible.test.mjs";
// milestone 27 issuance/routing write surfaces are retired for the global WebSocket-only mesh cleanup.
// milestone 33 — mesh relay/transport redesign (Tailscale-first). Two Decide-stage
// fitness functions. acd-mesh-identity-not-committed (F-3203 / ADR-004 — no per-install
// nodeId/salt in committed config) is UN-SKIPPED + GREEN (story 00 / per-install-node-
// identity migrated the committed .aof/aof.config.json's mesh.nodeId/mesh.salt to the
// git-ignored sidecar .aof/mesh/identity.json via migrateIdentity — its Definition-of-Done).
// acd-fabric-single-seam (F-3202/F-3204 / ADR-001/002 — the tailscale spawn + peer-address
// resolution live only in src/mesh-fabric.mjs) is UN-SKIPPED + GREEN (story 01 / fabric-
// native-transport built src/mesh-fabric.mjs as the sole seam and removed the broker's
// liveness-path callers — its Definition-of-Done).
import { archTests as acdMeshIdentityNotCommittedTests } from "../test/arch/acd-mesh-identity-not-committed.test.mjs";
import { archTests as acdFabricSingleSeamTests } from "../test/arch/acd-fabric-single-seam.test.mjs";
// milestone 33 (story 01) — fabric-native transport + coordination launcher. task 00
// (00_fabric-seam.feature): src/mesh-fabric.mjs's probeFabric/selfAddress/resolvePeers
// over an injected fabric-exec closure — the two-stage refusal-reason matrix, the Windows
// install-path fallback, the HostName/DNSName join matrix, the non-tailscale/undeclared
// clean refusals. task 01 (01_fabric-liveness-cutover.feature): mergePresence reconciling
// disk vs the fabric peer-map liveness (git wins a tie), mesh:status sourcing a live
// candidate off the fabric Online pre-filter via INJECTED ctx.fabricPeers, the
// Online-≠-dialable handled outcomes (resolvePeerReachability, an injected dial closure),
// the presence record assembly/read staying byte-unchanged, the unconfigured-mesh floor.
import { meshFabricSeamTests } from "../test/mesh-fabric-seam.test.mjs";
import { meshFabricLivenessCutoverTests } from "../test/mesh-fabric-liveness-cutover.test.mjs";
// milestone 33 (story 01) — fabric-native transport + coordination launcher: task 02
// (02_broker-retirement.feature, dedicated behavioural coverage, review Fix 5) — a
// node's presence/liveness view fully populated with the broker never started (over
// invoke("mesh:status", …, { fabricPeers }), no serveRelay/mesh-registry call anywhere
// in the test's own control flow); a peer's liveness visible with NO device-code
// enrollment / ws upgrade auth-gate; presence still renders from the reused git floor
// with neither broker nor fabric configured; plus a structural confirmation that
// mesh-identity.mjs imports no relay/broker module (a real source read).
import { meshBrokerRetirementTests } from "../test/mesh-broker-retirement.test.mjs";
// milestone 33 (story 01) — fabric-native transport + coordination launcher: task 03
// (03_coordination-launcher.feature): src/mesh-launcher.mjs's launcherProbe (the
// NON-BLOCKING mesh:serve registered-run shape) + startLauncher (the --serve daemon —
// preflight-refuse-with-guidance, publish presence, the reused sync loop, the peer-poll
// ticker, the observable stop() seam for SIGINT/SIGTERM) over an injected fabric-exec +
// injected tickers — no tailnet, no wall-clock wait. task 04 (04_operator-guidance
// .feature): src/mesh-fabric.mjs's fabricGuidance/remediationForReason/
// macOsAppStoreSplitWarning — the healthy-tailscale guidance, the per-BackendState
// remediation matrix, the macOS App-Store-CLI-split warn over an injected platform, and
// work doctor (src/commands/doctor.mjs) surfacing the SAME remediation, silent when the
// mesh fabric is unconfigured.
import { meshCoordinationLauncherTests } from "../test/mesh-coordination-launcher.test.mjs";
import { meshOperatorGuidanceTests } from "../test/mesh-operator-guidance.test.mjs";
// milestone 33 (story 00) — per-install-node-identity: the four @executable task
// features (00_identity-sidecar-persist / 01_loadworkspace-hydration /
// 02_backcompat-migrate-doctor / 03_self-heal-hostname-mismatch). Task 04
// (cross-os-distinct-identity) is @manual real-hardware — no test, verified at
// aof:verify.
import { identitySidecarPersistTests } from "../test/identity-sidecar-persist.test.mjs";
import { loadworkspaceHydrationTests } from "../test/loadworkspace-hydration.test.mjs";
import { backcompatMigrateDoctorTests } from "../test/backcompat-migrate-doctor.test.mjs";
import { selfHealHostnameMismatchTests } from "../test/self-heal-hostname-mismatch.test.mjs";
// milestone 22 — mesh-foundation (story 01: node-identity + commands — src/node-identity.mjs
// derives the stable, human-readable node id + assembles the frozen 7-key capability
// descriptor (ADR-003); src/commands/mesh-identity.mjs registers mesh:identity (publish/
// read this node) + mesh:status (the synced roster) into the SAME core (ADR-001), thin
// over story 00's mesh-store; the aof mesh identity/status dispatch branches + meshVerbCli
// face in cli.mjs. Three task features: 00_node-identity-descriptor (in-process node
// identity, injected hostname/salt), 01_mesh-identity-status-commands (invoke the commands
// against a temp fixture), 02_mesh-identity-cli-face (spawn the real CLI — render + --json
// single envelope + the error-code matrix). The acd-mesh-command-cli-bijection gate now
// covers identity+status (extended above).
import { meshNodeIdentityTests } from "../test/mesh-node-identity.test.mjs";
import { meshIdentityStatusCommandsTests } from "../test/mesh-identity-status-commands.test.mjs";
import { meshIdentityCliFaceTests } from "../test/mesh-identity-cli-face.test.mjs";
// milestone 22 — mesh-foundation (story 02: git-sync engine — src/mesh-sync.mjs is the
// PAYLOAD-AGNOSTIC git transport (syncMesh) + the background-loop runner (startSyncLoop,
// a thin timer over the one-shot transport); src/commands/mesh-sync.mjs registers
// mesh:sync into the SAME core (ADR-004), thin over the transport; the aof mesh sync
// dispatch branch + argsFor case in cli.mjs. Two @executable task features:
// 00_git-sync-transport (the transport over a REAL local bare-remote git fixture —
// commit+push, the clean no-op, pull a peer, the payload-agnostic outline, the add-only
// merge), 01_sync-cadence-loop (the loop over an INJECTED ticker — once-per-tick, the
// valid/malformed cadence outlines, batching, cadence read-at-start). The @manual
// 02_two-node-render-over-remote feature gets NO executable test (verified at aof:verify).
// Fitness #4 acd-mesh-sync-record-neutral asserts the engine moves files not fields. The
// acd-mesh-command-cli-bijection gate now covers identity+status+sync.
// milestone 23 — control-node-relay (story 00: presence-heartbeat — src/mesh-presence.mjs
// is the presence-record assembly + the node-staleness predicate (reusing m20's isStale
// shape) + the activeRuns read of the run records; src/commands/mesh-heartbeat.mjs
// publishes THIS node's presence git-only via the m22-reserved presenceRecordPath;
// mesh:status is EXTENDED in mesh-identity.mjs to render presence + a stale flag. Two
// @executable task features: 00_presence-record (the publish + the frozen schema +
// byte-equivalence + rebuildability + republish-untouched-peer), 01_node-staleness-and-
// status (the strict-`>` staleness boundary + the documented-default threshold + the
// never-beat no-presence rule + the stable --json shape). The @manual 02_presence-over-git
// feature gets NO executable test (verified at aof:verify). Fitness #3
// acd-presence-write-scope (every presence write joins the reserved seam + routes through
// writeText + references zero record-doc) + fitness #6 acd-mesh-eol-pinned (the .mesh/**
// eol=lf pin, the 22/R5 carry-forward). The acd-mesh-command-cli-bijection gate now covers
// identity+status+sync+heartbeat.
import { meshPresenceRecordTests } from "../test/mesh-presence-record.test.mjs";
import { meshNodeStalenessStatusTests } from "../test/mesh-node-staleness-status.test.mjs";
import { archTests as acdPresenceWriteScopeTests } from "../test/arch/acd-presence-write-scope.test.mjs";
import { archTests as acdMeshEolPinnedTests } from "../test/arch/acd-mesh-eol-pinned.test.mjs";
// milestone 23 — control-node-relay (story 01: thin relay — src/mesh-relay.mjs is the
// stateless ws@8 broker shipped as a `relay` mode (serveRelay → { server, url, stop }),
// carrying the FROZEN, payload-agnostic envelope { kind, nodeId, signal } fanned out to
// the OTHER peers (no self-echo) in memory only; the never-crash { type:'error' }
// control-frame on a malformed/oversized frame (the hand-rolled maxFrameBytes check); and
// relayMode, the in-process config gate (serves only when controlNode === nodeId). The
// `aof mesh relay` verb is registered with a NON-BLOCKING status probe (--json returns).
// Three @executable task features: 00_relay-broker-fanout (the serve-unit + fan-out +
// in-memory-only + late-joiner + clean stop()), 01_relay-envelope-and-resilience (the
// payload-agnostic forwarding outline + the bad-frame resilience matrix + peer-disconnect),
// 02_control-node-role (the config gate + re-nomination-by-config + lose-liveness-not-data).
// milestone 33 / story 01 (ADR-002 — the broker is ELIMINATED as the presence/liveness
// transport): fitness #1 acd-relay-stateless and fitness #2 acd-relay-envelope-neutral
// (siblings of acd-relay-auth-gate-checked, ADR-002's fitness ledger) are RETIRED —
// superseded by 33/ADR-002 — the broker is eliminated. The serve-unit discipline
// (meshRelayBrokerFanoutTests / meshRelayEnvelopeResilienceTests / meshRelayControlNodeTests)
// stays green — mesh-relay.mjs's serve-unit shape is REUSED by the ADR-003 launcher, only
// its role as the liveness transport is retired.
import { meshRelayBrokerFanoutTests } from "../test/mesh-relay-broker-fanout.test.mjs";
import { meshRelayEnvelopeResilienceTests } from "../test/mesh-relay-envelope-resilience.test.mjs";
import { meshRelayControlNodeTests } from "../test/mesh-relay-control-node.test.mjs";
// milestone 23 — control-node-relay (story 02: presence-over-relay). The cadence loop
// (src/mesh-presence-loop.mjs — a thin timer over the one-shot publish, the m22
// startSyncLoop split, config.mesh.presence.cadenceSeconds + the documented default)
// stays; the loop's git-durability half was never relay-dependent (ADR-002.4).
// milestone 33 / story 01 (ADR-002.1 — F-3204): the TWO-PUBLISH path (git unconditional +
// the relay best-effort push) is RETIRED from src/commands/mesh-heartbeat.mjs — superseded
// by 33/ADR-002 — the broker is eliminated. meshPresenceDualBusTests (task
// 00_dual-bus-publish's whole subject) and fitness #4 acd-presence-relay-independent (the
// two-publish control-flow grep) are RETIRED with it; meshPresenceDegradationLoopTests is
// TRIMMED to its cadence-loop-only scenarios (the relay-down/relay-restored rows retired
// alongside the push).
import { meshPresenceDegradationLoopTests } from "../test/mesh-presence-degradation-loop.test.mjs";
// milestone 23 — control-node-relay (story 02: presence-over-relay — task 03, finding F1).
// milestone 33 / story 01 (ADR-002.1 — F-3204): the node-side PERSISTENT relay SUBSCRIBER
// (src/mesh-presence-subscriber.mjs) + the in-memory liveness cache
// (src/mesh-presence-cache.mjs) are DELETED outright — no consumer remains once the fabric
// peer-map (src/mesh-fabric.mjs's resolvePeers) is the fast liveness read mesh:status
// consumes instead (src/commands/mesh-identity.mjs's ADR-002.1 cutover). mergePresence
// itself (src/mesh-presence.mjs) is UNCHANGED — only its caller's second-argument SOURCE
// re-points from the retired relay cache to the fabric peer-map liveness (see
// test/mesh-fabric-liveness-cutover.test.mjs, task 01). meshRelayReceiveApplyTests (task
// 03's whole subject) and fitness #7 acd-presence-subscriber-cache-only are RETIRED —
// superseded by 33/ADR-002 — the broker is eliminated.
// milestone 24 — device-code group-enrollment (SECURITY.md / the threat model's security
// fitness functions — RED-until-built, the enrollment/registry/relay-auth modules do not
// exist yet). The trust boundary IS this milestone (23/ADR-001 §Security-posture deferred
// it here). Three security invariants: (T3) the pending device code is stored HASHED at
// rest — never plaintext committed to the git-of-record registry; (T4/T2) the code match
// is SINGLE-USE (consumed) + CONSTANT-TIME (timingSafeEqual, no `===` timing oracle on the
// 10^6 space); (T1/T6) the relay ws auth-gate REJECTS an absent/invalid/revoked credential,
// reading the LIVE roster/revocation BEFORE a signal is brokered (the 22/R6 'the credential
// is actually used' guard + the pre-auth→authenticated relay transition). Each carries the
// m03 non-vacuous self-check. From: story 00 (registry) / 01 (device-code flow) / 02
// (relay-auth + revocation) — see SECURITY.md's fitness table for the per-story ownership.
import { archTests as acdEnrollmentCodeHashedAtRestTests } from "../test/arch/acd-enrollment-code-hashed-at-rest.test.mjs";
import { archTests as acdEnrollmentCodeSingleUseConstantTimeTests } from "../test/arch/acd-enrollment-code-single-use-constant-time.test.mjs";
// (T1/T6) the relay ws auth-gate — milestone 33 / story 01 (ADR-002.consequence):
// acd-relay-auth-gate-checked is RETIRED. It guarded the ws upgrade auth-gate as the
// admission boundary; ADR-002 makes "already on the tailnet" the admission boundary
// instead, so this guard now asserts an enforcement mechanism that is no longer
// load-bearing. superseded by 33/ADR-002 — the broker is eliminated.
// milestone 24 — device-code group-enrollment (ARCHITECTURE.md / the STRUCTURAL fitness
// functions — the architect's, disjoint from the SECURITY.md crypto/enforcement fitness
// above). RED-until-built (src/mesh-registry.mjs + src/commands/mesh-{invite,join,revoke}.mjs
// do not exist yet), EXCEPT acd-enroll-endpoint-http-not-ws, which runs GREEN today against
// m23's src/mesh-relay.mjs (the ws envelope is neutral) and stays GREEN when the HTTP
// enrollment route lands — it guards against the WRONG shape (enrollment on a ws kind), not
// the absence of the right one. Three STRUCTURAL invariants: (ADR-1) the group registry has
// EXACTLY ONE control-node-guarded write seam (registry write-scope + single-writer,
// resolving 22/ADR-002's no-aggregate-roster tension); (ADR-2) enrollment is an HTTP route on
// serveRelay's http.createServer, NOT a ws kind (the ws { kind, nodeId, signal } envelope
// stays payload-agnostic); (ADR-3/ADR-4) every git-remote provision/de-provision spawn is the
// shell-less spawnSync("git", [ … ]) argv form (the 13/ADR-002 read-only-source idiom). Each
// carries the m03 non-vacuous self-check. From: story 00 (registry) / 01 (enrollment flow) /
// 02 (trust boundary). SECURITY fitness (hashed-code-at-rest, single-use/constant-time,
// auth-gate enforcement) is authored separately by aof-security above — NOT here.
import { archTests as acdRegistryWriteScopeTests } from "../test/arch/acd-registry-write-scope.test.mjs";
import { archTests as acdEnrollEndpointHttpNotWsTests } from "../test/arch/acd-enroll-endpoint-http-not-ws.test.mjs";
import { archTests as acdEnrollGitArgvNoShellTests } from "../test/arch/acd-enroll-git-argv-no-shell.test.mjs";
// milestone 24 — device-code group-enrollment (story 00: the group registry —
// src/mesh-registry.mjs is the group-level, control-node-owned SINGLE-WRITER second
// git-of-record (ADR-001): registryDir/registryPath under meshDir/registry/, the ONE
// control-node-guarded write seam writeRegistry (atomic writeText, opaque persist —
// a non-authority invocation is a structured no-op), the absence-tolerant
// readRegistry → empty registry, and the PURE add-only aggregate + pending-invite
// accessors (roster append / boards set-add / revocation append / pending append +
// single-use consume + the strict-> TTL read — time always INJECTED, 22/R2). Three
// @executable task features: 00_registry-store-and-seam (round-trip + futureField +
// ENOENT→empty + the control-node truth table + write-scope confinement + the atomic
// interrupted write), 01_roster-boards-revocations (order-preserving admit + board
// set semantics + explicit-deny revocation + add-only byte-unchanged), and
// 02_pending-invite-lifecycle (the codeHash-never-plaintext durable shape +
// single-use consumedAt + the strict-> expiresAt boundary). The @manual
// 03_registry-over-git feature gets NO executable test (verified at aof:verify).
// Fitness acd-registry-write-scope (imported above) turns GREEN with this story.
import { meshRegistryStoreSeamTests } from "../test/mesh-registry-store-seam.test.mjs";
import { meshRegistryAggregateMutationsTests } from "../test/mesh-registry-aggregate-mutations.test.mjs";
import { meshRegistryPendingLifecycleTests } from "../test/mesh-registry-pending-lifecycle.test.mjs";
// milestone 24 — device-code group-enrollment (story 01: device-code enrollment — the
// join flow end-to-end, ADR-002/003/005). src/commands/mesh-invite.mjs registers
// mesh:invite (control-node-guarded MINT: a 6-digit code, hashed through the ONE
// sha256Hex seam, recorded { codeHash, issuedAt, expiresAt, consumedAt:null } via story
// 00's writeRegistry, the plaintext returned ONCE); src/mesh-relay.mjs's
// http.createServer gains the ONE device-flow route POST /enroll ABOVE the 426 fallback
// (match via timingSafeEqual, single-use consume-then-admit in ONE atomic registry
// write, the strict-> TTL check, the EPHEMERAL per-source attempt-cap — ADR-005's
// resolveCodeTtlSeconds/resolveMaxAttempts resolvers, malformed→documented default,
// 300s/5) and issues { relayAuth, nodeId, gitRemote } while the roster stores ONLY
// relayAuthHash (story 02's auth-gate data source); src/commands/mesh-join.mjs registers
// mesh:join <code> (reads config.mesh.relay.url, POSTs, stores config.mesh.credential
// merge-not-clobber, provisions the granted remote via the shell-less
// spawnSync("git", ["remote","add",…]) argv idiom — a rejection stores NOTHING). Three
// @executable task features: 00_mesh-invite-mint (the mint truth table + hashed-at-rest
// shape + TTL arithmetic + the non-control refusal + 6 digits + --json),
// 01_device-code-flow (good code admits+issues+consumes; the expired/consumed/unknown/
// malformed reject matrix; the attempt-cap N-boundary 5-answered/6-refused; resolver
// malformed→default; control-node-offline; ws-envelope-untouched), and
// 02_mesh-join-and-provision (credential merge-not-clobber; the space-url argv-form
// provision; rejection-stores-nothing; --json). The @manual 03_join-end-to-end feature
// gets NO executable test (verified at aof:verify). Fitness: turns
// acd-enrollment-code-hashed-at-rest + acd-enrollment-code-single-use-constant-time
// GREEN; keeps acd-enroll-endpoint-http-not-ws GREEN; the new verbs ride
// acd-mesh-command-cli-bijection; acd-enroll-git-argv-no-shell stays RED until story
// 02 lands src/commands/mesh-revoke.mjs (the gate reads both files).
import { meshInviteMintTests } from "../test/mesh-invite-mint.test.mjs";
import { meshEnrollDeviceFlowTests } from "../test/mesh-enroll-device-flow.test.mjs";
import { meshJoinProvisionTests } from "../test/mesh-join-provision.test.mjs";
// milestone 24 — device-code group-enrollment (story 02: the enforceable trust boundary —
// ADR-003/004). src/mesh-registry.mjs gains the PURE credential-verify seam
// verifyCredential(registry, token) (hash the presented relayAuth, constant-time compare
// against a roster entry's relayAuthHash, AND reject a nodeId in the revocation list — the
// T6 live-read); src/mesh-relay.mjs's server.on("upgrade") handler gains the ADDITIVE ws
// auth-gate ABOVE the pathname router — for a GROUP (non-loopback) connection it reads the
// Authorization-header relayAuth token, verifies it against the LIVE roster/revocation
// (readRegistry(workspace) → verifyCredential) and socket.destroy()s a missing / invalid /
// not-in-roster / REVOKED credential upstream of clients.add, while LOOPBACK stays the m23
// local default (the injectable isGroupConnection seam makes the branch deterministic
// in-process — the STORY.md build note); src/commands/mesh-revoke.mjs registers mesh:revoke
// <node> (control-node-guarded: roster removal + explicit-deny revocation append in ONE
// atomic writeRegistry + git-remote de-provision via the shell-less
// spawnSync("git", ["remote","remove",…]) argv idiom). Two @executable task features:
// 00_relay-auth-gate (the admit/reject matrix + the live-revocation read + loopback default
// + the gate persists nothing) and 01_mesh-revoke (roster removal + revocation append + the
// argv-form de-provision + the auth-gate rejects after revoke + the non-control refusal +
// --json + add-only targeted removal). The @manual 02_revocation-completeness feature gets
// NO executable test (the real-remote push-access half is verified at aof:verify). Fitness:
// turns acd-relay-auth-gate-checked GREEN (the security-owned enforcement gate) +
// acd-enroll-git-argv-no-shell GREEN (mesh-revoke.mjs's de-provision argv form); keeps
// acd-relay-stateless + acd-relay-envelope-neutral + acd-enroll-endpoint-http-not-ws GREEN
// (the gate is a READ + a decision, never a write); the new verb rides
// acd-mesh-command-cli-bijection.
import { meshRelayAuthGateTests } from "../test/mesh-relay-auth-gate.test.mjs";
import { meshRevokeTests } from "../test/mesh-revoke.test.mjs";
// milestone 26 — distributed-runs-leasing (story 00: node-dimensioned run records —
// the git substrate; ADR-001 + ADR-002, no lease, no relay). src/run-store.mjs gains
// the m22-frozen runNodeRecordPath (authority moved here; mesh-store.mjs RE-EXPORTS
// it + RESERVES leaseClaimPath for story 01), the FOURTEEN-key record (20/ADR-001's
// thirteen + the additive `node`, defaulting null — every legacy record reads
// forward), the record-driven persist (record.node ⇒ runs/<node>/, null ⇒ flat —
// byte-identical single-node behaviour), the UNION readers (readRuns/readRun/dedup/
// completeRun span flat + one level of node subdirs; runId uniqueness spans the
// union), and the retired mesh sync root-set path for historical compatibility. Three @executable
// task features: 00_node-dimensioned-records (the mint-placement matrix + the
// single-node floor + read-forward + the union read/torn-skip + cross-node dedup +
// union completion + same-instant distinct ids), 01_sync-root-set (the default-root
// scope matrix + the widened runs pathspec + never-sweeps-operator-edits + the
// branch-wide pull report split + the no-op and failure envelopes in both modes +
// content-agnostic bytes), 02_add-only-run-merge (two REAL clones over a shared bare
// remote — add-only merge, no MERGING state, converged identical unions). Fitness
// #1–#5: acd-run-node-path-single-builder, acd-run-record-node-additive,
// acd-runs-eol-pinned (the 23/R3 git-semantics check over the REAL nested path —
// .gitattributes gained `**/runs/**/*.json text eol=lf`), acd-run-store-mesh-free,
// acd-sync-root-set (which also re-arms the EXTENDED acd-mesh-sync-record-neutral
// over the root-set engine). The five FROZEN_KEYS literals across the run suites
// carry the fourteenth key ("node") — the supersede's sanctioned ripple.
import { runNodePartitionTests } from "../test/run-node-partition.test.mjs";
import { archTests as acdRunNodePathSingleBuilderTests } from "../test/arch/acd-run-node-path-single-builder.test.mjs";
import { archTests as acdRunRecordNodeAdditiveTests } from "../test/arch/acd-run-record-node-additive.test.mjs";
import { archTests as acdRunsEolPinnedTests } from "../test/arch/acd-runs-eol-pinned.test.mjs";
import { archTests as acdRunStoreMeshFreeTests } from "../test/arch/acd-run-store-mesh-free.test.mjs";
import { archTests as acdSyncRootSetTests } from "../test/arch/acd-sync-root-set.test.mjs";
// milestone 26 — distributed-runs-leasing (story 01: the lease-of-record + mesh-aware
// next — GIT-ONLY; ADR-003 + ADR-005, no relay). src/mesh-lease.mjs (NEW) carries the
// frozen six-key claim record { itemRef, nodeId, state, claimedAt, runId, aofVersion },
// the absence-tolerant/torn-skipping claim reads, the presence-tied liveness predicate
// (claimLiveness — presence IS the lease clock, the PO lock: claimed + no-presence =
// leased-unknown, skip NOT reclaimable), the PURE resolveArbitration, own-path hygiene
// (withdrawOwnLapsedClaims), acquireLease/releaseLease/standDown over an INJECTED
// runSync (bounded by the exported MAX_CLAIM_SYNC_ATTEMPTS — ambiguity fails CLOSED),
// and the pure buildLeaseView (disk-first, add-skip-only hint overlay).
// work.mjs:nextWork gains the OPTIONAL { leaseView } third argument (absent ⇒
// byte-identical; leased-live ⇒ skip + the all-leased false-accept guard; leased-stale
// ⇒ ready + { reclaimable, leasedBy }); commands/next.mjs injects the view under the
// config.mesh.nodeId gate; commands/mesh-identity.mjs renders the additive mesh:status
// lease section ({ itemRef, holder, live } — key absent when unconfigured). Four
// @executable task features: 00_lease-claim-and-arbitration (real two-clone git race +
// the scripted-envelope fake), 01_presence-is-the-lease-clock, 02_mesh-aware-next,
// 03_lease-render-on-status. Fitness #6–#8: acd-lease-write-scope,
// acd-next-lease-injected, acd-lease-arbitration-git-observed.
// milestone 26 (story 02) — distributed-runs-leasing: claim integration + relay
// fast-path + fleet reclaim — the A2 join (ADR-004 + ADR-006). work:run-start composes
// the FROZEN sequence in ONE file (fleet-reclaim prefilter → acquireLease over the
// mesh-aware root set, the best-effort pushLeaseSignal riding acquire's onClaimWritten
// slot — claim-write → INTENT → sync, caught-never-thrown → hold ⇒ mint-with-node +
// runId tie-back / stand-down ⇒ no mint + heldBy; the reclaimed-lineage retryOf
// refinement, never the dead peer's sessionId); work:run-complete releases the
// holder's OWN claim on ALL THREE terminal outcomes under the config.mesh gate;
// work:run-retry threads node through the lineage mint (the sanctioned retryRun
// co-edits: node + the sessionId override);
// mesh-relay-client.mjs gains the second wire kind (LEASE_SIGNAL_KIND +
// leaseRelayEnvelope + the propagating pushLeaseSignal — ZERO change to
// mesh-relay.mjs); mesh-presence-cache.mjs gains createLeaseCache (itemRef-keyed,
// latest-wins, in-memory only) and the subscriber the additive lease apply branch.
// Four @executable task features (00_claim-sequence-a2 over a real bare-remote
// two-clone fixture + the injected four-state relay stub; 01_lease-release-on-
// complete; 02_relay-fast-path-defer over ONE shared cache instance + the injected
// transport; 03_fleet-orphan-reclaim — the dual-staleness decision table with
// presence precedence under injected clocks). The @manual 04_kr2-contested-soak
// gets NO executable test (measured at aof:verify on a real two-node fleet).
// Fitness #9/#12: acd-claim-relay-independent, acd-fleet-reclaim-guarded (+ the
// run-complete release-gate half; enumerates the re-armed acd-run-reclaim-stale-only
// / acd-status-rollback-bounded).
// milestone 33 / story 01 (ADR-002.1 — F-3204): task 02_relay-fast-path-defer's
// RECEIVE-side rows (the persistent subscriber applying a lease frame into
// createLeaseCache) are RETIRED with src/mesh-presence-subscriber.mjs +
// src/mesh-presence-cache.mjs — superseded by 33/ADR-002 — the broker is eliminated
// (relayLeaseFastPathTests is TRIMMED to its surviving SEND-side row; fitness
// acd-lease-cache-only, the receive-side cache-only guard, is RETIRED outright — no
// module remains for it to guard). REVIEW FIX (story-01 review): acd-relay-lease-blind
// is ALSO RETIRED here — ADR-002's fitness ledger + STORY.md both name it a sibling of
// the other three relay arch-tests sharing the broker's fate, and serveRelay/relayMode
// are confirmed DEAD code (no live caller) once the broker is eliminated, so this guard
// now protects a broker that no longer brokers — superseded by 33/ADR-002 — the broker
// is eliminated.
import { archTests as acdClaimRelayIndependentTests } from "../test/arch/acd-claim-relay-independent.test.mjs";
import { archTests as acdFleetReclaimGuardedTests } from "../test/arch/acd-fleet-reclaim-guarded.test.mjs";
// milestone 27 (story 00) — work-issuance-routing: the issuance directive
// substrate + the eligibility matcher. src/mesh-issuance.mjs (NEW): the frozen
// six-key directive record { itemRef, issuer, target, state, issuedAt,
// aofVersion } assembled by assembleDirective (the assembleClaimRecord idiom, no
// fs/config/clock), readIssuanceDirectives (the readLeaseClaims walk one level
// deeper across every issuer partition — absence-tolerant, torn-file-skipping,
// flat union), and nodeSatisfiesTarget (ADR-003's pure total predicate over the
// m22-frozen descriptor: any ⇒ true, node ⇒ nodeId match, capability ⇒
// runtimes/skills membership, unknown/malformed ⇒ false — fail-safe). src/mesh-
// store.mjs gains the RESERVED issuanceDirectivePath builder beside
// leaseClaimPath (writes nothing — story 01 builds the writes). Three
// @executable task features: 00_issuance-directive-record (the six-key assembly
// matrix + the union read + absence/torn-file tolerance + the byte-faithful
// round-trip), 01_targeting-matcher (the full truth table + the honest-minimal-
// install floor + the pure-read independence), 02_add-only-directive-merge (two
// REAL clones over a shared bare remote — add-only merge, no MERGING state,
// converged byte-for-byte union, the same-item two-issuer invariant). Fitness #2
// (acd-issuance-record-frozen — the six-key freeze + the EOL-match over the real
// nested issuance sample path, no new .gitattributes rule) + #3
// (acd-targeting-matcher-descriptor-pure — no node-identity.mjs import + the
// matcher reads only nodeId/runtimes/skills, m03 planted-violation self-check).
// milestone 27 routing-era candidacy compatibility tests retained where they do not depend on retired write surfaces.
import { meshCandidacyEveryReturnTests } from "../test/mesh-candidacy-every-return.test.mjs";
// milestone 27 fleet issue/assign write-route tests are retired with the removed fleet write surface.
// story 30 — per-agent model selection (task 01: bundle default map; task 02:
// per-project config override wins + validation; task 03: solo-mode inert map)
import { bundleModelMapTests } from "../test/bundle-model-map.test.mjs";
import { agentModelOverrideTests } from "../test/agent-model-override.test.mjs";
import { agentModelSoloInertTests } from "../test/agent-model-solo-inert.test.mjs";
import { archTests as acdAgentModelSourceMapTests } from "../test/arch/acd-agent-model-source-map.test.mjs";
import { archTests as acdAgentModelRoleDerivationTests } from "../test/arch/acd-agent-model-role-derivation.test.mjs";
// story 31 — migrate-claude-command (the /aof:migrate BUNDLE BODY — the inference
// ceiling over the story-29 mechanical CLI). Task 00's @executable content pins over
// the AUTHORED src/bundle/commands/migrate.md (grep-able marker facts + offset
// ordering, the acd-doctor-validate-keystone idiom) + task 03's distribution matrix
// (descriptor member, derived-manifest byte-for-byte regeneration (ADR-002), work
// update/init landing, never-inited refusal, idempotent skip, dry-run preview,
// ADR-005 drift-preserved / --force-restored). Tasks 01/02 are @manual (agent-run
// at aof:verify) — the body's statements of their contracts carry hardening pins.
import { migrateClaudeCommandTests } from "../test/migrate-claude-command.test.mjs";
// milestone 28 — console-app (story 02: one-line-installer — install.sh (curl|sh)
// + install.ps1 (irm|iex), ADR-006). Three @executable task features:
// 00_os-arch-detect-and-download (the uname/PROCESSOR_ARCHITECTURE→asset-name
// mapping matrix incl. arch aliases + the WOW64 boundary + the 6-class
// unsupported-combo loud-fail matrix), 01_verify-before-path (the 8-outcome
// checksum/GPG verify+refuse matrix against a fixture SHA256SUMS, incl. the F2
// pinned-fingerprint hard requirement), and the developer-owned @executable
// logic underneath 02_place-on-path-and-run (which is itself @uat) — re-install
// idempotence, PATH-persistence idempotence for both scripts, and the loud-fail
// sha256sum/gpg availability probe. Driven via real child-process spawns of
// bash/sh and powershell/pwsh against the real install.sh/install.ps1 sourced
// under a test guard (AOF_INSTALL_TEST) — no fakes; the Linux GPG rows use a
// REAL generated keypair + real gpg --verify.
import { installerDetectTests } from "../test/installer-detect.test.mjs";
import { installerVerifyTests } from "../test/installer-verify.test.mjs";
import { installerPlaceTests } from "../test/installer-place.test.mjs";
// milestone 28 — console-app (story 00: self-contained-binary — ADR-001/002/003/004).
// src/asset-base.mjs is the ONE SEA-safe asset-base seam (assetBase/readAssetText/
// listAssetMembers/packageVersionString, an injectable isPackaged sentinel +
// sidecar anchor mirroring terminal-ws.mjs's injected spawn); all 7 import.meta.url
// sites (work-bundle.mjs's bundleRoot + its readdir/readFile walkers, board-serve.mjs,
// setup-ui.mjs, mesh-ui-serve.mjs, work-bundle-manifest.mjs, commands/mesh-identity.mjs,
// and cli.mjs's dev-only vite re-exec) route through it — dev behaviour byte-for-byte
// unchanged. terminal-ws.mjs's node-pty load re-homes to createRequire(process.execPath)
// under a SEA (dev keeps the dynamic import), factored through the new
// createTerminalSpawn(ptyLoader) seam for in-process testability. cli.mjs gains a
// `--version` argv branch (ADR-004: node mode = everything but mesh relay, an argv
// branch of the SAME run(), never a fork). The greenfield SEA build recipe
// (scripts/sea-entry.mjs, scripts/sea-asset-manifest.mjs, scripts/build-sea.mjs) esbuild-
// bundles the ESM app to CJS (node-pty + the asset trees externalized, asserted from the
// esbuild --metafile), generates the sidecar asset tree, and blobs+postjects a real
// unsigned aof.exe on this reference OS (confirmed manually: --version, mesh relay
// --json, a live PTY over the sidecar, and the missing-sidecar degrade all ran clean).
// Four @executable task features (00_asset-base-seam / 02_native-addon-sidecar /
// 03_single-entry-two-mode @executable; 01_sea-build-recipe is @manual, no test file)
// + the four fitness/build units: acd-sea-safe-asset-base (#1), acd-single-entry-
// command-core (#2), acd-native-addon-degrades (#3), and the build-unit
// bundle-asset-manifest-complete (#4, a set-equality over the real trees vs the
// generator's output). acd-bundle-location is CO-TOUCHED (bundleRoot() now routes
// through assetBase(); the import.meta.url resolution assert re-points at
// src/asset-base.mjs; the cwd-independence asserts stay green).
import { assetBaseSeamTests } from "../test/asset-base-seam.test.mjs";
import { nativeAddonSidecarTests } from "../test/native-addon-sidecar.test.mjs";
import { singleEntryTwoModeTests } from "../test/single-entry-two-mode.test.mjs";
import { bundleAssetManifestCompleteTests } from "../test/bundle-asset-manifest-complete.test.mjs";
import { archTests as acdSeaSafeAssetBaseTests } from "../test/arch/acd-sea-safe-asset-base.test.mjs";
import { archTests as acdSingleEntryCommandCoreTests } from "../test/arch/acd-single-entry-command-core.test.mjs";
import { archTests as acdNativeAddonDegradesTests } from "../test/arch/acd-native-addon-degrades.test.mjs";
// milestone 28 — console-app (story 00: craft-review hardening on the SEA build
// recipe — F14 (scripts/build-sea.mjs's assertSafeOutDir refuses an --out that
// resolves to the repo root/cwd/a workspace-marked dir, so `--out .` can never
// rmSync the working tree) and F8 (planMacCodesignSteps: the darwin-only
// codesign --remove-signature/--sign - dance around postject, a pure command
// planner asserted here without invoking the real codesign binary; its mac
// EXECUTION is an @manual CI/verify row). Also see the F12 polarity hardening
// folded into acd-native-addon-degrades.test.mjs and native-addon-sidecar.test.mjs
// (already registered above), which harden the isPackaged() ternary's branch
// wiring, not just its presence.
import { buildSeaRecipeGuardsTests } from "../test/build-sea-recipe-guards.test.mjs";
// milestone 28 — console-app (story 01: signing-notarization). The
// @executable heart — the SHA256SUMS manifest generator/format/malformed-
// manifest rejection matrix (task 02_checksum-manifest.feature) — plus the
// CI-config lint rows a build agent can assert statically over the checked-in
// release workflow YAML (task 00_ci-build-matrix.feature /
// 01_per-os-signing.feature: declared legs, native-arm64 runners, no
// cross-compile, the Linux node-pty source-compile step, the load-bearing
// inject-before-codesign ordering, per-OS signing tool invocations, and
// secret-name-only references). The full cross-OS matrix run + OS-trust
// clearance (Gatekeeper/SmartScreen) are @uat/@manual, not exercised here.
import { releaseChecksumManifestTests } from "../test/release-checksum-manifest.test.mjs";
import { releaseWorkflowLintTests } from "../test/release-workflow-lint.test.mjs";
// milestone 28 — console-app (story 01: signing-notarization, PO pin
// 2026-07-03 resolving the sidecar shape gap): the node-pty sidecar archive
// (extensionless, node-pty's own platform token, gzip'd tar on darwin/linux /
// zip on win32) whose root entries reproduce build-sea.mjs's beside-the-exe
// layout exactly — a real archive-produce -> real-extractor round-trip,
// set-equality both directions.
import { releaseSidecarArchiveRoundtripTests } from "../test/release-sidecar-archive-roundtrip.test.mjs";
// milestone 28 — console-app (story 01: signing-notarization, craft-review
// F3 HIGH): install.sh's pinned GPG fingerprint is asserted against the CI
// signing key (scripts/release/assert-fingerprint-pin.mjs) — a real
// gpg-keypair round-trip over three fixture install.sh shapes (match,
// self-inconsistent, CI-key-mismatch) plus a check that the real, checked-in
// install.sh is self-consistent today.
import { releaseFingerprintPinTests } from "../test/release-fingerprint-pin.test.mjs";

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
  ...workUiVerbRenameTests,
  ...workUiBoardServesUnchangedTests,
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
  // story 29 — migrate-command (the command + its two story arch-tests)
  ...migrateCommandCoreTests,
  ...acdMigrateCommandCliBijectionTests,
  ...acdMigrateReadOnlySourceTests,
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
  ...integrationsRoutingReaderTests,
  ...integrationsBoardsRegistryTests,
  ...integrationsAssociateTests,
  ...integrationsProjectionBoardRoutingTests,
  ...integrationsProjectionParentNestingTests,
  ...integrationsMultiboardSidecarTests,
  ...integrationsParserRevertedTests,
  ...integrationsLegacyRemovedTests,
  ...acdIntegrationsDescriptorCommittedTests,
  ...acdIntegrationsReaderIsJsonTests,
  ...acdIntegrationsBoardResolutionTests,
  ...acdIntegrationsNoNotionReadTests,
  ...acdIntegrationsDescriptorExtensibleTests,
  ...acdIntegrationsBoardsSchemaTests,
  // milestone 19 — work-run-lifecycle (story 00: run-store)
  ...runStoreRecordTests,
  ...runStoreStateMachineTests,
  ...runStoreDerivedLogTests,
  ...acdRunRecordDerivedTests,
  ...acdRunWriteScopeTests,
  ...acdRunPartitionReadyTests,
  // milestone 19 — work-run-lifecycle (story 01: run-commands)
  ...runCommandsTests,
  ...runCliFaceTests,
  ...runLifecycleRestartTests,
  // milestone 20 — autonomous-run-resilience (story 00: resilience-core)
  ...runResilienceRecordKeysTests,
  ...runFailureClassificationTests,
  ...runRetryLineageTests,
  ...runHeartbeatReclaimTests,
  ...runDedupAtomicPersistTests,
  ...acdRunRetryClassificationTests,
  ...acdRunRetryResumesLineageTests,
  ...acdRunReclaimStaleOnlyTests,
  ...acdRunPersistAtomicTests,
  ...acdRunDedupNoDuplicateTests,
  // milestone 20 — autonomous-run-resilience (story 01: resilience-commands)
  ...runRetryCommandTests,
  ...runRetryCliFaceTests,
  ...runStatusRollbackTests,
  ...runResilienceAcceptanceTests,
  ...runCompleteReasonTests,
  ...acdStatusRollbackBoundedTests,
  // milestone 21 — board-run-observability (story 00: run-observability route +
  // pure helpers; story 01: rerun verb + in-flight predicate)
  ...boardRunStatusRouteTests,
  ...boardRunsPureTests,
  // milestone 22 — mesh-foundation (story 00: mesh-store spine + face skeleton)
  ...meshRecordStoreTests,
  ...meshPartitionConventionTests,
  ...meshFaceSkeletonTests,
  ...acdMeshPartitionWriteTests,
  ...acdMeshWriteScopeTests,
  ...acdMeshCommandCliBijectionTests,
  // milestone 25 — mesh-ui (Decide-stage arch tests: board→ui rename XOR + single fleet-data command)
  ...acdWorkUiRenameCompleteTests,
  ...acdMeshUiSingleDataCommandTests,
  // milestone 25 — mesh-ui (story 01: the fleet data model + the `aof mesh status` CLI mirror)
  ...meshFleetBoardsProjectionTests,
  ...meshStatusFleetRenderTests,
  ...meshFleetGracefulDegradationTests,
  // milestone 25 — mesh-ui (story 02: the read-only fleet web serve-face + its 3 face guards)
  ...meshUiServeTests,
  ...meshUiCliFaceTests,
  ...meshUiReadOnlyContractTests,
  ...acdMeshUiNoCoreImportTests,
  ...acdMeshUiSingleServerTests,
  ...acdMeshUiWriteIsolationTests,
  // milestone 34 — global mesh work store (story 03: mesh UI global scope, ADR-006)
  ...globalMeshQueryTests,
  ...meshUiGlobalScopeTests,
  ...fleetScopeTests,
  ...acdMeshUiGlobalDefaultTests,
  ...acdMeshUiLocalFilterPreservesStatusTests,
  ...acdMeshUiScopeVisibleTests,
  // milestone 27 issuance/routing write surfaces are retired for the global WebSocket-only mesh cleanup.
// milestone 33 — mesh relay/transport redesign: the two Decide-stage fitness
  // functions (see the import comment; each is the DoD of its build story:
  // F-3203 identity-not-committed — UN-SKIPPED + GREEN by story 00 below;
  // F-3202/F-3204 fabric-single-seam — UN-SKIPPED + GREEN by story 01 below)
  ...acdMeshIdentityNotCommittedTests,
  ...acdFabricSingleSeamTests,
  // milestone 33 (story 01) — fabric-native transport + coordination launcher: tasks 00–04
  ...meshFabricSeamTests,
  ...meshFabricLivenessCutoverTests,
  ...meshBrokerRetirementTests,
  ...meshCoordinationLauncherTests,
  ...meshOperatorGuidanceTests,
  // milestone 33 (story 00) — per-install-node-identity: tasks 00–03
  ...identitySidecarPersistTests,
  ...loadworkspaceHydrationTests,
  ...backcompatMigrateDoctorTests,
  ...selfHealHostnameMismatchTests,
  // story 30 — per-agent model selection
  ...bundleModelMapTests,
  ...agentModelOverrideTests,
  ...agentModelSoloInertTests,
  ...acdAgentModelSourceMapTests,
  ...acdAgentModelRoleDerivationTests,
  // story 31 — migrate-claude-command (the /aof:migrate bundle body + distribution)
  ...migrateClaudeCommandTests,
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
  ...globalWorkStoreTests,
  ...globalWorkPropagationTests,
  ...globalNodeRegistryTests,
  ...acdGlobalMeshPathsHomeTests,
  ...acdGlobalStoreNoNativeDepTests,
  ...acdGlobalPropagationSinglePredicateTests,
  ...acdGlobalPublisherSingleSeamTests,
  ...acdGlobalNodeDescriptorsRedactSecretsTests,
  ...acdGlobalNodeRegistryProjectionOnlyTests,
  // milestone 34 — global mesh work store (story 04: worker live-state stream to
  // control node, ADR-007)
  ...workerRoleAddressTests,
  ...workerStreamClientTests,
  ...controlStreamServerTests,
  ...meshLauncherStreamRoleTests,
  ...meshLauncherLockTests,
  ...globalNodeIdentityTests,
  ...acdGlobalNodeIdentityHomeTests,
  ...acdWorkerStreamSinglePredicateTests,
  ...acdWorkerStreamFabricAddressedTests,
  ...acdWorkerStreamNonBlockingTests,
  ...acdControlStreamTailnetOnlyTests,
  ...acdControlStreamAddressBoundTests,
  ...pathTests,
  ...promptTests,
  ...catalogTests,
  // milestone 28 — console-app (story 02: one-line-installer)
  ...installerDetectTests,
  ...installerVerifyTests,
  ...installerPlaceTests,
  // milestone 28 — console-app (story 00: self-contained-binary)
  ...assetBaseSeamTests,
  ...nativeAddonSidecarTests,
  ...singleEntryTwoModeTests,
  ...bundleAssetManifestCompleteTests,
  ...acdSeaSafeAssetBaseTests,
  ...acdSingleEntryCommandCoreTests,
  ...acdNativeAddonDegradesTests,
  ...buildSeaRecipeGuardsTests,
  // milestone 28 — console-app (story 01: signing-notarization)
  ...releaseChecksumManifestTests,
  ...releaseWorkflowLintTests,
  ...releaseSidecarArchiveRoundtripTests,
  ...releaseFingerprintPinTests
];

// Run the suite ONLY when this module is the entry point. The
// acd-roundtrip-registration meta-test imports the assembled `tests` array above
// to verify every arch-test is registered; that import must NOT re-run the suite.
async function runSuite() {
  let failures = 0;

  // Per-test hermetic global AOF home (34/story 00) — see scripts/test-unit.mjs for the
  // rationale: the node identity is machine-wide now, so each test gets its OWN empty
  // global home to stop identity/global-store state leaking across tests (or onto the real
  // machine). The integration lane below keeps process.env untouched afterward.
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { rmSync } = await import("node:fs");
  const ghRoot = join(tmpdir(), `aof-test-gh-${process.pid}`);
  let ghIndex = 0;

  console.log("# unit");
  for (const { name, run } of tests) {
    const prevHome = process.env.AOF_GLOBAL_HOME;
    process.env.AOF_GLOBAL_HOME = join(ghRoot, `t-${ghIndex++}`);
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(error.stack ?? error.message);
    } finally {
      if (prevHome === undefined) delete process.env.AOF_GLOBAL_HOME;
      else process.env.AOF_GLOBAL_HOME = prevHome;
    }
  }
  try { rmSync(ghRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

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
