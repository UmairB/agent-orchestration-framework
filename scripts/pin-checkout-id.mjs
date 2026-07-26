#!/usr/bin/env node
// scripts/pin-checkout-id.mjs — repin an EXISTING scoped checkout's workspace id
// (m42 wave (b), TECH_DEBT item 4's migration leg).
//
// Checkouts cloned BEFORE the clone-time identity pin derive their id from their
// own path — a different id per machine for the same repo (the Mac's let-shield
// checkout answered 14d86b2b… while the fleet speaks 1f164bd0…), which refused
// the worker's launch-workspace frames and spammed workspace-workdir-unresolvable
// forever. This applies the SAME pin clone now applies, to a checkout that
// predates it.
//
//   node scripts/pin-checkout-id.mjs <checkoutPath> <workspaceId>
//
// Prints the before/after resolution. The daemon owning the checkout must be
// restarted to publish under the pinned id.
import { loadWorkspace } from "../src/work.mjs";
import { resolveWorkspaceId } from "../src/workspace-identity.mjs";
import { pinWorkspaceIdInCheckout } from "../src/mesh-worker-execution.mjs";

const [checkoutPath, workspaceId] = process.argv.slice(2);
if (!checkoutPath || !workspaceId) {
  console.error("Usage: node scripts/pin-checkout-id.mjs <checkoutPath> <workspaceId>");
  process.exit(1);
}

const before = resolveWorkspaceId(await loadWorkspace(checkoutPath));
await pinWorkspaceIdInCheckout(checkoutPath, workspaceId);
const after = resolveWorkspaceId(await loadWorkspace(checkoutPath));
console.log(`pinned ${checkoutPath}: ${before} -> ${after}`);
if (after !== workspaceId) {
  console.error("PIN DID NOT TAKE — the checkout still resolves a different id.");
  process.exit(1);
}
