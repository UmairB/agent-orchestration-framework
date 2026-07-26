// Fitness function for milestone 41 / RETROSPECTIVE R5 (the packaging axis of the
// registry trio, R3's sibling): "Adding a work:* command IMPLIES its Claude command."
//
// m41 shipped `work:insert-milestone`/`-story`/`-uat` (later `-chore`) at the CLI +
// engine layers and was accepted green — but src/bundle/commands/ carried only the
// `add-*` docs, never `insert-*`. So `aof work update` rendered NOTHING for the new
// commands: the feature existed in the CLI yet was undiscoverable/unusable through the
// ACD command surface it is meant to be driven from. No existing guard caught it — the
// CLI bijection (acd-work-command-cli-bijection) proves the CLI runs; nothing proved a
// bundle wrapper ships.
//
// The guard, REGISTRY-DERIVED (no carve-out, 'no new door'): every `work:insert-*`
// command in the registry must have a matching `src/bundle/commands/<sub>.md` bundle
// command member under the `aof` namespace — so a future insert command cannot ship
// CLI-only and silently skip its Claude command again. Scoped to the insert-* family
// (the placement twins of the `add-*` scaffolders); low-level read ops like
// `work:list`/`work:doc` are correctly NOT command-surfaced and are excluded.
import assert from "node:assert/strict";
import { listCommands } from "../../src/command-core.mjs";
import { readDescriptor } from "../../src/work-bundle.mjs";

// The registry-derived set: every `work:insert-*` command's op segment.
const insertSubcommands = () =>
  listCommands()
    .filter((command) => command.id.startsWith("work:insert-"))
    .map((command) => command.id.slice("work:".length))
    .sort();

// The declared bundle command members, keyed by id (the bundle member id is the
// bare op — `work:insert-milestone` ↔ member id `insert-milestone`).
const bundleCommandMembers = () =>
  new Map(
    readDescriptor()
      .members.filter((member) => member.kind === "command")
      .map((member) => [member.id, member])
  );

export const archTests = [
  {
    name: "arch/m41 R5: every work:insert-* command has a matching bundle command wrapper (usable via `aof work update`, not CLI-only)",
    run: async () => {
      const subs = insertSubcommands();
      assert.ok(subs.length > 0, "the registry has at least one work:insert-* command");
      const members = bundleCommandMembers();
      for (const sub of subs) {
        const member = members.get(sub);
        assert.ok(
          member != null,
          `work:${sub} has a bundle command member "${sub}" (src/bundle/commands/${sub}.md) — a work:* command is not usable through the ACD command surface without its Claude command (m41 R5)`
        );
        assert.equal(
          member.commandNamespace,
          "aof",
          `bundle command "${sub}" renders under the aof namespace (so it installs as /aof:${sub})`
        );
      }
    },
  },
];
