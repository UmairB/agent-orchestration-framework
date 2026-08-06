// Fitness function: acd-no-surface-mode-url-literal (m45 / ADR-002 + ADR-003) —
//
//   "No production module anywhere advertises a `?mode=` surface URL. The legacy
//    vocabulary survives in exactly ONE place — the route module that translates it
//    away — and every producer emits a PATH."
//
// EXPECTED RED until milestone 45's stories land. Seven violations exist today, and they
// are the milestone's edit list (measured 2026-08-06 at `eacbd57`):
//   src/board-serve.mjs:41,62                          `?mode=board`
//   src/mesh-ui-serve.mjs:143,736                       `?mode=fleet[&scope=…]`
//   src/commands/assets-ui.mjs:45,117                   `?mode=assets`
//   app/desktop/crates/app/src/supervisor.rs:44         `?mode=fleet&scope=global`  (COMPILED)
//   ui/src/board/Board.tsx:416                          `http://127.0.0.1:4181/?mode=fleet`
//   ui/src/board/DetailPanel.tsx:270                    `…/?mode=fleet&scope=global`
//   ui/src/fleet/Fleet.tsx:1398                         `/?mode=board`
//
// WHY THIS IS A STRUCTURAL RULE AND NOT A TIDY-UP. ADR-003's back-compat guarantee rests
// on a measurement: *every* URL this system has ever advertised carries `?mode=`, and
// nothing advertises a bare `/`. That is what makes the legacy translation total. The
// guarantee decays the instant a NEW producer emits the legacy form — the translation
// then has to keep working forever for URLs this codebase is still minting, and the
// address bar goes back to meaning two things at once. So the rule is not "clean these
// up"; it is "the legacy vocabulary is read-only, and only the translator may read it".
//
// SCOPE: production code only — `src/`, `ui/src/`, `app/desktop/`. The behavioural suites
// that assert an advertised URL *contains* `mode=` (test/mesh-ui-serve.test.mjs:126,303,
// test/board-serve.test.mjs:186, test/work-ui-verb-rename.test.mjs:187,
// test/mesh-ui-cli-face.test.mjs:205, test/mesh-ui-global-scope.test.mjs:219) change in the
// same story that changes the producers; they are the milestone's OWN proof, and having
// this gate also police them would report one change twice.
//
// COMMENTS ARE HISTORY, NOT CODE. `src/mesh-ui-serve.mjs:5,111`, `src/board-serve.mjs:61`,
// `src/board-mesh-execution.mjs:4`, `src/commands/mesh-ui.mjs:6,25` and `supervisor.rs:37-44`
// all narrate the legacy form in prose. This repo's comments carry real load (TECH_DEBT
// item 0.4 warns against the opposite failure), so they are stripped before matching — and
// the stripper is URL-aware, because the violations live INSIDE `http://…` literals.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCAN_ROOTS = ["src", path.join("ui", "src"), path.join("app", "desktop")];
const SCANNED_EXT = new Set([".mjs", ".js", ".ts", ".tsx", ".mts", ".rs"]);
// The ONE module allowed to name the legacy vocabulary: it owns the translation (ADR-003).
const LEGACY_ALLOWED = new Set(["ui/src/app/routes.mjs", "ui/src/app/routes.d.mts"]);

// A `?mode=<surface>` / `&mode=<surface>` URL selector literal.
const MODE_URL_LITERAL = /[?&]mode=(fleet|board|assets)\b/g;

// The four advertised-URL PRODUCERS (ADR-002's consequences), each with the route path it
// must name after the migration. Naming the path as a LITERAL at its producer is what makes
// ADR-002's enumeration checkable — `grep -rn "/fleet" src/` then finds every producer,
// which is the property that stops a fifth one appearing unseen.
const PRODUCERS = [
  { file: "src/board-serve.mjs", path: "/board", what: "the board launcher's `boardUrl` (:41 probe, :62 serve)" },
  { file: "src/mesh-ui-serve.mjs", path: "/fleet", what: "the fleet launcher's `fleetUrl` (:143 probe, :736 serve)" },
  { file: "src/commands/assets-ui.mjs", path: "/config", what: "the config editor's `uiUrl` (:45 serve, :117 probe) — `/config`, NOT `/assets`, because `/assets` is the built bundle's own asset directory (ui/dist/assets/index-*.js)" },
  { file: "app/desktop/crates/app/src/supervisor.rs", path: "/fleet", what: "the desktop tray's COMPILED `MESH_UI_URL` (:44) — a binary constant, which is also why ADR-003 sets no expiry on the legacy translation" },
];

