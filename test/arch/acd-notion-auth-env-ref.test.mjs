// Fitness function for milestone 17 / ADR-004 (inv. 4):
//   "Auth-env-ref / no-committed-secret. The config carries `tokenEnv` (an env-var
//    NAME), never a token; the sync reads the secret from the named env var at run
//    time."
//
// Two legs, CI-able offline:
//   (a) SCHEMA: `work.integrations.notion` accepts `tokenEnv` (a string property) and
//       has NO `token`/secret property, and is CLOSED (additionalProperties:false) so a
//       `token` field is rejected. Proven against the JSON schema directly.
//   (b) SOURCE-GREP src/notion/cli.mjs (the auth read): the sync reads the secret from
//       the NAMED env var (`env[<tokenEnv>]`), and no Notion token LITERAL nor a
//       `token:` CONFIG read appears (the config holds `tokenEnv`, never `token`).
//       Self-checked non-vacuous: the secret-config-read matcher fires on a planted
//       `config.token` form.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA = path.join(repoRoot, "schemas", "aof.schema.json");
const CLI = path.join(repoRoot, "src", "notion", "cli.mjs");

function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

// A `token:`-keyed CONFIG read — `config.token` / `notionConfig.token` / `cfg.token`
// (the forbidden committed-secret read; the config holds `tokenEnv`, never `token`).
// `config.tokenEnv` (the env-var NAME read) is explicitly NOT this form.
const SECRET_CONFIG_READ = /\bconfig\.token\b(?!Env)|\b\w*[Cc]onfig\.token\b(?!Env)/;

// The accepted auth read: the secret is read from the env BY its named var —
// `env[tokenEnv]` / `env?.[tokenEnv]` (a computed index by the config-supplied NAME).
const ENV_VAR_NAME_READ = /\benv\??\.?\[\s*tokenEnv\s*\]/;

export const archTests = [
  {
    name: "arch/notion-auth-env-ref: the schema accepts `tokenEnv` (a string) and has NO `token`/secret field; the block is closed so a `token` field is rejected",
    async run() {
      const schema = JSON.parse(await readFile(SCHEMA, "utf8"));
      const notion = schema?.$defs?.work?.properties?.integrations?.properties?.notion;
      assert.ok(notion && typeof notion === "object", "the schema defines work.integrations.notion");

      const props = notion.properties ?? {};
      assert.ok(props.tokenEnv && props.tokenEnv.type === "string", "the block accepts `tokenEnv` (a string env-var NAME)");
      assert.ok(!("token" in props), "the block has NO `token` field (the secret is never in config)");

      // No property name smells of a committed secret (token/secret/apiKey/password).
      for (const name of Object.keys(props)) {
        assert.ok(
          name === "tokenEnv" || !/(^|[^a-z])(token|secret|apikey|password|credential)/i.test(name),
          `no config property holds a secret value (offending property "${name}")`
        );
      }

      // CLOSED: additionalProperties:false ⇒ a `token` field would be REJECTED, not
      // silently accepted.
      assert.equal(notion.additionalProperties, false, "the notion block is closed (a `token` field is rejected)");
    },
  },
  {
    name: "arch/notion-auth-env-ref: the auth read reads the secret from the NAMED env var (env[tokenEnv]); no `token:` config read appears",
    async run() {
      const code = stripCommentsAndStrings(await readFile(CLI, "utf8"));

      // The sync reads the secret from the env BY the config-supplied var NAME.
      assert.ok(
        ENV_VAR_NAME_READ.test(code),
        `${path.relative(repoRoot, CLI)} reads the secret from the named env var (env[tokenEnv])`
      );

      // No `token:`-keyed CONFIG read (the committed-secret form). `config.tokenEnv`
      // (the var NAME) is allowed and is NOT this form.
      assert.ok(
        !SECRET_CONFIG_READ.test(code),
        `${path.relative(repoRoot, CLI)} reads no token from config (the config holds only tokenEnv, the env-var NAME)`
      );

      // Self-check (non-vacuous): the secret-config-read matcher FIRES on a planted
      // `config.token` form and does NOT fire on the accepted `config.tokenEnv` form.
      assert.ok(SECRET_CONFIG_READ.test("const t = config.token;"), "the secret-config-read guard fires on a planted config.token read");
      assert.ok(SECRET_CONFIG_READ.test("const t = notionConfig.token;"), "the secret-config-read guard fires on a planted notionConfig.token read");
      assert.ok(!SECRET_CONFIG_READ.test("const e = config.tokenEnv;"), "the secret-config-read guard does NOT fire on config.tokenEnv (the env-var NAME)");
      assert.ok(ENV_VAR_NAME_READ.test("const raw = env?.[tokenEnv];"), "the env-var-name-read matcher fires on the accepted env[tokenEnv] form");
    },
  },
];
