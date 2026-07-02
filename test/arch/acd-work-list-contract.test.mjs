// Fitness function for milestone 03 / ADR-002:
// "`aof work list --json` emits a flat JSON array whose every element is exactly
//  { ref, type, slug, status, title, parent, dir } (the listItems field set) — a
//  flat array (NOT a nested tree), with `parent` as the only tree edge
//  (null/absent at depth 0)."
//
// Structural proof on the EMITTED JSON (not a source grep): build a fixture
// work-stream, run `aof work list --json` via child process, parse stdout, and
// assert —
//   - the result is an Array (not an object with `children`);
//   - every element's key set is EXACTLY the seven contract fields (no missing,
//     no extra);
//   - depth-0 items (milestones, uat) have `parent` null/absent, and every
//     nested item carries a `parent` ref that resolves to another element's `ref`.
import assert from "node:assert/strict";
import { spawnCliSync } from "../support/cli-spawn.mjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const CONTRACT_FIELDS = ["ref", "type", "slug", "status", "title", "parent", "dir"];

// The ADR-002 example stream: a milestone with two stories + a top-level uat.
const FIXTURE_ITEMS = [
  { ref: "03", type: "milestone", slug: "work-board-ui", status: "in-progress", title: "Work Board UI" },
  { ref: "03/00", type: "story", slug: "work-list-json", status: "done", title: "work list --json" },
  { ref: "03/01", type: "story", slug: "board-tree", status: "in-progress", title: "The work board" },
  { ref: "04", type: "uat", slug: "acceptance-session", status: "not-started", title: "Acceptance session" }
];

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function recordDoc(type) {
  if (type === "milestone") return "SPEC.md";
  if (type === "story") return "STORY.md";
  if (type === "uat") return "SESSION.md";
  return null;
}

async function buildFixture(items) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-arch-work-list-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(aofDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );

  for (const item of items) {
    const [milestoneNum, storyNum] = item.ref.split("/");
    if (item.type === "story") {
      const milestone = items.find((candidate) => candidate.type === "milestone" && candidate.ref === milestoneNum);
      const milestoneDir = path.join(workDir, `${milestoneNum}_milestone_${milestone ? milestone.slug : "milestone"}`);
      const storyDir = path.join(milestoneDir, "stories", `${storyNum}_story_${item.slug}`);
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        path.join(storyDir, "STORY.md"),
        frontmatter({ type: "story", number: storyNum, slug: item.slug, parent: milestoneNum, status: item.status, title: `"${item.title}"`, created: "2026-06-19", updated: "2026-06-19" }),
        "utf8"
      );
      continue;
    }
    const dir = path.join(workDir, `${milestoneNum}_${item.type}_${item.slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, recordDoc(item.type)),
      frontmatter({ type: item.type, number: milestoneNum, slug: item.slug, status: item.status, title: `"${item.title}"`, created: "2026-06-19", updated: "2026-06-19" }),
      "utf8"
    );
  }
  return root;
}

function runListJson(root) {
  const result = spawnCliSync(process.execPath, [cliPath, "work", "list", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const archTests = [
  {
    name: "arch/ADR-002: work list --json parses to an ARRAY, not a nested tree",
    run: async () => {
      const root = await buildFixture(FIXTURE_ITEMS);
      try {
        const result = runListJson(root);
        assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
        const parsed = JSON.parse(result.stdout);
        assert.ok(Array.isArray(parsed), "the result is a flat array");
        assert.ok(!(parsed && !Array.isArray(parsed) && "children" in parsed), "not an object with children");
        for (const element of parsed) {
          assert.ok(!("children" in element), `element ${element.ref} carries no nested children`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "arch/ADR-002: every element's key set is EXACTLY the seven contract fields (no missing, no extra)",
    run: async () => {
      const root = await buildFixture(FIXTURE_ITEMS);
      try {
        const parsed = JSON.parse(runListJson(root).stdout);
        assert.ok(parsed.length > 0, "the fixture stream is non-empty");
        for (const element of parsed) {
          const keys = Object.keys(element).sort();
          assert.deepEqual(keys, [...CONTRACT_FIELDS].sort(), `element ${element.ref} has exactly the seven contract fields, got [${keys.join(", ")}]`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },

  {
    name: "arch/ADR-002: parent is the only tree edge — depth-0 items have null parent, nested parents resolve to a ref in the stream",
    run: async () => {
      const root = await buildFixture(FIXTURE_ITEMS);
      try {
        const parsed = JSON.parse(runListJson(root).stdout);
        const refs = new Set(parsed.map((element) => element.ref));
        const depthZeroTypes = new Set(["milestone", "uat"]);
        for (const element of parsed) {
          if (depthZeroTypes.has(element.type)) {
            assert.ok(element.parent == null, `depth-0 ${element.ref} (${element.type}) has parent null/absent, got ${JSON.stringify(element.parent)}`);
          } else {
            assert.ok(element.parent != null, `nested ${element.ref} carries a parent`);
            assert.ok(refs.has(String(element.parent)), `nested ${element.ref}'s parent "${element.parent}" resolves to another element's ref`);
          }
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
];
