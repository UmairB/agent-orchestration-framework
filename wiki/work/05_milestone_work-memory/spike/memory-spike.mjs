#!/usr/bin/env node
// SPIKE — throwaway prototype to feel out the `aof work memory` verb shape before the contract is
// locked (milestone 05). NOT the deliverable. It proves three things on the REAL work stream:
//   1. the durable artifacts ACD already produces (RETROSPECTIVE R-entries, ARCHITECTURE ADRs) parse
//      cleanly into structured, attributed memory records — no extra authoring needed;
//   2. scoped retrieval (recall) surfaces the right lesson at decision time;
//   3. the store is a DERIVED INDEX, fully rebuildable from the .md files (the single-source-of-truth
//      invariant) — `reindex` reconstructs it from scratch; records only ever *reference* their source.
//
// Local backend only. No deps. Run:
//   node memory-spike.mjs reindex
//   node memory-spike.mjs recall "fitness test grep" --area architecture
//   node memory-spike.mjs brief
//   node memory-spike.mjs status
//   node memory-spike.mjs ingest --all
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// spike/ -> 05_milestone_work-memory/ -> wiki/work/  (the work.dir)
const DEFAULT_WORK_DIR = resolve(__dirname, "..", "..");
const INDEX_PATH = join(__dirname, ".memory-index.json"); // derived store; kept inside the spike

// ---- argv ----------------------------------------------------------------------------------------
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

// ---- discovery -----------------------------------------------------------------------------------
function listMilestoneFolders(workDir) {
  if (!existsSync(workDir)) return [];
  return readdirSync(workDir)
    .filter((n) => /^\d+_(milestone|story|task|uat)_[a-z0-9-]+$/.test(n))
    .filter((n) => statSync(join(workDir, n)).isDirectory())
    .map((n) => {
      const [number, type, ...slug] = n.split("_");
      return { folder: n, number, type, slug: slug.join("_"), path: join(workDir, n) };
    });
}

// ---- parsers (reference, never restate: each record keeps its source path) ------------------------
function splitSections(md, headerRe) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let cur = null;
  lines.forEach((line, idx) => {
    if (headerRe.test(line)) {
      if (cur) sections.push(cur);
      cur = { header: line, line: idx + 1, body: [] };
    } else if (cur) cur.body.push(line);
  });
  if (cur) sections.push(cur);
  return sections;
}

const inlineField = (body, label) => {
  // matches "- **Label:** value" (single line) or "**Label.** value"
  const re = new RegExp(`\\*\\*${label}[:.]\\*\\*\\s*([\\s\\S]*?)(?:\\n\\s*\\n|\\n- \\*\\*|$)`, "i");
  const m = body.join("\n").match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
};

function parseRetro(md, item, sourceRel) {
  return splitSections(md, /^##\s+R\d+\b/).map((s) => {
    const hm = s.header.match(/^##\s+(R\d+)\s*[—-]\s*(.*)$/);
    const meta = s.body.find((l) => /\*\*Kind:\*\*/i.test(l)) || "";
    const kv = {};
    meta.split("·").forEach((part) => {
      const m = part.match(/\*\*([^:]+):\*\*\s*(.+)/);
      if (m) kv[m[1].trim().toLowerCase()] = m[2].replace(/\(.*?\)/g, "").trim();
    });
    const lesson = inlineField(s.body, "Lesson");
    const why = inlineField(s.body, "Why");
    const what = inlineField(s.body, "What happened");
    return {
      recordType: "lesson",
      id: hm ? hm[1] : s.header,
      item: item.number,
      itemSlug: item.slug,
      title: hm ? hm[2].trim() : "",
      kind: kv.kind || "",
      area: kv.area || "",
      stage: kv.stage || "",
      owner: kv.owner || "",
      lesson,
      text: [hm ? hm[2] : "", what, why, lesson].join(" \n "),
      source: `${sourceRel}:${s.line}`,
    };
  });
}

function parseAdrs(md, item, sourceRel) {
  return splitSections(md, /^##\s+ADR-\d+/).map((s) => {
    const hm = s.header.match(/^##\s+(ADR-\d+):\s*(.*)$/);
    const decision = inlineField(s.body, "Decision");
    const invariant = inlineField(s.body, "Invariant");
    const context = inlineField(s.body, "Context");
    const statusLine = s.body.find((l) => /\*\*Status:\*\*/i.test(l)) || "";
    return {
      recordType: "adr",
      id: hm ? hm[1] : s.header,
      item: item.number,
      itemSlug: item.slug,
      title: hm ? hm[2].trim() : "",
      area: "architecture",
      status: (statusLine.match(/\*\*Status:\*\*\s*(.+)/) || [, ""])[1].trim(),
      decision,
      invariant,
      text: [hm ? hm[2] : "", decision, invariant, context].join(" \n "),
      source: `${sourceRel}:${s.line}`,
    };
  });
}

// ---- the local backend: a derived index, rebuilt from source every reindex -----------------------
function buildIndex(workDir, only) {
  const records = [];
  for (const item of listMilestoneFolders(workDir)) {
    if (only && only !== item.number && only !== item.folder) continue;
    const retro = join(item.path, "RETROSPECTIVE.md");
    const arch = join(item.path, "ARCHITECTURE.md");
    const rel = (p) => p.replace(workDir + "\\", "").replace(workDir + "/", "").replace(/\\/g, "/");
    if (existsSync(retro)) records.push(...parseRetro(readFileSync(retro, "utf8"), item, rel(retro)));
    if (existsSync(arch)) records.push(...parseAdrs(readFileSync(arch, "utf8"), item, rel(arch)));
  }
  return { backend: "local", workDir, recordCount: records.length, records };
}

