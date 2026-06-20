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
import { workTests } from "../test/work.test.mjs";
import { resolveItemsTests } from "../test/work-resolve.test.mjs";
import { validateStreamTests } from "../test/work-validate.test.mjs";
import { orderWorkTests } from "../test/work-next.test.mjs";
import { archTests as workContentFreeDiscoveryTests } from "../test/arch/work-content-free-discovery.test.mjs";
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
import { archTests as acdBoardWriteIsolationTests } from "../test/arch/acd-board-write-isolation.test.mjs";
import { terminalDockTests } from "../test/terminal-dock.test.mjs";
import { terminalWsTests } from "../test/terminal-ws.test.mjs";
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

const tests = [
  ...adapterWarningTests,
  ...packageTests,
  ...workTests,
  ...resolveItemsTests,
  ...validateStreamTests,
  ...orderWorkTests,
  ...workContentFreeDiscoveryTests,
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
  ...acdBoardWriteIsolationTests,
  ...terminalDockTests,
  ...terminalWsTests,
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

let failures = 0;

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

if (failures > 0) {
  process.exitCode = 1;
}
