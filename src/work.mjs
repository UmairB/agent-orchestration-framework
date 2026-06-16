// `aof work` — deterministic mechanics over an ACD work stream.
//
// The work stream is a tree of `NN_type_slug` folders. The folder NAME is the
// index: identity (number/type/slug) is parseable without opening a file, so
// resolution and listing never need to read content — that is the whole point
// of this module (it replaces the agent improvising `**/*.md` globs).
//
// Structure handled (the let-shield convention):
//   work/NN_milestone_slug/SPEC.md
//   work/NN_milestone_slug/stories/SS_story_slug/STORY.md
//   work/NN_milestone_slug/stories/SS_story_slug/tasks/*.feature
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { findProjectConfig } from "./workspace.mjs";
import { readJson } from "./fs.mjs";

const ITEM_RE = /^(\d+)_(milestone|story|task)_([a-z0-9-]+)$/;
const VALID_STATUS = new Set(["not-started", "in-progress", "blocked", "in-review", "done"]);
const UNIVERSAL_TAGS = new Set(["@executable", "@manual", "@uat", "@bug", "@wip"]);
const VERIFICATION_TAGS = new Set(["@executable", "@manual", "@uat"]);
const FINDING_TAG_RE = /^@finding-[A-Za-z0-9-]+$/;
const MILESTONE_TAG_RE = /^@milestone-\d+$/i;

const sameNum = (a, b) => Number.parseInt(a, 10) === Number.parseInt(b, 10);

// ---------------------------------------------------------------- config ----

export async function loadWorkspace(cwd = process.cwd(), explicitConfig) {
  const configPath = await findProjectConfig(cwd, explicitConfig);
  let config = {};
  try {
    config = await readJson(configPath);
  } catch {
    config = {};
  }
  const configDir = path.dirname(configPath);
  const projectRoot = path.basename(configDir) === ".aof" ? path.dirname(configDir) : configDir;
  const workDir = path.resolve(projectRoot, config.work?.dir ?? "./wiki/work");
  return { configPath, config, projectRoot, workDir };
}

async function readDirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ discovery ----

// Enumerate items by folder name only — no file reads.
export async function listItems(workDir) {
  const items = [];
  for (const entry of await readDirSafe(workDir)) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(ITEM_RE);
    if (!match) continue;
    const [, number, type, slug] = match;
    const dir = path.join(workDir, entry.name);
    items.push({ number, type, slug, name: entry.name, dir, ref: number, parent: null });

    if (type === "milestone") {
      const storiesDir = path.join(dir, "stories");
      for (const child of await readDirSafe(storiesDir)) {
        if (!child.isDirectory()) continue;
        const sub = child.name.match(ITEM_RE);
        if (!sub) continue;
        const [, sNumber, sType, sSlug] = sub;
        items.push({
          number: sNumber,
          type: sType,
          slug: sSlug,
          name: child.name,
          dir: path.join(storiesDir, child.name),
          ref: `${number}/${sNumber}`,
          parent: number,
        });
      }
    }
  }
  return items;
}

function recordDoc(item) {
  if (item.type === "milestone") return "SPEC.md";
  if (item.type === "story") return "STORY.md";
  return null;
}

