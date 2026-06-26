// Fitness function for milestone 08 / ADR-004 inv. 1, GENERALISED by milestone 15
// / ADR-005 from "exactly six" to REGISTRY-DERIVED (route ↔ command BIJECTION):
// "The /api/work/<op> set served by board-ui.mjs is in BIJECTION with the
//  registry's work:* commands — every served route maps to a registered work:<op>
//  command, AND every registered work:* command has a served route. The set is
//  DERIVED from listCommands() (NOT hard-coded), so adding work:doctor (the 7th) —
//  or any future work:* — is covered with no edit ('no new door')."
//
// Structural proof: source-grep `board-ui.mjs` for the `pathname === "/api/work/<op>"`
// route literals, and derive the command op set from
// `listCommands().filter(c=>c.id.startsWith("work:")).map(c=>c.id.slice(5))`. Assert
// the two-way map: (a) every served route maps to a registered work:<op> command;
// (b) every registered work:* command has a served route. (graph:*/project:*/
// import:* are NOT served on /api/work and are correctly excluded by the prefix.)
// Behavioural proof (the acd-board-single-server stand-up idiom): build a temp
// fixture stream, stand up `serveSetupUi(null,{projectDir,port:0})`, loop the
// DERIVED op set hitting each `/api/work/<op>` route, asserting a JSON envelope
// (200/4xx) — i.e. each route is served via the registry, not 404-unrouted.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCommand, listCommands } from "../../src/command-core.mjs";
import { serveSetupUi } from "../../src/setup-ui.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOARD_UI = path.join(repoRoot, "src", "board-ui.mjs");

// The op set DERIVED from the registry — every work:* command's op segment. This
// is the canonical set the bijection is asserted over (NOT a hard-coded literal),
// so a new work:* command (15's doctor, or any future one) is covered with no edit.
const commandOps = () =>
  listCommands()
    .filter((command) => command.id.startsWith("work:"))
    .map((command) => command.id.slice("work:".length))
    .sort();

// Discount comments so a comment naming a route literal is not counted as a route.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Extract the op segment from every `pathname === "/api/work/<op>"` route literal.
function routeOps(source) {
  const ops = new Set();
  const re = /pathname\s*===\s*["']\/api\/work\/([\w-]+)["']/g;
  let match;
  while ((match = re.exec(source)) !== null) ops.add(match[1]);
  return [...ops].sort();
}

async function buildFixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-route-coverage-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const storyDir = path.join(workDir, "03_milestone_board", "stories", "01_story_board");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(workDir, "03_milestone_board", "SPEC.md"),
    "---\ntype: milestone\nnumber: 03\nslug: board\nstatus: in-progress\ntitle: \"Board\"\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 03\n",
    "utf8"
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    "---\ntype: story\nnumber: 01\nslug: board\nstatus: in-progress\ntitle: \"Board story\"\nparent: 3\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n",
    "utf8"
  );
  await writeFile(path.join(storyDir, "STATE.md"), "# 01 · State\n", "utf8");
  return repo;
}

// One request per op against the running board. Reads are GET; feedback is a POST
// with a valid body (so it answers 200, not 400 missing-note) — the point is that
// the ROUTE is served via the registry, whatever the status.
async function hitRoute(url, op) {
  if (op === "feedback") {
    return fetch(new URL("/api/work/feedback", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "03/01", note: "route coverage probe", actor: "arch-test" }),
    });
  }
  const query =
    op === "doc" ? "?ref=03&doc=SPEC"
    : op === "tasks" ? "?ref=03/01"
    : "";
  // doctor is a read like list/validate — a bare GET answers the advisory envelope.
  return fetch(new URL(`/api/work/${op}${query}`, url));
}

export const archTests = [
  {
    name: "arch/15 ADR-005: the served /api/work routes are in BIJECTION with the registry's work:* commands (registry-derived, not hard-coded)",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      const served = routeOps(source);
      const commands = commandOps();
      // The two-way bijection: the served-route set equals the registry-derived
      // work:* op set. Adding work:doctor (the 7th) is covered with no edit — the
      // expectation is DERIVED from listCommands(), not a literal six.
      assert.deepEqual(
        served,
        commands,
        `board-ui.mjs serves exactly the registry's work:* ops {${commands.join(", ")}} — got {${served.join(", ")}}`
      );
    },
  },
  {
    name: "arch/15 ADR-005: every served route maps to a registered work:<op> command (no UI route without a command)",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      for (const op of routeOps(source)) {
        const id = `work:${op}`;
        const command = getCommand(id);
        assert.ok(command, `route /api/work/${op} maps to a registered command id "${id}" (getCommand is defined)`);
        assert.equal(command.id, id, `getCommand("${id}").id is "${id}"`);
      }
    },
  },
  {
    name: "arch/15 ADR-005: every registered work:* command has a served /api/work route (no command without a door)",
    run: async () => {
      const served = new Set(routeOps(stripComments(await readFile(BOARD_UI, "utf8"))));
      for (const op of commandOps()) {
        assert.ok(served.has(op), `registered command work:${op} has a served /api/work/${op} route (no command without a door)`);
      }
    },
  },
  {
    name: "arch/15 ADR-005 (behavioural): each /api/work route answers a JSON envelope via the registry (looped over the derived set)",
    run: async () => {
      const repo = await buildFixture();
      const { server, url } = await serveSetupUi(null, { projectDir: repo, port: 0 });
      try {
        for (const op of commandOps()) {
          const response = await hitRoute(url, op);
          // Served via the registry → a JSON envelope (2xx success or 4xx error),
          // NEVER an unrouted 404-not-found or a 5xx crash.
          assert.ok(
            response.status < 500,
            `/api/work/${op} answers without a server error (got ${response.status})`
          );
          assert.ok(
            response.headers.get("content-type")?.includes("application/json"),
            `/api/work/${op} answers with a JSON envelope`
          );
          const body = await response.json();
          assert.ok(body !== null && body !== undefined, `/api/work/${op} returns a JSON body`);
          // An error envelope must be the frozen { ok:false, error, code } shape;
          // a 404 here would mean the route is NOT served (the failure inv.1 guards).
          if (response.status >= 400) {
            assert.notEqual(
              body.code,
              "not-found",
              `/api/work/${op} is a SERVED route, not an unrouted /api/work* 404`
            );
          }
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
