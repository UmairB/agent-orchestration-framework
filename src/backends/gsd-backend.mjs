import { analyzeGsdRoadmap, assertMilestone, gsdSdkVersion, loadGsdState } from "../gsd-sdk-adapter.mjs";

const GSD_CAPABILITIES = new Set(["roadmap", "milestone", "sync", "assignTask"]);

export const gsdBackend = Object.freeze({
  kind: "gsd",
  capabilities: GSD_CAPABILITIES,
  loadState(projectDir, options = {}) {
    return loadGsdState(projectDir, adapterOptions(options));
  },
  analyzeRoadmap(projectDir, options = {}) {
    return analyzeGsdRoadmap(projectDir, adapterOptions(options));
  },
  assertMilestone(projectDir, milestoneId, options = {}) {
    return assertMilestone(projectDir, milestoneId, adapterOptions(options));
  },
  async syncBoardFromMilestone(projectDir, milestoneId, options = {}) {
    const assertion = await assertMilestone(projectDir, milestoneId, adapterOptions(options));
    if (!assertion.ok) return { assertion, roadmap: null, phases: [] };
    const roadmap = await analyzeGsdRoadmap(projectDir, adapterOptions(options));
    return {
      assertion,
      roadmap,
      phases: Array.isArray(roadmap?.phases) ? roadmap.phases : []
    };
  }
});

export function gsdBackendSdkVersion() {
  return gsdSdkVersion();
}

function adapterOptions(options = {}) {
  return {
    ...(options.gsdToolsPath ? { gsdToolsPath: options.gsdToolsPath } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.ToolsClass ? { ToolsClass: options.ToolsClass } : {}),
    ...(options.skipSurfaceProbe ? { skipSurfaceProbe: options.skipSurfaceProbe } : {})
  };
}