// Minimal frontmatter reader: `key: value`, inline lists `[a, b]`, quoted
// scalars. Block lists are not needed — `depends` is authored inline.
export function parseFrontmatter(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return {};
  const out = {};
  for (const line of block[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    out[kv[1]] = value;
  }
  return out;
}

async function readMeta(item) {
  const doc = recordDoc(item);
  if (!doc) return {};
  try {
    return parseFrontmatter(await readFile(path.join(item.dir, doc), "utf8"));
  } catch {
    return {};
  }
}

const asList = (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);

// ----------------------------------------------------------------- find ----

// `query` is a structured ref (`NN`, `NN/SS`) or a free-text slug match.
// Semantic matching slots in at the lexical branch below.
export async function findWork(workDir, query) {
  const items = await listItems(workDir);
  const ref = (query ?? "").trim();
  let matches;

  if (/^\d+$/.test(ref)) {
    matches = items.filter((item) => item.type === "milestone" && sameNum(item.number, ref));
  } else {
    const pair = ref.match(/^(\d+)\/(\d+)$/);
    if (pair) {
      matches = items.filter(
        (item) => item.type === "story" && item.parent && sameNum(item.parent, pair[1]) && sameNum(item.number, pair[2]),
      );
    } else {
      const needle = ref.toLowerCase();
      matches = items.filter(
        (item) => item.slug.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
      );
    }
  }

  const rows = [];
  for (const item of matches) {
    const meta = await readMeta(item);
    rows.push({
      ref: item.ref,
      type: item.type,
      slug: item.slug,
      status: meta.status ?? null,
      title: meta.title ?? null,
      parent: item.parent,
      dir: item.dir,
    });
  }
  return rows;
}

// ------------------------------------------------------------- validate ----

function checkFeatureTags(text, relPath, projectTags, add) {
  const lines = text.split(/\r?\n/);
  let pending = [];
  let featureTags = [];

  const allowed = (tag) => UNIVERSAL_TAGS.has(tag) || projectTags.has(tag) || FINDING_TAG_RE.test(tag);

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("@")) {
      const tags = line.split(/\s+/).filter((token) => token.startsWith("@"));
      for (const tag of tags) {
        if (MILESTONE_TAG_RE.test(tag)) {
          add(relPath, `tag "${tag}" — milestone membership is structural, not a tag`);
        } else if (!allowed(tag)) {
          add(relPath, `unknown tag "${tag}" (outside the closed vocabulary)`);
        }
      }
      pending.push(...tags);
      continue;
    }
    if (/^Feature:/.test(line)) {
      featureTags = pending;
      pending = [];
      continue;
    }
    if (/^Scenario( Outline)?:/.test(line)) {
      const effective = [...featureTags, ...pending];
      const verification = effective.filter((tag) => VERIFICATION_TAGS.has(tag));
      if (verification.length !== 1) {
        const name = line.replace(/^Scenario( Outline)?:\s*/, "");
        add(relPath, `scenario "${name}" carries ${verification.length} verification tags (need exactly 1): [${verification.join(", ")}]`);
      }
      pending = [];
    }
  }
}

function findCycle(graph) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map([...graph.keys()].map((node) => [node, WHITE]));
  const stack = [];
  let cycle = null;

  const visit = (node) => {
    color.set(node, GREY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (color.get(next) === GREY) {
        cycle = [...stack.slice(stack.indexOf(next)), next];
        return true;
      }
      if (color.get(next) === WHITE && visit(next)) return true;
    }
    stack.pop();
    color.set(node, BLACK);
    return false;
  };

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE && visit(node)) break;
  }
  return cycle;
}

// Deterministic checks only — folder↔frontmatter, the closed tag vocabulary,
// and the `depends` graph (resolves + acyclic). Test-traceability
// (@executable→green test) is the language-aware layer still to come.
export async function validateWork(workDir, config, scopeRef) {
  const items = await listItems(workDir);
  const findings = [];
  const add = (target, problem) => findings.push({ path: target, problem });

  const inScope = (item) => {
    if (!scopeRef) return true;
    const ref = scopeRef.trim();
    if (/^\d+$/.test(ref)) return sameNum(item.parent ?? item.number, ref);
    const pair = ref.match(/^(\d+)\/(\d+)$/);
    if (pair) return item.ref === `${pair[1]}/${pair[2]}` || item.ref === ref;
    return item.slug.includes(ref);
  };

  const tagConfig = config?.work?.tags ?? {};
  const projectTags = new Set([
    ...(tagConfig.layers ?? []),
    ...(tagConfig.refinements ?? []),
    ...(tagConfig.domains ?? []),
  ]);

  const milestoneNumbers = new Set(
    items.filter((item) => item.type === "milestone").map((item) => Number.parseInt(item.number, 10)),
  );
  const graph = new Map();

  for (const item of items) {
    const meta = item.type === "milestone" || item.type === "story" ? await readMeta(item) : {};

    if (item.type === "milestone") {
      const deps = asList(meta.depends).map((value) => Number.parseInt(value, 10));
      graph.set(Number.parseInt(item.number, 10), deps);
    }

    if (!inScope(item)) continue;

    // 1. folder ↔ frontmatter
    const doc = recordDoc(item);
    if (doc) {
      const docPath = path.join(item.dir, doc);
      if (Object.keys(meta).length === 0) {
        add(docPath, `missing or empty record doc (${doc})`);
      } else {
        if (meta.type !== item.type) add(docPath, `frontmatter type "${meta.type ?? ""}" ≠ folder type "${item.type}"`);
        if (!sameNum(meta.number ?? "", item.number)) add(docPath, `frontmatter number "${meta.number ?? ""}" ≠ folder "${item.number}"`);
        if (meta.slug !== item.slug) add(docPath, `frontmatter slug "${meta.slug ?? ""}" ≠ folder "${item.slug}"`);
        if (!VALID_STATUS.has(meta.status)) add(docPath, `invalid status "${meta.status ?? ""}"`);
        if (!meta.created) add(docPath, "missing created date");
        if (!meta.updated) add(docPath, "missing updated date");
        if (meta.parent != null && meta.parent !== "" && !milestoneNumbers.has(Number.parseInt(meta.parent, 10))) {
          add(docPath, `parent "${meta.parent}" does not resolve to a milestone`);
        }
      }
    }

    // 3a. depends references resolve
    if (item.type === "milestone") {
      for (const dep of asList(meta.depends)) {
        if (!milestoneNumbers.has(Number.parseInt(dep, 10))) {
          add(path.join(item.dir, "SPEC.md"), `depends "${dep}" does not resolve to a milestone`);
        }
      }
    }

    // 2. tag vocabulary (per task feature)
    if (item.type === "story") {
      const tasksDir = path.join(item.dir, "tasks");
      for (const file of await readDirSafe(tasksDir)) {
        if (!file.isFile() || !file.name.endsWith(".feature")) continue;
        const featurePath = path.join(tasksDir, file.name);
        checkFeatureTags(await readFile(featurePath, "utf8"), featurePath, projectTags, add);
      }
    }
  }

  // 3b. depends graph acyclic
  const cycle = findCycle(graph);
  if (cycle) add(workDir, `depends cycle: ${cycle.join(" → ")}`);

  // collapse identical (path, problem) duplicates — the same tag can recur
  // across scenarios in one file, but one report per issue is enough.
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.path} ${finding.problem}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------------------- next ----

