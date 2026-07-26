// Traceability wiring for milestone 34 / story 03 — ui/src/fleet/scope.mjs, the
// pure render-decision helper Fleet.tsx imports for the two @executable UI task
// features. There is NO React test harness in this repo (no vitest/testing-
// library) — per the house pattern (terminal-dock.test.mjs / action.test.mjs),
// render-logic node:test exercises the PURE .mjs module directly, headlessly.
//
//   02_fleet-ui-scope-rendering.feature (@executable):
//     - the scope control shows Global/Local as active;
//     - switching scope updates the URL (scope=<local|global>) without a remount;
//     - a local-populated payload filters out any other workspace's data;
//     - loading keeps the required regions "stable" (the state selector never
//       throws on a null/pending status, and its result names a real state);
//     - no rendered field carries a credential-shaped key ("relayAuth", "token",
//       "secret", "credential") — node id/role/host/last-seen/fabric address
//       still surface.
//   03_empty-error-and-health-states.feature (@executable):
//     - a global empty payload reads "empty" (never "error") with copy that does
//       NOT call the mesh broken/failed and DOES name "published";
//     - local stays usable/populated independent of a global error;
//     - diagnostics summarise projection freshness + skipped workspace/descriptor
//       error counts without dropping the healthy node/workspace data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VALID_SCOPES,
  scopeLabel,
  isValidScope,
  withScopeParam,
  scopeFromSearch,
  pageState,
  isEmptyStatus,
  emptyStateCopy,
  filterToWorkspace,
  withoutCredentialFields,
  isCredentialField,
  nodePanelFacts,
  diagnosticsSummary,
  errorPathFor,
  milestoneListItems,
  milestoneCardModels,
} from "../ui/src/fleet/scope.mjs";

