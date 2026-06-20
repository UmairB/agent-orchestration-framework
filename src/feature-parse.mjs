// A lightweight, dependency-free Gherkin reader for the board's read-only
// `/api/work/tasks` endpoint (milestone 03). It mirrors the hand-rolled parse in
// `work.mjs`'s `checkFeatureTags` — the repo deliberately hand-parses Gherkin
// rather than take a dependency. Pure (no fs): callers pass the file text.
//
// parseFeature(text) → {
//   feature: string|null,
//   scenarios: [{ name, outline: boolean, lane: "executable"|"manual"|"uat"|null }]
// }
//
// A scenario's `lane` is whichever single verification tag (@executable /
// @manual / @uat) is in scope — feature-level tags plus the scenario's own
// pending tags. If exactly one applies it is the lane (without the leading `@`);
// otherwise (none, or more than one) the lane is null.

const VERIFICATION_TAGS = new Set(["@executable", "@manual", "@uat"]);

export function parseFeature(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let feature = null;
  let featureTags = [];
  let pending = [];
  const scenarios = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("@")) {
      const tags = line.split(/\s+/).filter((token) => token.startsWith("@"));
      pending.push(...tags);
      continue;
    }

    if (/^Feature:/.test(line)) {
      feature = line.replace(/^Feature:\s*/, "").trim() || null;
      featureTags = pending;
      pending = [];
      continue;
    }

    const scenarioMatch = /^Scenario( Outline)?:/.exec(line);
    if (scenarioMatch) {
      const outline = Boolean(scenarioMatch[1]);
      const name = line.replace(/^Scenario( Outline)?:\s*/, "").trim();
      const effective = [...featureTags, ...pending];
      const verification = effective.filter((tag) => VERIFICATION_TAGS.has(tag));
      const lane = verification.length === 1 ? verification[0].slice(1) : null;
      scenarios.push({ name, outline, lane });
      pending = [];
      continue;
    }
  }

  return { feature, scenarios };
}
