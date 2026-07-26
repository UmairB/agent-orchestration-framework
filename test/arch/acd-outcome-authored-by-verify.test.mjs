// Fitness function for milestone 39 / ADR-004:
// "OUTCOME.md is an ADDITIONAL per-item artifact, never the `recordDoc` PRIMARY
//  record doc (recordDoc feeds validate/rollback across a graph-verified 38
//  dependents and requires identity frontmatter OUTCOME.md does not carry), and it
//  is authored EXCLUSIVELY by the aof:verify path at Accept — never by an
//  evidence/developer subagent."
//
// Idiom (mirrors acd-spike-chore-record-doc): a NON-VACUOUS live assertion armed
// TODAY — recordDoc maps the existing types and never returns OUTCOME.md — so
// wiring OUTCOME into the recordDoc primary seam (which would break validate) goes
// RED today. Red-until-built: the authoring-ownership grep self-activates once the
// OUTCOME template lands.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordDoc } from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE_ROOT = path.join(repoRoot, "src", "bundle", "templates");
const VERIFY_PROMPT = path.join(repoRoot, "src", "bundle", "commands", "verify.md");
const DEVELOPER_AGENT = path.join(repoRoot, "src", "bundle", "agents", "aof-developer.md");

// Does any bundle template dir ship an OUTCOME.md (story 01's scaffold)?
async function outcomeTemplateExists() {
  if (!existsSync(TEMPLATE_ROOT)) return false;
  for (const entry of await readdir(TEMPLATE_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(TEMPLATE_ROOT, entry.name, "OUTCOME.md"))) return true;
  }
  return false;
}

export const archTests = [
  {
    name: "arch/39 ADR-004: recordDoc maps the EXISTING types and NEVER returns OUTCOME.md — OUTCOME stays an additional artifact, not the primary record doc — LIVE, non-vacuous",
    run: () => {
      // The existing mappings, live (a regression here goes red today).
      assert.equal(recordDoc({ type: "milestone", dir: repoRoot }), "SPEC.md", "milestone → SPEC.md (no AOF.md at repoRoot)");
      assert.equal(recordDoc({ type: "story", dir: repoRoot }), "STORY.md", "story → STORY.md");
      assert.equal(recordDoc({ type: "uat", dir: repoRoot }), "SESSION.md", "uat → SESSION.md");
      assert.equal(recordDoc({ type: "spike", dir: repoRoot }), "SPIKE.md", "spike → SPIKE.md");
      assert.equal(recordDoc({ type: "chore", dir: repoRoot }), "CHORE.md", "chore → CHORE.md");

      // ADR-004: OUTCOME.md is NEVER a recordDoc primary — for ANY known type.
      for (const type of ["milestone", "story", "uat", "spike", "chore", "task", "outcome"]) {
        assert.notEqual(
          recordDoc({ type, dir: repoRoot }),
          "OUTCOME.md",
          `recordDoc(${type}) is not OUTCOME.md — OUTCOME is an additional artifact, not the primary record doc`,
        );
      }
    },
  },
  {
    name: "arch/39 ADR-004: the ONLY bundle prompt that authors OUTCOME.md is verify.md — the developer agent does not (self-activates when the template lands)",
    run: async () => {
      if (!(await outcomeTemplateExists())) return; // inert-green until story 01 ships the template

      const verifySrc = existsSync(VERIFY_PROMPT) ? await readFile(VERIFY_PROMPT, "utf8") : "";
      assert.match(
        verifySrc,
        /OUTCOME\.md/,
        "verify.md (the Accept path that owns record docs) authors OUTCOME.md",
      );

      // The developer/evidence agent must NOT be instructed to author OUTCOME.md — the
      // load-bearing rule (verify owns record docs; developer subagents clobber/fabricate).
      const devSrc = existsSync(DEVELOPER_AGENT) ? await readFile(DEVELOPER_AGENT, "utf8") : "";
      assert.doesNotMatch(
        devSrc,
        /\b(write|author|fill|edit)[^\n]{0,40}OUTCOME\.md/i,
        "the aof-developer agent is never instructed to author OUTCOME.md (verify owns it)",
      );
    },
  },
];
