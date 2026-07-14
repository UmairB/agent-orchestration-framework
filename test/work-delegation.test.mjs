// `aof work delegation` — the gpt-5.6 delegation on/off toggle.
//
// Two surfaces asserted against the REAL modules:
//   (a) the config-only read-merge-write of work.agents.delegation
//       (src/work-delegation.mjs), incl. default-off, sibling preservation, and
//       the validator (src/config-inspect.mjs);
//   (b) the deterministic render floor — the bundled codex-* skills always render
//       with `disable-model-invocation: true` (src/work-bundle.mjs + adapters).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DELEGATION_STATES,
  DEFAULT_DELEGATION,
  DEFAULT_DELEGATION_MODEL,
  readDelegation,
  readDelegationModel,
  resolveDelegation,
  setDelegation,
  setDelegationModel,
  setDelegationCommand,
  setDelegationModelCommand,
  showDelegation,
  applyDelegationToResources,
  applyDelegationModelToResources
} from "../src/work-delegation.mjs";
import { loadBundle, renderBundleOutputs } from "../src/work-bundle.mjs";
import { validateConfig } from "../src/config-inspect.mjs";

const silent = () => {};

async function fixture(config) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-delegation-"));
  await mkdir(path.join(dir, ".aof"), { recursive: true });
  await writeFile(path.join(dir, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return dir;
}

async function readConfigFile(dir) {
  return JSON.parse(await readFile(path.join(dir, ".aof", "aof.config.json"), "utf8"));
}

async function diagnosticsForConfig(config) {
  const dir = await fixture(config);
  try {
    return await validateConfig(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const workDelegationTests = [
  {
    name: "work-delegation: states are off/on and the default is off",
    run: async () => {
      assert.deepEqual(DELEGATION_STATES, ["off", "on"]);
      assert.equal(DEFAULT_DELEGATION, "off");
      assert.equal(readDelegation({}), "off", "absent ≡ off");
      assert.equal(readDelegation({ work: { agents: { delegation: "on" } } }), "on");
      assert.equal(readDelegation({ work: { agents: { delegation: "bogus" } } }), "off", "unknown ≡ off");
    }
  },

  {
    name: "work-delegation: resolveDelegation accepts on/off + common synonyms, rejects the rest",
    run: async () => {
      for (const on of ["on", "ON", "enable", "true", "yes"]) assert.equal(resolveDelegation(on), "on", on);
      for (const off of ["off", "Off", "disable", "false", "no"]) assert.equal(resolveDelegation(off), "off", off);
      assert.equal(resolveDelegation("maybe"), null);
      assert.equal(resolveDelegation(1), null);
    }
  },

  {
    name: "work-delegation: setDelegation writes ONLY work.agents.delegation, preserving siblings",
    run: async () => {
      const config = { name: "x", work: { agents: { models: { "aof-qa": "opus" }, mode: "orchestrated" }, headroom: { enabled: true } } };
      setDelegation(config, "on");
      assert.equal(config.work.agents.delegation, "on");
      assert.deepEqual(config.work.agents.models, { "aof-qa": "opus" }, "models sibling preserved");
      assert.equal(config.work.agents.mode, "orchestrated", "mode sibling preserved");
      assert.deepEqual(config.work.headroom, { enabled: true }, "work.headroom preserved");
    }
  },

  {
    name: "work-delegation: the command flips on then off and reports the change (fresh project defaults off)",
    run: async () => {
      const dir = await fixture({ name: "x" });
      try {
        const on = await setDelegationCommand({ targetDir: dir, state: "on", log: silent });
        assert.equal(on.state, "on");
        assert.equal(on.previous, "off", "a fresh project starts off");
        assert.equal(on.changed, true);
        assert.equal((await readConfigFile(dir)).work.agents.delegation, "on");

        const off = await setDelegationCommand({ targetDir: dir, state: "off", log: silent });
        assert.equal(off.state, "off");
        assert.equal(off.previous, "on");
        assert.equal((await readConfigFile(dir)).work.agents.delegation, "off");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-delegation: an invalid state is rejected without writing the config",
    run: async () => {
      const dir = await fixture({ name: "x", work: { agents: { delegation: "on" } } });
      try {
        await assert.rejects(
          () => setDelegationCommand({ targetDir: dir, state: "sometimes", log: silent }),
          /not a valid delegation state/
        );
        assert.equal((await readConfigFile(dir)).work.agents.delegation, "on", "config untouched on rejection");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-delegation: --show reports state and mutates nothing",
    run: async () => {
      const dir = await fixture({ name: "x", work: { agents: { delegation: "on" } } });
      try {
        const before = await readFile(path.join(dir, ".aof", "aof.config.json"), "utf8");
        const result = await showDelegation({ targetDir: dir, log: silent });
        assert.equal(result.state, "on");
        assert.equal(await readFile(path.join(dir, ".aof", "aof.config.json"), "utf8"), before, "show does not rewrite");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-delegation: the validator accepts off/on and rejects anything else",
    run: async () => {
      for (const state of ["off", "on"]) {
        const diags = await diagnosticsForConfig({ work: { agents: { delegation: state } } });
        assert.equal(diags.some((d) => d.severity === "error" && String(d.path).startsWith("work.agents.delegation")), false, `"${state}" is valid`);
      }
      const bad = await diagnosticsForConfig({ work: { agents: { delegation: "maybe" } } });
      assert.ok(
        bad.some((d) => d.severity === "error" && d.code === "delegation-bad-value"),
        "an invalid delegation value is an error"
      );
    }
  },

  {
    name: "work-delegation: by default (off) the codex-* skills render disable-model-invocation:true",
    run: async () => {
      const outputs = renderBundleOutputs(loadBundle(), { runtimes: ["claude"] });
      const skills = outputs.filter((o) => o.resource?.kind === "skill");
      assert.equal(skills.length, 3, "three codex skills render");
      for (const skill of skills) {
        const block = skill.content.slice(0, skill.content.indexOf("\n---", 3));
        assert.match(block, /^disable-model-invocation: true$/m, `${skill.resource.id} renders disable-model-invocation:true by default`);
      }
    }
  },

  {
    name: "work-delegation: applyDelegationToResources('on') drops disable-model-invocation from the codex skills; 'off' keeps it",
    run: async () => {
      const bundle = loadBundle();
      // OFF (or any non-'on') is a no-op — the bundle already encodes the flag.
      const off = applyDelegationToResources(bundle.resources, "off");
      for (const r of off.filter((r) => r.kind === "skill")) {
        assert.equal(r.disableModelInvocation, true, `${r.id} keeps the flag when off`);
      }
      // ON drops it so the rendered skill is auto-invocable.
      const on = applyDelegationToResources(bundle.resources, "on");
      for (const r of on.filter((r) => r.kind === "skill")) {
        assert.ok(!("disableModelInvocation" in r), `${r.id} drops the flag when on`);
      }
      // Non-skill members are untouched under both.
      const agentBefore = bundle.resources.find((r) => r.kind === "agent");
      const agentAfter = on.find((r) => r.id === agentBefore.id);
      assert.deepEqual(agentAfter, agentBefore, "agents are untouched by the delegation projection");
    }
  },

  {
    name: "work-delegation: readDelegationModel defaults to gpt-5.6-sol and honours an explicit id",
    run: async () => {
      assert.equal(DEFAULT_DELEGATION_MODEL, "gpt-5.6-sol");
      assert.equal(readDelegationModel({}), "gpt-5.6-sol", "absent ≡ default");
      assert.equal(readDelegationModel({ work: { agents: { delegationModel: "" } } }), "gpt-5.6-sol", "blank ≡ default");
      assert.equal(readDelegationModel({ work: { agents: { delegationModel: "  " } } }), "gpt-5.6-sol", "whitespace ≡ default");
      assert.equal(readDelegationModel({ work: { agents: { delegationModel: 42 } } }), "gpt-5.6-sol", "non-string ≡ default");
      assert.equal(readDelegationModel({ work: { agents: { delegationModel: "gpt-5.7-codex-max" } } }), "gpt-5.7-codex-max");
      assert.equal(readDelegationModel({ work: { agents: { delegationModel: "  trim-me  " } } }), "trim-me", "trimmed");
    }
  },

  {
    name: "work-delegation: setDelegationModel writes ONLY work.agents.delegationModel, preserving siblings",
    run: async () => {
      const config = { name: "x", work: { agents: { delegation: "on", models: { "aof-qa": "opus" }, mode: "orchestrated" } } };
      setDelegationModel(config, "gpt-5.7-codex-max");
      assert.equal(config.work.agents.delegationModel, "gpt-5.7-codex-max");
      assert.equal(config.work.agents.delegation, "on", "delegation toggle sibling preserved");
      assert.deepEqual(config.work.agents.models, { "aof-qa": "opus" }, "models sibling preserved");
      assert.equal(config.work.agents.mode, "orchestrated", "mode sibling preserved");
    }
  },

  {
    name: "work-delegation: the model command sets the id and reports the change; blank is rejected without writing",
    run: async () => {
      const dir = await fixture({ name: "x", work: { agents: { delegation: "on" } } });
      try {
        const set = await setDelegationModelCommand({ targetDir: dir, model: "gpt-5.7-codex-max", log: silent });
        assert.equal(set.model, "gpt-5.7-codex-max");
        assert.equal(set.previous, "gpt-5.6-sol", "previous falls back to the default");
        assert.equal(set.changed, true);
        const written = await readConfigFile(dir);
        assert.equal(written.work.agents.delegationModel, "gpt-5.7-codex-max");
        assert.equal(written.work.agents.delegation, "on", "toggle sibling survives the model write");

        await assert.rejects(
          () => setDelegationModelCommand({ targetDir: dir, model: "   ", log: silent }),
          /not a valid delegation model/
        );
        assert.equal((await readConfigFile(dir)).work.agents.delegationModel, "gpt-5.7-codex-max", "config untouched on rejection");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-delegation: --show reports the model (default-annotated) alongside the state",
    run: async () => {
      const dir = await fixture({ name: "x", work: { agents: { delegation: "on", delegationModel: "gpt-5.7-codex-max" } } });
      try {
        const result = await showDelegation({ targetDir: dir, log: silent });
        assert.equal(result.state, "on");
        assert.equal(result.model, "gpt-5.7-codex-max");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },

  {
    name: "work-delegation: the 3 codex skills + 2 ACD agents ship the default model literal",
    run: async () => {
      const bundle = loadBundle();
      const carriers = bundle.resources.filter((r) => typeof r.body === "string" && r.body.includes(DEFAULT_DELEGATION_MODEL));
      const ids = carriers.map((r) => r.id).sort();
      assert.deepEqual(
        ids,
        ["aof-developer", "aof-researcher", "codex-computer-use", "codex-implementation", "codex-review"],
        "exactly the 5 delegation carriers ship the default literal (keeps the substitution + default in sync)"
      );
    }
  },

  {
    name: "work-delegation: applyDelegationModelToResources swaps a non-default model into every carrier; default is a no-op",
    run: async () => {
      const bundle = loadBundle();
      const carriers = bundle.resources.filter((r) => typeof r.body === "string" && r.body.includes(DEFAULT_DELEGATION_MODEL));

      // A DIFFERENT model rewrites every carrier and leaves no default literal behind.
      const baked = applyDelegationModelToResources(bundle.resources, "gpt-5.7-codex-max");
      for (const carrier of carriers) {
        const after = baked.find((r) => r.id === carrier.id);
        assert.ok(!after.body.includes(DEFAULT_DELEGATION_MODEL), `${carrier.id} has no leftover default literal`);
        assert.ok(after.body.includes("gpt-5.7-codex-max"), `${carrier.id} carries the resolved id`);
      }
      // Non-carrier resources are returned by reference (no rewrite).
      const untouched = bundle.resources.filter((r) => typeof r.body !== "string" || !r.body.includes(DEFAULT_DELEGATION_MODEL));
      for (const r of untouched) {
        assert.equal(baked.find((b) => b.id === r.id), r, `${r.id} is returned by reference`);
      }
      // The DEFAULT (and blank/absent, which resolves to default) is a pure no-op:
      // the SAME array reference comes back, so the canonical render is untouched.
      assert.equal(applyDelegationModelToResources(bundle.resources, DEFAULT_DELEGATION_MODEL), bundle.resources, "default ⇒ identity");
      assert.equal(applyDelegationModelToResources(bundle.resources, ""), bundle.resources, "blank ⇒ default ⇒ identity");
    }
  },

  {
    name: "work-delegation: the validator accepts a non-empty model and rejects a blank/non-string one",
    run: async () => {
      const good = await diagnosticsForConfig({ work: { agents: { delegationModel: "gpt-5.7-codex-max" } } });
      assert.equal(good.some((d) => d.severity === "error" && String(d.path).startsWith("work.agents.delegationModel")), false, "a real id is valid");
      for (const bad of ["", "   ", 42]) {
        const diags = await diagnosticsForConfig({ work: { agents: { delegationModel: bad } } });
        assert.ok(
          diags.some((d) => d.severity === "error" && d.code === "delegation-model-bad-value"),
          `${JSON.stringify(bad)} is rejected`
        );
      }
    }
  },

  {
    name: "work-delegation: the canonical (config-agnostic) render carries the default model as a real -m target",
    run: async () => {
      const outputs = renderBundleOutputs(loadBundle(), { runtimes: ["claude"] });
      const skills = outputs.filter((o) => o.resource?.kind === "skill");
      assert.equal(skills.length, 3, "three codex skills render");
      for (const skill of skills) {
        assert.match(skill.content, /-m gpt-5\.6-sol/, `${skill.resource.id} renders a real -m default target (no placeholder)`);
      }
    }
  }
];
