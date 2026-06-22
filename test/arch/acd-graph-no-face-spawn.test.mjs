// Fitness function for milestone 09 / ADR-006 inv. 2 (the load-bearing no-direct-
// spawn guard; ADR-002 + ADR-005, amended 2026-06-21 / PO split):
// "The ONLY spawn/exec of the `graphify` binary anywhere in src/ is in
//  src/graphify.mjs. No rendered face (the skill/MCP asset bodies, the board),
//  no `src/commands/graph-*.mjs`, AND no MCP server runtime (the `aof graph serve`
//  server module, src/graph-mcp-server.mjs) spawns graphify — the faces and the
//  server reach the graph ONLY through `invoke('graph:…')`."
//
// House discipline (mirrors acd-terminal-server-only / acd-work-command-no-
// subprocess): the grep is CALL-FORM, comments + string literals DISCOUNTED. The
// graph command modules and the MCP server module carry the words "graphify" and
// "spawn" in COMMENTS (documenting that they do NOT spawn) — those must NOT trip
// the guard. We strip comments and strings before grepping, then assert against
// the live code only.
//
// Two proofs:
//   (a) the SOLE graphify spawn site: scan every src/**/*.mjs (code only) for a
//       child-process call-form (spawn/spawnSync/exec/execSync/execFile/
//       execFileSync) whose target is the graphify binary (the GRAPHIFY_BINARY
//       constant, a `graphify`/`graphifyy` literal, or a binary handle the file
//       obtained from resolveGraphifyBinary — `resolved.path`/`binaryPath`).
//       Assert the ONLY file with such a spawn is src/graphify.mjs.
//   (b) the faces + commands + server spawn NOTHING: src/graph-faces.mjs,
//       src/graph-mcp-server.mjs, and every src/commands/graph-*.mjs contain ZERO
//       child-process call-forms at all, and import NOTHING from node:child_process
//       (they reach the graph only via the registry / the driver's pure helpers).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const DRIVER_REL = path.join("src", "graphify.mjs");

// Strip line + block comments AND string/template literals, so a grep sees only
// live code. Order matters: comments first (a `//` inside a string is handled by
// removing strings after, but a string delimiter inside a comment must not start
// a fake string) — we run a single linear scan that respects all four contexts.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; }
      i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; }
      if (c === "\n") out += "\n";
      i += 1; continue;
    }
    // string/template body — emit a space, honour escapes, end on the delimiter.
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      state = "code"; i += 1; continue;
    }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

