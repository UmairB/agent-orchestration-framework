const NULL_CAPABILITIES = new Set(["roadmap", "milestone", "sync"]);

// Test-only backend for seam routing. It is not a supported user workflow provider.
export const nullBackend = Object.freeze({
  kind: "null",
  capabilities: NULL_CAPABILITIES,
  loadState: nullLoadState,
  analyzeRoadmap: nullAnalyzeRoadmap,
  assertMilestone: nullAssertMilestone,
  async syncBoardFromMilestone(projectDir, milestoneId, options = {}) {
    const assertion = await nullAssertMilestone(projectDir, milestoneId, options);
    const roadmap = assertion.ok ? await nullAnalyzeRoadmap(projectDir, options) : null;
    return {
      assertion,
      roadmap,
      phases: Array.isArray(roadmap?.phases) ? roadmap.phases : []
    };
  }
});

async function nullLoadState(_projectDir, options = {}) {
  const milestoneId = normalizeMilestone(options.milestoneId ?? options.milestone ?? options.currentMilestone);
  return {
    milestoneId,
    statePresent: Boolean(milestoneId),
    roadmapPresent: false,
    configPresent: false,
    raw: ""
  };
}

async function nullAnalyzeRoadmap(_projectDir, options = {}) {
  return options.roadmap ?? {
    milestones: [],
    phases: []
  };
}

async function nullAssertMilestone(_projectDir, milestoneId, options = {}) {
  const expected = normalizeMilestone(milestoneId);
  if (!expected) return { ok: false, expected: milestoneId, actual: null, code: "MILESTONE_MISSING_ARG" };
  const actual = normalizeMilestone(options.actualMilestone ?? options.milestoneId ?? expected);
  return actual === expected
    ? { ok: true, expected, actual, code: null }
    : { ok: false, expected, actual, code: "MILESTONE_ID_MISMATCH" };
}

function normalizeMilestone(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
