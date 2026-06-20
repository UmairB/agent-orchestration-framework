// Fitness function for milestone 06 / ADR-002:
// "Proxy mode is designed-not-shipped in v0: NO source path spawns a long-lived
//  `headroom proxy` child or injects ANTHROPIC_BASE_URL / OPENAI_BASE_URL, and the
//  CliProvider.buildEnv `_opts` param stays reserved/unused."
//
// State now: GREEN — no proxy code exists yet — and it must STAY green through v0.
// This is a REGRESSION GUARD, not a RED-until-built test: it fails the day the
// wrap-routing story (or any change) smuggles proxy-mode runtime in before the
// proxy milestone widens the `mode` enum (ADR-002). It is the structural backstop
// for "v0 ships wrap only".
//
// Source grep over src/*.mjs with comments stripped (so ADR citations of the proxy
// terms in prose/comments don't false-trip), mirroring the stripComments idiom.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

async function listMjs(dir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".mjs")) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

export const archTests = [
  {
    name: "arch/ADR-002: no v0 source spawns a `headroom proxy` child or injects ANTHROPIC_BASE_URL / OPENAI_BASE_URL",
    run: async () => {
      const files = await listMjs(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        if (/headroom\s+proxy/.test(code)) offenders.push(`${path.relative(SRC_DIR, file)}: spawns \`headroom proxy\``);
        if (/ANTHROPIC_BASE_URL/.test(code)) offenders.push(`${path.relative(SRC_DIR, file)}: injects ANTHROPIC_BASE_URL`);
        if (/OPENAI_BASE_URL/.test(code)) offenders.push(`${path.relative(SRC_DIR, file)}: injects OPENAI_BASE_URL`);
      }
      assert.deepEqual(offenders, [], `proxy mode is designed-not-shipped in v0; no proxy runtime in src:\n${offenders.join("\n")}`);
    }
  }
];