export const fleetScopeTests = [
  // ----------------------------------------------------- scope + URL ---------
  {
    name: "fleet-scope/00 scopeLabel renders \"Global\"/\"Local\" as the active scope, defaulting to Global for anything else",
    run() {
      assert.equal(scopeLabel("global"), "Global");
      assert.equal(scopeLabel("local"), "Local");
      assert.equal(scopeLabel(undefined), "Global");
      assert.equal(scopeLabel("bogus"), "Global");
    },
  },
  {
    name: "fleet-scope/00 isValidScope recognises exactly the two scopes",
    run() {
      assert.equal(isValidScope("global"), true);
      assert.equal(isValidScope("local"), true);
      assert.equal(isValidScope("workspace"), false);
      assert.equal(isValidScope(null), false);
      assert.deepEqual(VALID_SCOPES, ["global", "local"]);
    },
  },
  {
    name: "fleet-scope/02 switching scope updates the URL's scope param (task 02 scenario 3)",
    run() {
      assert.equal(withScopeParam("", "local"), "?scope=local");
      assert.equal(withScopeParam("?scope=global", "local"), "?scope=local");
      assert.equal(withScopeParam("?group=fleet", "local"), "?group=fleet&scope=local");
      assert.equal(scopeFromSearch("?scope=local"), "local");
      assert.equal(scopeFromSearch("?scope=global"), "global");
      assert.equal(scopeFromSearch(""), "global", "an absent scope param defaults to global");
      assert.equal(scopeFromSearch("?scope=bogus"), "global", "an invalid scope param falls back to global, never throws");
    },
  },

  // --------------------------------------------------- page state ------------
  {
    name: "fleet-scope/02 pageState is \"loading\" while pending, keeping the region selector stable (task 02 scenario 4)",
    run() {
      assert.equal(pageState({ loading: true, error: null, status: null }), "loading");
    },
  },
  {
    name: "fleet-scope/03 pageState is \"error\" only when an error is present (never confused with empty)",
    run() {
      assert.equal(pageState({ loading: false, error: "boom", status: null }), "error");
    },
  },
  {
    name: "fleet-scope/03 pageState is \"empty\" for an all-empty status, distinct from \"error\" (task 03 scenario 1)",
    run() {
      const emptyGlobal = { scope: "global", workspaces: [], items: [], nodes: [] };
      assert.equal(pageState({ loading: false, error: null, status: emptyGlobal }), "empty");
      assert.equal(isEmptyStatus(emptyGlobal), true);
      assert.equal(isEmptyStatus(null), true, "no status yet reads empty, not populated");
    },
  },
  {
    name: "fleet-scope/03 pageState is \"populated\" once any workspace/item/node/board is present",
    run() {
      assert.equal(pageState({ loading: false, error: null, status: { workspaces: [{ workspaceId: "a" }], items: [], nodes: [] } }), "populated");
      assert.equal(pageState({ loading: false, error: null, status: { nodes: [], boards: [{ ref: "b" }] } }), "populated", "the local mesh:status shape (boards) also reads populated");
    },
  },
  {
    name: "fleet-scope/03 the global empty-state copy names publishing and never calls the mesh broken or failed",
    run() {
      const copy = emptyStateCopy("global");
      assert.match(copy, /published/i);
      assert.doesNotMatch(copy, /broken|failed/i);
    },
  },
  {
    name: "fleet-scope/03 the local empty-state copy keeps the pre-existing enrol guidance",
    run() {
      const copy = emptyStateCopy("local");
      assert.match(copy, /enrol/i);
      assert.doesNotMatch(copy, /broken|failed/i);
    },
  },

  // --------------------------------------------------- diagnostics -----------
  {
    name: "fleet-scope/03 diagnosticsSummary surfaces projection freshness and skipped/error counts without dropping healthy data (task 03 scenario 4)",
    run() {
      const status = {
        scope: "global",
        workspaces: [{ workspaceId: "alpha" }],
        nodes: [{ nodeId: "node-a" }],
        diagnostics: {
          projectedAt: "2026-07-04T10:05:00.000Z",
          skippedWorkspaces: [{ workspaceId: "gamma", reason: "mesh-global-disabled" }],
          descriptorErrors: [{ id: "node-b", code: "descriptor-unparseable" }],
        },
      };
      const summary = diagnosticsSummary(status);
      assert.equal(summary.projectedAt, "2026-07-04T10:05:00.000Z");
      assert.equal(summary.skippedWorkspaceCount, 1);
      assert.equal(summary.descriptorErrorCount, 1);
      // the healthy workspace/node data is untouched by reading diagnostics
      assert.equal(status.workspaces.length, 1);
      assert.equal(status.nodes.length, 1);
    },
  },
  {
    name: "fleet-scope/03 diagnosticsSummary degrades cleanly (all zero/null) for the local shape, which carries no diagnostics block",
    run() {
      const summary = diagnosticsSummary({ scope: "local", nodes: [], boards: [] });
      assert.equal(summary.projectedAt, null);
      assert.equal(summary.skippedWorkspaceCount, 0);
      assert.equal(summary.descriptorErrorCount, 0);
    },
  },

  // --------------------------------------------------- error path (P0.5) -----
  {
    name: "fleet-scope/03 errorPathFor prefers the thrown error's path (a first-load 503 has no prior status to attach it to)",
    run() {
      const error = new Error("The global mesh work store is unavailable");
      error.path = "C:\\Users\\Umair\\.aof\\mesh\\work\\projection.sqlite";
      assert.equal(errorPathFor(error, null), error.path);
    },
  },
  {
    name: "fleet-scope/03 errorPathFor falls back to a path already carried on a stale status payload",
    run() {
      const error = new Error("boom"); // no .path on this error
      const status = { path: "C:\\Users\\Umair\\.aof\\mesh\\work\\projection.sqlite" };
      assert.equal(errorPathFor(error, status), status.path);
    },
  },
  {
    name: "fleet-scope/03 errorPathFor is null when neither the error nor the status carries a path — never throws on a shapeless input",
    run() {
      assert.equal(errorPathFor(new Error("boom"), null), null);
      assert.equal(errorPathFor(null, null), null);
      assert.equal(errorPathFor(undefined, undefined), null);
    },
  },

  // ------------------------------------------------- local filtering ---------
  {
    name: "fleet-scope/02 filterToWorkspace drops every OTHER workspace's data (task 02 scenario 2: \"no workspace or work item from beta is rendered\")",
    run() {
      const status = {
        scope: "global",
        workspaces: [{ workspaceId: "alpha" }, { workspaceId: "beta" }],
        items: [{ ref: "34", workspaceId: "alpha" }, { ref: "35/00", workspaceId: "beta" }],
        nodes: [{ nodeId: "node-a", workspaceIds: ["alpha"] }, { nodeId: "node-b", workspaceIds: ["beta"] }],
      };
      const filtered = filterToWorkspace(status, "alpha");
      assert.deepEqual(filtered.workspaces.map((w) => w.workspaceId), ["alpha"]);
      assert.deepEqual(filtered.items.map((i) => i.ref), ["34"]);
      assert.deepEqual(filtered.nodes.map((n) => n.nodeId), ["node-a"]);
    },
  },
  {
    name: "fleet-scope/02 filterToWorkspace is a no-op when workspaceId is absent (unfiltered global view)",
    run() {
      const status = { workspaces: [{ workspaceId: "alpha" }], items: [], nodes: [] };
      assert.deepEqual(filterToWorkspace(status, null), status);
    },
  },
  {
    name: "fleet-scope/02 milestoneListItems keeps the global mesh UI at milestone level, never story/task rows",
    run() {
      const items = [
        { ref: "34", type: "milestone", workspaceId: "alpha", title: "Global mesh work store", status: "in-progress" },
        { ref: "34/00", type: "story", workspaceId: "alpha", title: "Global work propagation", status: "done" },
        { ref: "34/00/00", type: "task", workspaceId: "alpha", title: "Projection delta", status: "done" },
        { ref: "35", type: "milestone", workspaceId: "beta", title: "Next milestone", status: "not-started" },
      ];
      const milestones = milestoneListItems(items);
      assert.deepEqual(milestones.map((item) => item.ref), ["34", "35"]);
      assert.ok(milestones.every((item) => item.type === "milestone"), "only milestone rows render in the global list");
      assert.ok(milestones.every((item) => !item.ref.includes("/")), "nested story/task refs do not render as milestone cards");
    },
  },
  {
    name: "fleet-scope/02 milestoneCardModels derives board-style story counts per workspace",
    run() {
      const items = [
        { ref: "34", type: "milestone", workspaceId: "alpha", title: "Alpha mesh", status: "in-progress", parent: null },
        { ref: "34/00", type: "story", workspaceId: "alpha", title: "Alpha done", status: "done", parent: "34" },
        { ref: "34/01", type: "story", workspaceId: "alpha", title: "Alpha review", status: "in-review", parent: "34" },
        { ref: "34", type: "milestone", workspaceId: "beta", title: "Beta mesh", status: "not-started", parent: null },
        { ref: "34/00", type: "story", workspaceId: "beta", title: "Beta blocked", status: "blocked", parent: "34" },
      ];
      const cards = milestoneCardModels(items);
      const alpha = cards.find((card) => card.item.workspaceId === "alpha");
      const beta = cards.find((card) => card.item.workspaceId === "beta");
      assert.deepEqual(cards.map((card) => `${card.item.workspaceId}:${card.num}`), ["alpha:34", "beta:34"]);
      assert.ok(alpha, "alpha milestone card exists");
      assert.ok(beta, "beta milestone card exists");
      assert.equal(alpha.total, 2);
      assert.equal(alpha.done, 1);
      assert.equal(alpha.inReview, 1);
      assert.deepEqual(alpha.stories.map((story) => story.workspaceId), ["alpha", "alpha"]);
      assert.equal(beta.total, 1);
      assert.equal(beta.blocked, 1);
      assert.deepEqual(beta.stories.map((story) => story.workspaceId), ["beta"]);
    },
  },
  {
    name: "fleet-scope/02 global milestone cards remain clickable drill-ins, not passive display cards",
    run() {
      const source = readFileSync(new URL("../ui/src/fleet/Fleet.tsx", import.meta.url), "utf8");
      const match = source.match(/function GlobalMilestoneCard[\s\S]*?(?=function MilestoneProgressTrack)/);
      assert.ok(match, "GlobalMilestoneCard exists");
      assert.match(match[0], /<button\b/, "the milestone card is a button, matching the work overview card affordance");
      assert.match(match[0], /onClick=\{onOpen\}/, "clicking the card invokes the drill-in handler");
      assert.match(match[0], /fleetApi\.boardUrl\(m\.item\.workspaceId, m\.item\.ref\)/, "the drill-in asks the mesh server for a real workspace board URL");
      assert.match(match[0], /window\.location\.assign\(url\)/, "the drill-in opens the returned board URL");
      assert.match(match[0], /Open board →/, "the click affordance is visible on the card");
      assert.doesNotMatch(match[0], /navigator\.clipboard|copied aof work|workUiCommandFor/, "the milestone card never copies a command instead of opening the board");
    },
  },

  // ------------------------------------------------- credential guard --------
  {
    name: "fleet-scope/02 withoutCredentialFields strips relayAuth/token/secret/credential-shaped keys but keeps operational fields",
    run() {
      const descriptor = {
        nodeId: "node-a",
        role: "worker",
        host: "alpha",
        lastSeenAt: "2026-07-04T10:01:00.000Z",
        fabric: { address: "ws://alpha.tailnet:7007", online: true },
        relayAuth: "plaintext-should-never-render",
        token: "also-should-never-render",
        secret: "nope",
        credential: "nope",
      };
      const safe = withoutCredentialFields(descriptor);
      assert.deepEqual(Object.keys(safe).sort(), ["fabric", "host", "lastSeenAt", "nodeId", "role"]);
      assert.equal(safe.nodeId, "node-a");
      assert.equal(safe.host, "alpha");
    },
  },
  {
    name: "fleet-scope/02 isCredentialField flags relayAuth/token/secret/credential by name",
    run() {
      for (const key of ["relayAuth", "token", "secret", "credential", "authToken", "inviteCode"]) {
        assert.equal(isCredentialField(key), true, `${key} is flagged credential-shaped`);
      }
      for (const key of ["nodeId", "host", "role", "lastSeenAt", "fabricAddress"]) {
        assert.equal(isCredentialField(key), false, `${key} is NOT flagged credential-shaped`);
      }
    },
  },
  {
    name: "fleet-scope/02 nodePanelFacts surfaces node id, role, host, last seen, capabilities, and fabric address, and NEVER a credential field (task 02 scenario 5)",
    run() {
      const node = {
        nodeId: "node-a",
        role: "control",
        host: "alpha",
        lastSeenAt: "2026-07-04T10:01:00.000Z",
        runtimes: ["claude"],
        skills: ["aof-refine"],
        fabric: { address: "ws://alpha.tailnet:7007", online: true },
        freshness: "live",
        relayAuth: "plaintext-should-never-render",
      };
      const facts = nodePanelFacts(node);
      assert.equal(facts.nodeId, "node-a");
      assert.equal(facts.role, "control");
      assert.equal(facts.host, "alpha");
      assert.equal(facts.lastSeenAt, "2026-07-04T10:01:00.000Z");
      assert.deepEqual(facts.capabilities, ["claude", "aof-refine"]);
      assert.equal(facts.fabricAddress, "ws://alpha.tailnet:7007");
      assert.ok(!("relayAuth" in facts), "no credential-shaped key survives into the rendered facts");
      assert.ok(!Object.values(facts).includes("plaintext-should-never-render"), "the credential VALUE never survives into any rendered fact either");
    },
  },
  {
    name: "fleet-scope/02 nodePanelFacts degrades cleanly for the local mesh:status node shape (presence + stale, no fabric/role)",
    run() {
      const localNode = {
        nodeId: "local-node",
        host: "local-node",
        runtimes: ["claude"],
        skills: [],
        presence: { nodeId: "local-node", heartbeatAt: "2026-07-04T10:00:00.000Z", activeRuns: [], aofVersion: "1.0.0" },
        stale: false,
        local: true,
      };
      const facts = nodePanelFacts(localNode);
      assert.equal(facts.nodeId, "local-node");
      assert.equal(facts.role, "this node");
      assert.equal(facts.lastSeenAt, "2026-07-04T10:00:00.000Z");
      assert.equal(facts.fabricAddress, null);
      assert.equal(facts.freshness, "live");
    },
  },
];