function loadIndex() {
  if (!existsSync(INDEX_PATH)) return null;
  return JSON.parse(readFileSync(INDEX_PATH, "utf8"));
}

// ---- retrieval -----------------------------------------------------------------------------------
const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2);

function score(record, queryTokens) {
  const hay = record.text.toLowerCase();
  let s = 0;
  for (const t of queryTokens) {
    const hits = hay.split(t).length - 1;
    s += hits;
    if (record.title.toLowerCase().includes(t)) s += 2; // title match is a strong signal
  }
  return s;
}

function recall(query, flags) {
  const idx = loadIndex();
  if (!idx) return fail("no index — run `reindex` first");
  const qt = tokenize(query);
  const scope = {
    area: flags.area, stage: flags.stage, kind: flags.kind, owner: flags.owner, item: flags.item,
  };
  const limit = Number(flags.limit || 5);
  const hits = idx.records
    .filter((r) => (!scope.area || (r.area || "").includes(scope.area)))
    .filter((r) => (!scope.stage || (r.stage || "").includes(scope.stage)))
    .filter((r) => (!scope.kind || (r.kind || "").includes(scope.kind)))
    .filter((r) => (!scope.owner || (r.owner || "").includes(scope.owner)))
    .filter((r) => (!scope.item || r.item === String(scope.item)))
    .map((r) => ({ r, s: qt.length ? score(r, qt) : 1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  if (flags.json) return console.log(JSON.stringify(hits.map((h) => h.r), null, 2));
  if (!hits.length) return console.log("(no matching memory)");
  console.log(`recall "${query}"  →  ${hits.length} hit(s)\n`);
  for (const { r, s } of hits) {
    const tag = r.recordType === "lesson" ? `${r.kind}/${r.area}` : `adr/${r.status}`;
    console.log(`  ▸ [${r.id} · m${r.item}] ${r.title}  (${tag}, score ${s})`);
    console.log(`    ${(r.lesson || r.invariant || r.decision || "").slice(0, 180)}`);
    console.log(`    ↳ ${r.source}\n`);
  }
}

function brief(flags) {
  const idx = loadIndex();
  if (!idx) return fail("no index — run `reindex` first");
  const recs = flags.item ? idx.records.filter((r) => r.item === String(flags.item)) : idx.records;
  const lessons = recs.filter((r) => r.recordType === "lesson");
  const adrs = recs.filter((r) => r.recordType === "adr");
  const byArea = {};
  lessons.forEach((r) => { byArea[r.area] = (byArea[r.area] || 0) + 1; });
  console.log(`memory brief${flags.item ? ` · milestone ${flags.item}` : " · whole stream"}`);
  console.log(`  ${lessons.length} lesson(s), ${adrs.length} ADR(s)`);
  console.log(`  lessons by area: ${Object.entries(byArea).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
  console.log(`\n  most recent lessons:`);
  lessons.slice(-3).reverse().forEach((r) =>
    console.log(`   ▸ [${r.id} · m${r.item}] ${r.title} — ${(r.lesson || "").slice(0, 90)}…`));
}

function reindex(workDir, only) {
  const idx = buildIndex(workDir, only);
  writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2));
  console.log(`reindex: ${idx.recordCount} record(s) from ${workDir}`);
  console.log(`  → derived index written to ${INDEX_PATH}`);
}

function status() {
  const idx = loadIndex();
  if (!idx) return console.log("memory status: backend=local  index=ABSENT (run reindex)");
  const lessons = idx.records.filter((r) => r.recordType === "lesson").length;
  const adrs = idx.records.filter((r) => r.recordType === "adr").length;
  console.log(`memory status: backend=${idx.backend}  records=${idx.recordCount} (${lessons} lessons, ${adrs} adrs)`);
  console.log(`  index: ${INDEX_PATH}`);
  console.log(`  source: ${idx.workDir}  (index is DERIVED — rebuild any time with reindex)`);
}

function fail(msg) { console.error(`memory: ${msg}`); process.exitCode = 1; }

// ---- dispatch ------------------------------------------------------------------------------------
const { positional, flags } = parseArgs(process.argv.slice(2));
const [verb, ...rest] = positional;
const workDir = flags.work ? resolve(flags.work) : DEFAULT_WORK_DIR;

switch (verb) {
  case "recall": recall(rest.join(" "), flags); break;
  case "brief": brief(flags); break;
  // ingest, for the LOCAL backend, == reindex of that item (derived store has no separate write path).
  // A semantic backend (MemPalace) would override this to push records; the verb shape is identical.
  case "ingest": reindex(workDir, flags.all ? null : rest[0]); break;
  case "reindex": reindex(workDir, flags.item || null); break;
  case "status": status(); break;
  default:
    console.log("aof work memory (SPIKE)\n  verbs: recall <query> | brief | ingest <item|--all> | reindex | status");
    console.log("  scope flags: --area --stage --kind --owner --item --limit --json --work <dir>");
}