function inRange(scopeRef) {
  if (!scopeRef) return () => true;
  const range = scopeRef.match(/^(\d+)-(\d+)$/);
  if (range) {
    const lo = Number.parseInt(range[1], 10);
    const hi = Number.parseInt(range[2], 10);
    return (num) => num >= lo && num <= hi;
  }
  if (/^\d+$/.test(scopeRef)) {
    const only = Number.parseInt(scopeRef, 10);
    return (num) => num === only;
  }
  return () => true;
}

const ready = (item, status) => ({
  state: "ready",
  ref: item.ref,
  type: item.type,
  slug: item.slug,
  status: status ?? null,
  path: item.dir,
});

// The next actionable item, respecting `depends`: the first not-`done`
// milestone whose dependencies are all `done`, drilled into its first
// not-`done` story. Returns { state: "ready" | "blocked" | "done", ... }.
export async function nextWork(workDir, scopeRef) {
  const items = await listItems(workDir);
  const milestones = items
    .filter((item) => item.type === "milestone")
    .sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));

  const statusCache = new Map();
  const milestoneStatus = async (num) => {
    if (statusCache.has(num)) return statusCache.get(num);
    const item = milestones.find((m) => Number.parseInt(m.number, 10) === num);
    const status = item ? (await readMeta(item)).status ?? null : null;
    statusCache.set(num, status);
    return status;
  };

  const within = inRange(scopeRef);
  const scoped = milestones.filter((m) => within(Number.parseInt(m.number, 10)));
  let blocked = null;

  for (const milestone of scoped) {
    const meta = await readMeta(milestone);
    statusCache.set(Number.parseInt(milestone.number, 10), meta.status ?? null);
    if (meta.status === "done") continue;

    const unmet = [];
    for (const dep of asList(meta.depends)) {
      if ((await milestoneStatus(Number.parseInt(dep, 10))) !== "done") unmet.push(String(dep));
    }
    if (unmet.length > 0) {
      blocked ??= { state: "blocked", ref: milestone.ref, type: "milestone", slug: milestone.slug, status: meta.status ?? null, path: milestone.dir, waitingOn: unmet };
      continue;
    }

    const stories = items
      .filter((item) => item.type === "story" && item.parent === milestone.number)
      .sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));

    if (stories.length === 0) return ready(milestone, meta.status); // needs break-down

    for (const story of stories) {
      const storyMeta = await readMeta(story);
      if (storyMeta.status !== "done") return ready(story, storyMeta.status);
    }
    return ready(milestone, meta.status); // all stories done -- milestone needs accepting
  }

  return blocked ?? { state: "done" };
}
