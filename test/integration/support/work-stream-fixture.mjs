// test/integration/support/work-stream-fixture.mjs — the shared work-stream
// scaffolding for BDD features (m42 wave (d) restructure). Writes a minimal but
// REAL workspace into context.projectDir (the same shape the arch fixtures
// build): `.aof/aof.config.json` + `wiki/work/...` record docs. Steps stay
// black-box — everything else happens through the CLI.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export async function ensureWorkStream(context) {
  if (context.workStreamReady) return;
  const aofDir = path.join(context.projectDir, ".aof");
  await mkdir(aofDir, { recursive: true });
  await mkdir(path.join(context.projectDir, "wiki", "work"), { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8",
  );
  context.workStreamReady = true;
  context.items = new Map();
}

export function workDir(context) {
  return path.join(context.projectDir, "wiki", "work");
}

export async function writeMilestone(context, { number, slug, title, status = "in-progress" }) {
  await ensureWorkStream(context);
  const dir = path.join(workDir(context), `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    `${frontmatter({ type: "milestone", number: `"${number}"`, slug, status, title: `"${title}"`, created: "2026-06-19", updated: "2026-06-19" })}# ${title}\n`,
    "utf8",
  );
  context.items.set(number, { ref: number, dir, type: "milestone" });
  return dir;
}

export async function writeStory(context, { parent, number, slug, title, status = "in-progress" }) {
  const parentItem = context.items.get(parent);
  if (!parentItem) throw new Error(`writeStory: milestone "${parent}" has not been scaffolded`);
  const dir = path.join(parentItem.dir, "stories", `${number}_story_${slug}`);
  await mkdir(path.join(dir, "tasks"), { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    `${frontmatter({ type: "story", number: `"${number}"`, slug, parent: `"${parent}"`, status, title: `"${title}"`, created: "2026-06-19", updated: "2026-06-19" })}# ${title}\n`,
    "utf8",
  );
  const ref = `${parent}/${number}`;
  context.items.set(ref, { ref, dir, type: "story" });
  return dir;
}
