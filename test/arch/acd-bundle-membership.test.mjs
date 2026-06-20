// Fitness function for milestone 01 / ADR-001, ADR-002:
// "The bundle root contains exactly the declared ACD actor set — the 8 agents,
//  the documented ACD commands, and the milestone templates — with no undeclared
//  file in the bundle root and no declared member missing on disk."
//
// Load the descriptor; assert the declared-member set == the set of member files
// in the bundle root, and assert the declared agent ids equal the 8 ACD actors.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readDescriptor, bundleRoot } from "../../src/work-bundle.mjs";

// The 8 ACD agents (product-owner, researcher, architect, designer, developer,
// qa, security, compliance) — the frozen actor set.
const ACD_AGENT_IDS = [
  "aof-architect",
  "aof-compliance",
  "aof-designer",
  "aof-developer",
  "aof-product-owner",
  "aof-qa",
  "aof-researcher",
  "aof-security"
].sort();

// Files in the bundle root that are bundle MACHINERY, not declared members.
const NON_MEMBER_FILES = new Set(["bundle.json", "manifest.json"]);

// Recursively collect every file under the bundle root, relative + forward-slashed.
function bundleFiles(root) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else files.push(rel);
    }
  };
  walk(root, "");
  return files;
}

export const archTests = [
  {
    name: "arch/ADR-001: the bundle declares exactly the 8 ACD agents",
    run: async () => {
      const declaredAgents = readDescriptor()
        .members.filter((m) => m.kind === "agent")
        .map((m) => m.id)
        .sort();
      assert.deepEqual(declaredAgents, ACD_AGENT_IDS, "declared agent ids equal the 8 ACD actors");
    }
  },
  {
    name: "arch/ADR-001/002: declared-member set equals the set of member files in the bundle root (no undeclared file, no missing member)",
    run: async () => {
      const root = bundleRoot();
      const members = readDescriptor().members;

      // Every declared member's file (resource) or directory contents (template)
      // must exist on disk.
      const declaredFiles = new Set();
      for (const member of members) {
        if (member.file) {
          declaredFiles.add(member.file.replaceAll("\\", "/"));
        } else if (member.dir) {
          const dirAbs = path.join(root, member.dir);
          for (const name of readdirSync(dirAbs)) {
            declaredFiles.add(`${member.dir.replaceAll("\\", "/")}/${name}`);
          }
        } else {
          throw new Error(`declared member ${member.id} names neither a file nor a dir`);
        }
      }

      // Every file on disk (minus machinery) must be a declared member file.
      const onDisk = bundleFiles(root).filter((rel) => !NON_MEMBER_FILES.has(rel));

      const declaredSorted = [...declaredFiles].sort();
      const onDiskSorted = [...onDisk].sort();
      assert.deepEqual(onDiskSorted, declaredSorted, "bundle root files == declared member files");
    }
  },
  {
    name: "arch/ADR-001: every declared member resolves to an existing path on disk",
    run: async () => {
      const root = bundleRoot();
      for (const member of readDescriptor().members) {
        const target = member.file ?? member.dir;
        assert.doesNotThrow(() => statSync(path.join(root, target)), `member ${member.id} exists at ${target}`);
      }
    }
  }
];
