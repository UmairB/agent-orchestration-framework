// Fitness function: acd-worker-clone-no-credential-persisted (milestone 38 / ADR-005 +
// SECURITY T1/T2/T3) — "the worker's clone-on-miss path NEVER persists a credential into
// the checkout's .git/config, NEVER writes a credential value to a log, AND NEVER places a
// credential on the worker's AMBIENT process env (where the later spawned agent child would
// inherit it)."
//
// The auth-transmission MECHANISM is deferred to RESEARCH/SECURITY (ADR-005; RESEARCH.md §1
// measures GIT_ASKPASS + a control-minted short-lived token as the recommended default), but
// FOUR structural invariants hold regardless of mechanism and are pinned now:
//  (a) no credential is baked into the clone's .git/config — no `url.<cred>@...` rewrite, no
//      durable `credential.helper store` pointing at a file — so the checkout carries no
//      secret at rest (SECURITY T1 · credential at rest);
//  (b) the clone MUST NOT use the `git clone --config http.extraHeader=<cred>` form — the
//      MEASURED footgun (RESEARCH.md §1.1/A1): `--config` at clone time persists the raw
//      header verbatim into the checkout's .git/config in plaintext, permanently. The
//      one-shot, non-persisting form is top-level `git -c http.extraHeader=…` or GIT_ASKPASS
//      (SECURITY T1 · credential at rest);
//  (c) a credential value is NEVER assigned onto the worker's AMBIENT `process.env` — the
//      MEASURED leak vector (RESEARCH.md §1.5): Node `execFile` with no `env` key inherits
//      the FULL parent environment into the spawned agent child (`defaultSpawnRuntime`,
//      mesh-worker-execution.mjs), so any credential on ambient `process.env` for the clone
//      step leaks into the headless `claude -p`/`codex exec` child. The clone's credential
//      env MUST be a distinct `env` object passed to ONLY the clone's exec call, never merged
//      into `process.env` (SECURITY T2 · credential leaking to the spawned agent child);
//  (d) no credential value reaches a log/error line (the acd-global-node-descriptors-redact-
//      secrets discipline — SECURITY T3 · credential in logs). The git spawn stays argv-form,
//      shell-less.
//
// STATE OF BUILD: the clone path is built by the worker-repo-checkout story; today
// mesh-worker-execution.mjs refuses on `!hasRepo` (no clone, no credential handling). The
// invariant is TRUE today (no credential code exists) and MUST stay true once the clone
// lands. The detector trips the moment the clone path writes a credential to .git/config,
// uses `clone --config http.extraHeader`, sets a credential on `process.env`, or logs one.
//
// Proofs:
//  1. Structural — the worker-execution module configures NO durable git credential
//     persistence: no `credential.helper` set to `store`, no `url.*.insteadOf` rewrite
//     that embeds a token, no `git config`/`clone --config` write of a credential into the
//     checkout, and no `http.extraheader`/`Authorization` header persisted.
//  2. Structural — no credential-bearing value is ASSIGNED onto `process.env` (the ambient
//     env the later agent-child spawn inherits) — the clone's credential env must be scoped
//     to the clone's own exec call, never merged into the process env.
//  3. Structural — no obvious credential value is passed to a console/log call
//     (a token/password identifier flowing into a log line).
//  Self-check (m03 non-vacuous): a planted `credential.helper store`, a token-in-url
//  `.git/config` rewrite, a `clone --config http.extraHeader`, a credential assigned to
//  `process.env`, and a logged token, ALL trip the detector.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function assertStructural(code) {
  const problems = [];
  // A durable credential.helper (store/cache-to-file) baked in — persists the secret.
  if (/credential\.helper[^"'\n]*\bstore\b/.test(code) || /["']credential\.helper["']\s*,\s*["']store["']/.test(code)) {
    problems.push("a durable `credential.helper store` is configured — a credential must never be persisted");
  }
  // A token-in-URL rewrite into git config (insteadOf embedding a credential).
  if (/insteadOf/.test(code) && /(token|password|secret|@)/i.test(code)) {
    problems.push("a url.insteadOf rewrite that could embed a credential is present");
  }
  // A `git config` write that plants a credential into .git/config — an extraheader
  // carrying Authorization, or a user.password, appearing anywhere in the module. The
  // MEASURED footgun (RESEARCH.md §1.1): `git clone --config http.extraHeader=<cred>`
  // persists the raw header verbatim to the checkout's .git/config in plaintext — so an
  // `http.extraheader` literal, an `Authorization` header, or a `user.password` write is
  // forbidden anywhere in the module.
  if (/\bextraheader\b/i.test(code) || /\bAuthorization\b/.test(code) || /\buser\.password\b/i.test(code)) {
    problems.push("a git config / clone --config embeds an Authorization/http.extraHeader credential into .git/config (RESEARCH §1.1 footgun: use top-level `git -c` or GIT_ASKPASS, never `clone --config`)");
  }
  // The clone-time `--config` flag itself, paired with any http.* key: `git clone --config
  // http.<x>=…` is the persisting form the measured footgun documents (it writes into the
  // NEW repo's config). The one-shot form is top-level `git -c …` / GIT_ASKPASS.
  if (/["']--config["']/.test(code) && /http\./i.test(code)) {
    problems.push("`git clone --config http.*` persists the value into the new checkout's .git/config (the measured footgun) — use a per-invocation top-level `-c` or GIT_ASKPASS instead");
  }
  // A credential value ASSIGNED onto the worker's AMBIENT process env — the MEASURED leak
  // vector (RESEARCH.md §1.5): execFile with no `env` key inherits the full parent env into
  // the spawned agent child, so a credential on process.env for the clone step leaks into
  // the headless agent (`defaultSpawnRuntime`). The clone's credential env MUST be a scoped
  // `env` object passed to the clone's own exec call, never merged into process.env. Any
  // `process.env.<X> = …` / `Object.assign(process.env, …)` in this module carrying a
  // credential-shaped name is the failure. (Reading process.env is fine — WRITING a
  // credential to it is not.)
  if (/process\.env\.[A-Za-z_$][\w$]*\s*=(?!=)/.test(code)) {
    problems.push("a value is assigned onto the ambient `process.env` — a clone credential must live in a scoped `env` passed to the clone exec only, never on process.env (RESEARCH §1.5: the spawned agent child inherits process.env)");
  }
  if (/Object\.assign\s*\(\s*process\.env\b/.test(code)) {
    problems.push("Object.assign onto the ambient `process.env` — a clone credential must never be merged into process.env (the spawned agent child inherits it, RESEARCH §1.5)");
  }
  // A credential value flowing into a console/log/error call.
  if (/(console\.(log|error|warn)|logger\.[a-z]+)\s*\([^)]*\b(token|password|secret|credential)\b/i.test(code)) {
    problems.push("a credential value appears to flow into a log/console line");
  }
  return problems;
}

// assertHelperResetControl(code) — SECURITY T7 / finding F14 (High), landed as a
// POSITIVE invariant once the fix shipped (SECURITY.md promised this strengthening "when
// the fix lands"). GIT_ASKPASS is NOT authoritative while a `credential.helper` is
// configured: MEASURED (stock Git-for-Windows: system `manager` + global `wincred`), the
// helper WINS and askpass is never invoked — so the relay-minted short-lived scoped token
// is silently BYPASSED in favour of the operator's broad keychain PAT (T4 evaporates, the
// clone still succeeds), and on success git's `approve`→`store` PERSISTS a used token into
// the OS keychain (T1/R2, the durable store this milestone refused). The measured control
// is: the scoped clone (a) RESETS the ambient helper chain (`-c credential.helper=`, an
// empty value clears the list — MEASURED to make GIT_ASKPASS authoritative AND to suppress
// the store-on-success) and (b) DISABLES the interactive fallback (`GIT_TERMINAL_PROMPT=0`,
// so a missing/rejected credential fails LOUDLY, never hangs on a prompt or is silently
// rescued by an ambient helper) — on BOTH the credentialled and the public/no-credential
// paths. Their ABSENCE is the regression this pins.
function assertHelperResetControl(code) {
  const problems = [];
  if (!/credential\.helper=/.test(code)) {
    problems.push("the clone path does not reset the ambient credential.helper chain (`-c credential.helper=`) — GIT_ASKPASS is not authoritative while a helper is configured, so the relay token is silently bypassed/persisted (SECURITY T7/F14)");
  }
  if (!/GIT_TERMINAL_PROMPT/.test(code)) {
    problems.push("the clone path does not disable the interactive credential prompt (GIT_TERMINAL_PROMPT) — a missing/rejected credential must fail loudly, never hang or fall back to the ambient keychain (SECURITY T7/F14)");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/38 ADR-005 (acd-worker-clone-no-credential-persisted): the worker-execution clone path persists no credential into .git/config and logs no credential value (structural)",
    run: async () => {
      const code = stripComments(await readFile(workerSourcePath, "utf8"));
      const problems = assertStructural(code);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/38 ADR-005 (acd-worker-clone-no-credential-persisted): self-check — a planted credential.helper store, a token-in-url rewrite, a `clone --config http.extraHeader`, a credential on process.env, and a logged token all trip the detector",
    run: async () => {
      const code = stripComments(await readFile(workerSourcePath, "utf8"));
      assert.deepEqual(assertStructural(code), [], "the real source is clean");

      const plantedHelper = `${code}\nasync function plantedA(exec) { return exec(["config", "credential.helper", "store"]); }\n`;
      assert.ok(assertStructural(plantedHelper).length > 0, "a planted credential.helper store trips the detector");

      const plantedInsteadOf = `${code}\nasync function plantedB(exec, token) { return exec(["config", "url.https://" + token + "@host/.insteadOf", "https://host/"]); }\n`;
      assert.ok(assertStructural(plantedInsteadOf).length > 0, "a planted token-in-url insteadOf rewrite trips the detector");

      const plantedLog = `${code}\nfunction plantedC(token) { console.log("cloning with token " + token); }\n`;
      assert.ok(assertStructural(plantedLog).length > 0, "a planted logged token trips the detector");

      const plantedExtraHeader = `${code}\nasync function plantedD(exec, auth) { return exec(["config", "http.extraheader", "Authorization: " + auth]); }\n`;
      assert.ok(assertStructural(plantedExtraHeader).length > 0, "a planted Authorization extraheader trips the detector");

      // The MEASURED clone-time footgun (RESEARCH §1.1): `git clone --config http.extraHeader=<cred>`
      // persists the raw header into the new checkout's .git/config permanently.
      const plantedCloneConfig = `${code}\nasync function plantedE(exec, url, dest, token) { return exec(["clone", "--config", "http.extraHeader=Authorization: Bearer " + token, url, dest]); }\n`;
      assert.ok(assertStructural(plantedCloneConfig).length > 0, "a planted `git clone --config http.extraHeader` trips the detector");

      // The MEASURED env-inheritance leak (RESEARCH §1.5): a credential placed on the ambient
      // process.env leaks into the spawned agent child (execFile inherits parent env).
      const plantedAmbientEnv = `${code}\nfunction plantedF(token) { process.env.MESH_CLONE_TOKEN = token; }\n`;
      assert.ok(assertStructural(plantedAmbientEnv).length > 0, "a planted credential assigned to process.env trips the detector");

      const plantedAssignEnv = `${code}\nfunction plantedG(cred) { Object.assign(process.env, { GIT_ASKPASS_TOKEN: cred }); }\n`;
      assert.ok(assertStructural(plantedAssignEnv).length > 0, "a planted Object.assign onto process.env trips the detector");

      // Negative control: the CORRECT discipline — a scoped `env` passed to ONLY the clone's
      // exec call (never touching process.env) — stays clean.
      const scopedEnvClone = `${code}\nasync function plantedOk(exec, url, dest, askpass) { return exec(["clone", url, dest], { env: { ...process.env, GIT_ASKPASS: askpass } }); }\n`;
      assert.deepEqual(assertStructural(scopedEnvClone), [], "a scoped env on the clone exec (never on process.env) is clean");
    },
  },
  {
    name: "arch/38 ADR-009 (acd-worker-clone-no-credential-persisted): SECURITY T7/F14 — the scoped clone RESETS the ambient credential.helper chain (`-c credential.helper=`) and DISABLES the interactive prompt (GIT_TERMINAL_PROMPT), so GIT_ASKPASS is authoritative and no token is persisted to the keychain (structural)",
    run: async () => {
      const code = stripComments(await readFile(workerSourcePath, "utf8"));
      const problems = assertHelperResetControl(code);
      assert.deepEqual(problems, [], `helper-reset control problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/38 ADR-009 (acd-worker-clone-no-credential-persisted): self-check — a clone that OMITS the `credential.helper=` reset, and one that OMITS GIT_TERMINAL_PROMPT, each trip the F14 detector; the correct reset+prompt shape stays clean",
    run: async () => {
      // Every snippet is synthesized with explicit "\n" joins (CRLF-immune) — never a
      // string-replace on the real source (the milestone's hard lesson: a plant that
      // silently no-ops leaves the self-check vacuous).
      const correct = [
        'const cloneEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };',
        'await exec(["-c", "credential.helper=", "clone", url, dest], { env: cloneEnv });',
      ].join("\n");
      assert.deepEqual(assertHelperResetControl(correct), [], "the correct reset+prompt clone shape is clean");

      const noReset = [
        'const cloneEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };',
        'await exec(["clone", url, dest], { env: cloneEnv });',
      ].join("\n");
      assert.notEqual(noReset, correct, "the no-reset plant differs from the clean shape");
      assert.ok(assertHelperResetControl(noReset).some((p) => /credential\.helper=/.test(p)), "a clone missing the credential.helper reset trips the detector");

      const noPrompt = [
        'const cloneEnv = { ...process.env };',
        'await exec(["-c", "credential.helper=", "clone", url, dest], { env: cloneEnv });',
      ].join("\n");
      assert.notEqual(noPrompt, correct, "the no-prompt plant differs from the clean shape");
      assert.ok(assertHelperResetControl(noPrompt).some((p) => /GIT_TERMINAL_PROMPT/.test(p)), "a clone missing GIT_TERMINAL_PROMPT trips the detector");
    },
  },
];
