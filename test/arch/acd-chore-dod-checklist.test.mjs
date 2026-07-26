// Fitness function for milestone 37 / ADR-002 + ADR-003 (FF-3706):
// "A `CHORE.md` record doc REQUIRES a `## Definition of Done` section — the chore's
//  CLOSE criterion (it closes when the checklist is ticked). The section is a
//  checklist (contains `- [ ]` / `- [x]` task-list items)."
//
// The DoD section is a body-shape invariant (validateWork checks frontmatter, not
// body sections), so it is pinned on the two artifacts that carry the chore's shape:
//   (a) the shipped CHORE.md TEMPLATE (.aof/templates/work/chore/CHORE.md) — the
//       scaffold that every chore is minted from MUST carry the section + a checklist;
//   (b) any real CHORE.md under wiki/work — each must carry the section.
//
// Red-until-built: file-existence gated (mirrors the m06 headroom idiom). Each check
// is inert-green until its artifact exists (the template lands in story 01; real
// chores appear later), then enforces. If NEITHER artifact exists yet the test is a
// green no-op — honest at every stage.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHORE_TEMPLATE = path.join(repoRoot, ".aof", "templates", "work", "chore", "CHORE.md");
const DOD_HEADING = /^##\s+Definition of Done\s*$/im;
const CHECKLIST_ITEM = /^\s*-\s+\[[ xX]\]\s+/m;
const CHORE_FOLDER_RE = /^\d+_chore_[a-z0-9-]+$/;

async function realChoreDocs() {
  const workDir = path.join(repoRoot, "wiki", "work");
  if (!existsSync(workDir)) return [];
  const out = [];
  // A chore's record doc lives at wiki/work/NN_chore_<slug>/CHORE.md.
  for (const entry of await readdir(workDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !CHORE_FOLDER_RE.test(entry.name)) continue;
    const doc = path.join(workDir, entry.name, "CHORE.md");
    if (existsSync(doc)) out.push(doc);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/chore-dod-checklist: the CHORE.md TEMPLATE carries a `## Definition of Done` checklist (FF-3706, self-activates when the template lands in story 01)",
    run: async () => {
      if (!existsSync(CHORE_TEMPLATE)) return; // inert-green until story 01 ships the template
      const text = await readFile(CHORE_TEMPLATE, "utf8");
      assert.match(text, DOD_HEADING, "the CHORE.md template carries a `## Definition of Done` section (the close criterion)");
      assert.match(text, CHECKLIST_ITEM, "the `## Definition of Done` section is a CHECKLIST (`- [ ]` items)");
    },
  },
  {
    name: "arch/chore-dod-checklist: every real CHORE.md under wiki/work carries a `## Definition of Done` section (FF-3706, self-activates as chores appear)",
    run: async () => {
      const docs = await realChoreDocs();
      for (const doc of docs) {
        const text = await readFile(doc, "utf8");
        assert.match(text, DOD_HEADING, `${path.relative(repoRoot, doc)} carries a \`## Definition of Done\` section (its close criterion)`);
      }
    },
  },
];
