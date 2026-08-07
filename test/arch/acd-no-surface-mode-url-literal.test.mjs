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
//
// ── THE CLOSING ASSERTION (added 2026-08-07, at the architect's structural review of 45/04).
// This file shipped with TWO checks and a NAME that promised a third. The second assertion
// was called "the enumeration is checkable, so a fifth producer cannot appear unseen" — but
// its body iterates `PRODUCERS`, a hand-maintained four-entry list, so it can only ever say
// something about those four files. MEASURED, in a sandbox copy of the 45/04 tree: dropping a
// new `src/` module that returns `` `http://127.0.0.1:${port}/fleet?repo=demo` `` left all
// three assertions GREEN, while the same module minting `?mode=fleet` was caught. The LEGACY
// half of the vocabulary was ratcheted; the PATH half was not, and the name said otherwise.
//
// So the two rules are now stated separately and each is named for what it does:
//   - the LEGACY ban (assertion 1) — an open sweep: nobody may mint `?mode=`.
//   - the four listed producers each name their path (assertion 2) — a CLOSED list, and its
//     name now says "these four" instead of claiming to see a fifth.
//   - the CLOSING rule (assertion 3, new) — the open sweep the name was promising: every file
//     in `src/` · `ui/src/` · `app/desktop/` that mints an ADR-002 ROUTE PATH must be one of
//     the eight files declared here. A fifth producer now fails CI naming its two remedies.
// This matters because milestones 47, 49 and 50 each plausibly add a URL producer, and
// ADR-002's "small, enumerable edit set — not a sweep" is exactly the property that decays
// the moment one appears that nobody enumerated.
//
// WHY A LITERAL SWEEP IS THE RIGHT DETECTOR HERE, and what it deliberately does NOT do. It
// cannot see a path composed at runtime from a variable — that half is behavioural and is
// owned by `test/in-app-cross-links.test.mjs` (no RENDERED anchor names `mode`) and by
// `test/advertised-paths.test.mjs` (every launcher's real `--json` and announce channel).
// The two halves are complementary by construction: a hand-rolled copy fails the gate without
// failing those suites, and a runtime-composed selector fails those suites without failing the
// gate. Neither is a substitute for the other, and saying so here stops a later reader
// mistaking one green for both.
//
// `ui/src/app/shell-nav.mjs` is deliberately NOT on the allow-list, though it is the shell's
// navigation home: it derives every href from `ROUTES` (`ROUTES.filter(...)`, `route.path`) and
// names no literal at all. Allow-listing it would pre-authorise a hard-coded path in the one
// module whose whole design is not to have one.
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

