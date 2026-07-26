// test/support/work-upgrade-fixture.mjs — shared fixture builder for milestone
// 40 / story 02 (migration registry & `aof upgrade`) task-traceability modules.
//
// Two fixture shapes:
//   1. A bare `withWork` temp work dir (mirrors work-reindex-fixture.mjs) for
//      module-level engine tests (planTransforms/planUpgrade/runUpgrade called
//      directly — no CLI, no project scaffold).
//   2. A full PROJECT fixture (`.aof/aof.config.json` + `wiki/work/`) for the
//      CLI-level scenarios that literally run `aof upgrade` (spawnCliSync over
//      bin/aof.mjs) — mirrors acd-migrate-command-cli-bijection's
//      buildProjectFixture.
//
// `writeItem` hand-authors a record doc for EVERY type recordDoc (work.mjs)
// resolves (milestone/story/uat/spike/chore), stamped or unstamped, with real
// authored body prose below the frontmatter — so the byte-identity /
// shape-only assertions have real prose to prove untouched.
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync } from "./cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// ---------------------------------------------------------- bare work dir --

export async function withWork(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-upgrade-"));
  const work = path.join(root, "work");
  await mkdir(work, { recursive: true });
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// The record-doc filename recordDoc (work.mjs) resolves for each type.
const DOC_OF = { milestone: "SPEC.md", story: "STORY.md", uat: "SESSION.md", spike: "SPIKE.md", chore: "CHORE.md" };

// Hand-authors a record doc under `dir` for the given `type`. `stamped` writes
// `schema`/`aofVersion` into the frontmatter (defaults false — unstamped, the
// schema-0 baseline). `schema` (an explicit override) lets a scenario write a
// PARTICULAR schema value (e.g. a schema newer than the build). `parent` is
// required for a story. Returns `{ item, dir, doc, path, before }` — `item` is
// the `{ type, ref, dir }` shape work.mjs's readers/writer expect; `before` is
// the exact bytes written, for byte-diff assertions.
export async function writeItem(dir, { type, number, slug, parent, stamped = false, schema, extraLines = [] } = {}) {
  await mkdir(dir, { recursive: true });
  const doc = DOC_OF[type];
  const fields = [
    `type: ${type}`,
    `number: ${number}`,
    `slug: ${slug}`,
    `title: "${slug} item"`,
    "status: not-started",
    "owner: developer",
    ...(parent != null ? [`parent: ${parent}`] : []),
    "created: 2026-07-17",
    "updated: 2026-07-17",
  ];
  if (schema !== undefined) {
    fields.push(`schema: ${schema}`);
    fields.push(`aofVersion: 0.0.9`);
  } else if (stamped) {
    fields.push("schema: 1");
    fields.push("aofVersion: 0.0.9");
  }
  fields.push(...extraLines);
  const text =
    `---\n${fields.join("\n")}\n---\n` +
    `# ${number} · ${slug}\n\n` +
    `Authored body prose for ${slug} — must survive byte-identical.\n\n` +
    `<!--\n  A body HTML comment block — must survive unchanged, byte-for-byte.\n-->\n`;
  const docPath = path.join(dir, doc);
  await writeFile(docPath, text, "utf8");
  const ref = parent != null ? `${parent}/${number}` : number;
  return { item: { type, ref, parent: parent ?? null, dir }, dir, doc, path: docPath, before: text };
}

export async function readDoc(dirOrPath, doc) {
  const p = doc ? path.join(dirOrPath, doc) : dirOrPath;
  return readFile(p, "utf8");
}

// ------------------------------------------------------------- project fx --

export async function withUpgradeProject(build, body) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-upgrade-proj-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8",
  );
  try {
    if (build) await build({ repo, workDir });
    return await body({ repo, workDir });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

export function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function parseJsonOut(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`expected parseable JSON stdout (status ${result.status}, stderr: ${result.stderr}) — ${error.message}\nstdout: ${result.stdout}`);
  }
}