// URL-aware comment stripping: a naive /\/\/[^\n]*/ deletes from the `//` in
// `href="http://127.0.0.1:4181/?mode=fleet"` onward, i.e. it hides the very violations
// this file looks for. Guarding on "not preceded by a colon" keeps `http://`/`ws://`
// intact while still removing real line comments (start-of-line or whitespace before).
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function sourceFiles(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "target" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) {
      await sourceFiles(full, out);
    } else if (SCANNED_EXT.has(path.extname(entry))) {
      out.push(path.relative(repoRoot, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

function modeLiterals(source) {
  return [...stripComments(source).matchAll(MODE_URL_LITERAL)].map((match) => match[0]);
}

export const archTests = [
  {
    name: "arch/45 ADR-003 (acd-no-surface-mode-url-literal): no production module in src/ · ui/src/ · app/desktop/ mints a `?mode=` surface URL — the legacy vocabulary is READ-ONLY, and only the translator reads it",
    run: async () => {
      const files = [];
      for (const root of SCAN_ROOTS) await sourceFiles(path.join(repoRoot, root), files);
      // Non-vacuity: the walker genuinely reached all three trees.
      assert.ok(files.length > 200, `the production trees were actually walked (non-vacuous): ${files.length} files`);
      for (const producer of PRODUCERS) {
        assert.ok(files.includes(producer.file), `the walker reaches ${producer.file} — ${producer.what}`);
      }

      const violations = [];
      for (const rel of files) {
        if (LEGACY_ALLOWED.has(rel)) continue;
        const hits = modeLiterals(await readFile(path.join(repoRoot, rel), "utf8"));
        if (hits.length > 0) violations.push(`${rel} → ${[...new Set(hits)].join(", ")}`);
      }

      const guidance = [
        "ADR-003's back-compat guarantee is total ONLY because every advertised URL carries the legacy",
        "selector and can therefore be translated once, at the entry, forever. A NEW producer emitting the",
        "legacy form re-opens the two-vocabularies problem the milestone closes. Emit the PATH (/fleet,",
        "/board, /config); the translation stays in ui/src/app/routes.mjs and nowhere else.",
      ].join(" ");
      assert.deepEqual(
        violations,
        [],
        `these modules mint a legacy ?mode= surface URL (m45/ADR-002, ADR-003):\n  ${violations.join("\n  ")}\n${guidance}`,
      );
    },
  },

  {
    name: "arch/45 ADR-002 (acd-no-surface-mode-url-literal): each of the four advertised-URL producers names its ROUTE PATH as a literal — the enumeration is checkable, so a fifth producer cannot appear unseen",
    run: async () => {
      const missing = [];
      for (const producer of PRODUCERS) {
        const code = stripComments(await readFile(path.join(repoRoot, producer.file), "utf8"));
        assert.ok(code.length > 200, `${producer.file} was actually read (non-vacuous)`);
        if (!code.includes(`"${producer.path}`) && !code.includes(`'${producer.path}`) && !code.includes(`\`${producer.path}`) && !code.includes(`${producer.path}?`) && !code.includes(`${producer.path}\``) && !code.includes(`${producer.path}"`)) {
          missing.push(`${producer.file} does not name "${producer.path}" — ${producer.what}`);
        }
      }
      assert.deepEqual(
        missing,
        [],
        `these advertised-URL producers do not yet emit their m45/ADR-002 path:\n  ${missing.join("\n  ")}`,
      );
    },
  },

  {
    name: "arch/45 (acd-no-surface-mode-url-literal): self-check — the detector fires on each REAL violation (including the ones inside `http://` literals and the Rust constant) and stays silent on the prose that narrates them",
    run: async () => {
      const realViolations = [
        'boardUrl: `http://127.0.0.1:${port}/?mode=board`,',
        'fleetUrl: `http://127.0.0.1:${port}/?mode=fleet&scope=${scope}`,',
        'const uiUrl = `http://127.0.0.1:${uiPort}/?mode=assets`;',
        'pub const MESH_UI_URL: &str = "http://127.0.0.1:4181/?mode=fleet&scope=global";',
        '<a className="underline" href="http://127.0.0.1:4181/?mode=fleet">',
        'href="/?mode=board"',
      ];
      for (const line of realViolations) {
        assert.ok(modeLiterals(line).length > 0, `the detector fires on the real violation: ${line}`);
      }

      const prose = [
        '// `url` already ends with "/", so this yields e.g. http://127.0.0.1:PORT/?mode=board.',
        '/// `/` renders BLANK, so the URL MUST carry `?mode=fleet&scope=global` — the exact URL',
        '// THE DEFECT: the board (`?mode=board#18`) showed a milestone',
      ];
      for (const line of prose) {
        assert.deepEqual(modeLiterals(line), [], `a COMMENT narrating the legacy form is history, not a producer: ${line}`);
      }

      // And the canonical post-45 form is clean — the gate is satisfiable.
      assert.deepEqual(modeLiterals('const fleetUrl = new URL("/fleet", url).toString();'), [], "the canonical path form passes");
    },
  },
];