// An ADR-002 ROUTE PATH minted as a literal. The two lookarounds are what make this a
// ROUTE detector rather than a `/fleet|/board|/config` grep, and both were measured against
// the real tree (295 files, 8 hits, zero false positives):
//   - LEADING `["'\`}\d]` — a route literal either OPENS a string (`"/board"`,
//     `new URL("/fleet", url)`) or follows an authority (`` `…:${port}/board` `` → `}`;
//     Rust's `"http://127.0.0.1:4181/fleet?scope=global"` → `1`). It never follows a LETTER,
//     which is what spares `/api/config`, `/api/config/sections` and `/api/mesh/board-url`.
//   - TRAILING `["'\`?#\s,);]|$` — a route literal ENDS there. It is never followed by `/`
//     or `-`, which is what spares the import paths `@/board/Board`, `../board/runs.mjs`
//     and, again, `/api/mesh/board-url`.
// Both exclusions are pinned by the self-check below, so this reasoning is tested, not
// asserted. Comments are stripped first, exactly as the legacy detector does.
const ROUTE_PATH_LITERAL = /(?<=["'`}\d])\/(fleet|board|config)(?=["'`?#\s,);]|$)/gm;

// The four advertised-URL PRODUCERS (ADR-002's consequences), each with the route path it
// must name after the migration. Naming the path as a LITERAL at its producer is what makes
// ADR-002's enumeration checkable — `grep -rn "/fleet" src/` then finds every producer, and
// assertion 3 below is what turns that from a habit into a gate.
const PRODUCERS = [
  { file: "src/board-serve.mjs", path: "/board", what: "the board launcher's `boardUrl` (:41 probe, :62 serve)" },
  { file: "src/mesh-ui-serve.mjs", path: "/fleet", what: "the fleet launcher's `fleetUrl` (:143 probe, :736 serve)" },
  { file: "src/commands/assets-ui.mjs", path: "/config", what: "the config editor's `uiUrl` (:45 serve, :117 probe) — `/config`, NOT `/assets`, because `/assets` is the built bundle's own asset directory (ui/dist/assets/index-*.js)" },
  { file: "app/desktop/crates/app/src/supervisor.rs", path: "/fleet", what: "the desktop tray's COMPILED `MESH_UI_URL` (:44) — a binary constant, which is also why ADR-003 sets no expiry on the legacy translation" },
];

// The OTHER four files allowed to name a route path, and why each one has to. Together with
// PRODUCERS these are the eight — the CLOSED set assertion 3 holds the tree to.
//
// Each entry is a NAMED exemption, not a blanket one, and the set is SHRINK-ONLY: assertion 3
// also fails when a declared file stops matching, so a cross-link that milestone 46/47 deletes
// or rewrites takes its line here with it rather than leaving a stale exemption behind. That
// is the same shape `acd-shell-z-ladder-single-home` uses for its one retiring exemption.
const ROUTE_VOCABULARY_ALLOWED = [
  {
    file: "ui/src/app/routes.mjs",
    why: "the ONE route table (ADR-001) — the authoritative home of the path vocabulary, and the module every other `ui/` consumer derives from. `ui/src/app/shell-nav.mjs` and `ui/src/app/Landing.tsx` read it rather than naming a literal, which is why neither is listed here.",
  },
  // The three hard-coded in-app cross-links (ADR-002's consequence, story 45/04). They are
  // literals rather than table reads because each is a CROSS-ORIGIN address: the first two
  // name the fleet's FIXED :4181 from a board whose own port is ephemeral, and the third is
  // deliberately relative. See `test/in-app-cross-links.test.mjs` for their behavioural half.
  {
    file: "ui/src/board/Board.tsx",
    why: "the dead-server banner's \"the fleet\" link — absolute on :4181, because a board port is ephemeral and the fleet's is not",
  },
  {
    file: "ui/src/board/DetailPanel.tsx",
    why: "the \"watch on the fleet\" link — absolute on :4181, still carrying `scope=global` as a real parameter on the path",
  },
  {
    file: "ui/src/fleet/Fleet.tsx",
    why: "the local-board drill-in's \"Open board →\" — deliberately RELATIVE, reproducing HEAD's behaviour exactly (m45/STATE defers the dead-end to milestone 47, which becomes the fleet surface's owner)",
  },
];

// The closed set: the four producers plus the four above. Anything else that mints a route
// path is a fifth producer nobody enumerated — which is precisely what assertion 3 exists
// to refuse.
const ROUTE_VOCABULARY_FILES = new Set([...PRODUCERS.map((p) => p.file), ...ROUTE_VOCABULARY_ALLOWED.map((a) => a.file)]);

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

function routePathLiterals(source) {
  return [...stripComments(source).matchAll(ROUTE_PATH_LITERAL)].map((match) => match[0]);
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
    // NAME CORRECTED 2026-08-07 (architect's structural review of 45/04). This assertion
    // iterates a CLOSED four-entry list, so it can only ever speak about those four files; it
    // previously claimed "…so a fifth producer cannot appear unseen", which it does not check
    // and which measurably was not true. That claim now lives on assertion 3, which delivers it.
    name: "arch/45 ADR-002 (acd-no-surface-mode-url-literal): each of THESE FOUR advertised-URL producers names its ROUTE PATH as a literal (the closed list — the open sweep for a fifth is the next assertion)",
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
    name: "arch/45 ADR-002 (acd-no-surface-mode-url-literal): the route-path vocabulary is a CLOSED set of eight declared files — a FIFTH producer minting `/fleet` · `/board` · `/config` cannot appear unseen",
    run: async () => {
      const files = [];
      for (const root of SCAN_ROOTS) await sourceFiles(path.join(repoRoot, root), files);
      assert.ok(files.length > 200, `the production trees were actually walked (non-vacuous): ${files.length} files`);

      const found = new Map();
      for (const rel of files) {
        const hits = routePathLiterals(await readFile(path.join(repoRoot, rel), "utf8"));
        if (hits.length > 0) found.set(rel, [...new Set(hits)].sort());
      }

      // NON-VACUITY, the house way: the detector must actually FIRE on the real tree, and on
      // every producer ADR-002 names. A regex that silently matched nothing would otherwise
      // report "no fifth producer" forever — the exact failure this whole assertion was
      // added to close, one layer up.
      for (const producer of PRODUCERS) {
        assert.deepEqual(
          found.get(producer.file),
          [producer.path],
          `the detector fires on ${producer.file}, which must mint exactly ${producer.path} — ${producer.what}`,
        );
      }
      // (The other four declared files carry the same non-vacuity load through the `stale`
      // check below, which is strictly stronger than a count: "every declared file was found"
      // implies the count, and it can also NAME the one that went missing.)

      // (a) nobody OUTSIDE the declared eight mints a route path.
      const undeclared = [...found.keys()]
        .filter((rel) => !ROUTE_VOCABULARY_FILES.has(rel))
        .map((rel) => `${rel} → ${found.get(rel).join(", ")}`);

      // (b) and no declared file has stopped minting one — a named exemption that no longer
      //     applies is a stale exemption, and this table is shrink-only.
      const stale = [...ROUTE_VOCABULARY_FILES].filter((rel) => !found.has(rel));

      const guidance = [
        "ADR-002's edit set is 'small and ENUMERABLE — not a sweep', and that is only true while every",
        "site minting a route path is written down. Two remedies, and the right one is usually the second:",
        "  (1) this really is a new advertised-URL producer — add it to PRODUCERS (with its path) or to",
        "      ROUTE_VOCABULARY_ALLOWED (with the reason it must name a literal), so the enumeration stays honest; or",
        "  (2) it should not be minting one at all — derive the path from `ui/src/app/routes.mjs`'s table",
        "      (the way `ui/src/app/shell-nav.mjs` does), or, in `src/` and `app/desktop/` where that import",
        "      direction is forbidden (ADR-004), route the URL through the producer that already owns it.",
      ].join("\n");

      assert.deepEqual(
        undeclared,
        [],
        `these files mint an m45/ADR-002 route path but are not declared in this gate:\n  ${undeclared.join("\n  ")}\n${guidance}`,
      );
      assert.deepEqual(
        stale,
        [],
        `these files are declared as route-path homes but no longer name one — delete the stale exemption (this table is shrink-only):\n  ${stale.join("\n  ")}`,
      );
    },
  },

  {
    name: "arch/45 (acd-no-surface-mode-url-literal): self-check — BOTH detectors fire on each real minted URL (legacy and route-path, including the ones inside `http://` literals and the Rust constant) and both stay silent on the prose, the API namespaces and the import specifiers that look like them",
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

      // ── The ROUTE-PATH detector's own self-check (added with assertion 3). Its whole value
      // is the two lookarounds, so both halves are pinned: what it MUST catch, and the
      // innocent look-alikes it must spare. Without this, a regex tightened until the tree
      // went green would be indistinguishable from one that works.
      const fifthProducerShapes = [
        // the exact sandbox probe that proved the gap: a new producer, no legacy literal
        'return `http://127.0.0.1:${port}/fleet?repo=demo`;',
        'const boardUrl = new URL("/board", url).toString();',
        'const uiUrl = `http://127.0.0.1:${uiPort}/config`;',
        'pub const MESH_UI_URL: &str = "http://127.0.0.1:4181/fleet?scope=global";',
        '<a className="underline" href="http://127.0.0.1:4181/fleet">',
        'href="/board"',
        'url.pathname = "/fleet";',
        'window.location.assign(`${origin}/board#${ref}`);',
      ];
      for (const line of fifthProducerShapes) {
        assert.ok(routePathLiterals(line).length > 0, `the route detector fires on a minted route path: ${line}`);
      }

      const notRoutePaths = [
        // API namespaces — `/config` and `/board` appear INSIDE a longer path here, and the
        // leading-letter exclusion is what spares them. These are real lines from the tree
        // (ui/src/config/App.tsx, src/mesh-ui-serve.mjs) and there are dozens more like them.
        'const response = await fetch("/api/config");',
        'await fetch("/api/config/sections", { method: "POST" });',
        'if (pathname === "/api/mesh/board-url") {',
        'const response = await fetch(`/api/mesh/board-url?${params.toString()}`);',
        // import specifiers — the trailing `/` exclusion is what spares these
        'import { Board } from "@/board/Board";',
        'import { runStateChip } from "../board/runs.mjs";',
        'import { freshness } from "../board/freshness.mjs";',
        // a route ID is not a route path (ui/src/app/routes.d.mts:11) — no leading slash
        'export type RouteId = "landing" | "fleet" | "board" | "config" | "not-found";',
        // and the legacy form is the OTHER detector's business, not this one's
        'boardUrl: `http://127.0.0.1:${port}/?mode=board`,',
      ];
      for (const line of notRoutePaths) {
        assert.deepEqual(routePathLiterals(line), [], `an API path, an import specifier or a route ID is NOT a minted route path: ${line}`);
      }

      // A COMMENT narrating a route path is history too — the same rule the legacy detector
      // keeps, and this file's own header is full of exactly these lines.
      assert.deepEqual(routePathLiterals('// `/` renders the shell landing, `/fleet` the fleet, `/board` the board.'), [], "prose naming the routes is history, not a producer");
    },
  },
];