async function collectMjs(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMjs(full)));
    } else if (entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

// A child-process call-form: a spawn/exec family call against SOME argv[0]. We
// only need to know the file invokes a subprocess at all (the grep already runs
// on comment+string-stripped code).
const CHILD_PROCESS_CALL = /\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(/;

// A spawn whose target is the graphify binary: argv[0] is the GRAPHIFY_BINARY
// constant, a `graphify`/`graphifyy` literal (string literals are stripped, so a
// bare identifier `graphify`/`graphifyy` would be a variable — still a signal), a
// `resolved.path`/`binaryPath`/`resolved.binary` handle (the resolver's return),
// or the literal binary name appears as the first call argument.
const GRAPHIFY_SPAWN = new RegExp(
  "\\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\\s*\\(\\s*" +
    "(GRAPHIFY_BINARY|graphifyy?|resolved\\.(path|binary)|binaryPath)\\b"
);

// FIX 4 — the bare-LITERAL guard. Proof (a) strips string literals, so a spawn
// whose argv[0] is a BARE STRING `"graphify"`/`"graphifyy"` (rather than the
// resolved handle) would be invisible to it — and proof (b) only covers a fixed
// target list, so such a call in a FUTURE non-driver module outside that list
// would slip through. This regex runs over the RAW (string-RETAINED) source: a
// spawn/exec family call whose FIRST argument is a `graphify`/`graphifyy` string
// literal (single, double, or template-quoted). Comments are stripped first (a
// documented example in prose must not trip it); the matched form is specifically
// the literal-binary-as-first-spawn-arg.
const GRAPHIFY_LITERAL_SPAWN = new RegExp(
  "\\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\\s*\\(\\s*" +
    "[\"'`]graphifyy?[\"'`]"
);

// Strip ONLY comments (line + block), KEEPING string literals — so the bare-literal
// guard can see a `"graphify"` argv[0] while a `graphify` mention in a comment is
// discounted.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/ADR-006 inv.2: the ONLY graphify-binary spawn in src/ is in src/graphify.mjs",
    run: async () => {
      const files = await collectMjs(srcDir);
      assert.ok(files.length > 0, "found src/*.mjs files to scan");
      const offenders = [];
      let driverHasSpawn = false;
      for (const file of files) {
        const rel = path.relative(repoRoot, file);
        const code = stripCommentsAndStrings(await readFile(file, "utf8"));
        if (GRAPHIFY_SPAWN.test(code)) {
          if (rel === DRIVER_REL) driverHasSpawn = true;
          else offenders.push(rel);
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `only src/graphify.mjs may spawn the graphify binary; offenders: ${offenders.join(", ")}`
      );
      assert.ok(driverHasSpawn, "src/graphify.mjs IS the graphify spawn site (the sole driver seam)");
    },
  },
  {
    name: "arch/ADR-006 inv.2: the graph faces, the MCP server runtime, and the graph:* command modules spawn NOTHING",
    run: async () => {
      // The face + server + command surfaces that ADR-005/006 forbid from
      // spawning graphify (or any subprocess) — they reach the graph only through
      // invoke()/the driver's pure helpers.
      const faceFiles = [
        path.join(srcDir, "graph-faces.mjs"),
        path.join(srcDir, "graph-mcp-server.mjs"),
      ];
      const commandFiles = (await readdir(path.join(srcDir, "commands")))
        .filter((name) => /^graph-.*\.mjs$/.test(name))
        .map((name) => path.join(srcDir, "commands", name));
      const targets = [...faceFiles, ...commandFiles];
      assert.ok(commandFiles.length >= 3, `found the graph:* command modules (got ${commandFiles.length})`);

      for (const file of targets) {
        const rel = path.relative(repoRoot, file);
        const raw = await readFile(file, "utf8");
        const code = stripCommentsAndStrings(raw);
        // No child-process call-form at all (live code only — the documenting
        // comments that mention "spawn" are stripped).
        assert.ok(
          !CHILD_PROCESS_CALL.test(code),
          `${rel} contains no spawn/exec call-form (reaches the graph via invoke/the driver, not a spawn)`
        );
        // And it imports nothing from node:child_process.
        assert.ok(
          !/child_process/.test(code),
          `${rel} does not import node:child_process`
        );
      }
    },
  },
  {
    name: "arch/ADR-006 inv.2 (FIX 4): no src/ module (except the driver) spawns a bare \"graphify\" literal as argv[0]",
    run: async () => {
      // The bare-literal guard: a future non-driver module could spawn the binary
      // by NAME (`spawnSync("graphify", …)`) — which proof (a) misses (it strips
      // string literals) and proof (b) misses (it only covers a fixed target list).
      // Scan the COMMENT-stripped-but-string-RETAINED source of EVERY src/**/*.mjs
      // except the driver: none may pass a `graphify`/`graphifyy` string literal as
      // a spawn/exec family call's FIRST argument.
      const files = await collectMjs(srcDir);
      assert.ok(files.length > 0, "found src/*.mjs files to scan");
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file);
        if (rel === DRIVER_REL) continue; // the driver is the sole spawn site
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        if (GRAPHIFY_LITERAL_SPAWN.test(code)) offenders.push(rel);
      }
      assert.deepEqual(
        offenders,
        [],
        `no non-driver src/ module may spawn a bare "graphify"/"graphifyy" literal; offenders: ${offenders.join(", ")}`
      );

      // Self-check: the guard WOULD catch the injected violation (it is not vacuous).
      assert.ok(GRAPHIFY_LITERAL_SPAWN.test('spawnSync("graphify", ["extract"])'), "the guard catches spawnSync(\"graphify\", …)");
      assert.ok(GRAPHIFY_LITERAL_SPAWN.test("spawn('graphifyy', [])"), "the guard catches spawn('graphifyy', …)");
      assert.ok(!GRAPHIFY_LITERAL_SPAWN.test("spawnSync(resolved.path, args)"), "the guard does NOT flag the resolved-handle spawn (the driver's legitimate form)");
    },
  },
];
