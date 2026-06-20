// `/api/work*` — the work board's read-mostly HTTP API (milestone 03, story 01).
//
// This module owns the board's HTTP namespace (ADR-001): list / doc / validate /
// next / feedback, all under the frozen `/api/work` prefix. It is wired into the
// single `http.createServer` in `setup-ui.mjs` via one additive line; the
// terminal WebSocket (`/ws/terminal`, story 02) is a disjoint namespace on the
// same server.
//
// The board is READ-MOSTLY (ADR-004): list/doc reads, validate/next are
// in-process calls to `work.mjs` exports (never a CLI shell-out), and the SOLE
// filesystem mutation is the feedback append — one attributed bullet under the
// verbatim `## Feedback (for retro)` heading in a selected milestone/story's
// `STATE.md`. There is no status/frontmatter write and no restatus route.
import path from "node:path";
import { readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { loadWorkspace, listStream, findWork, validateWork, nextWork } from "./work.mjs";
import { parseFeature } from "./feature-parse.mjs";

// The verbatim feedback heading — must match templates/uat/STATE.md and
// src/bundle/commands/feedback.md byte-for-byte (ADR-004 / 02_add-feedback.feature).
const FEEDBACK_HEADING = "## Feedback (for retro)";
// The docs the detail panel may request, mapped to their on-disk filename.
const DOC_FILES = {
  SPEC: "SPEC.md",
  STORY: "STORY.md",
  VERIFICATION: "VERIFICATION.md",
  RETROSPECTIVE: "RETROSPECTIVE.md",
};

// Returns true if the request was an `/api/work*` route (handled here), else
// false so the caller falls through to its own routing/404.
export async function handleWorkApi(request, response, options = {}) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return false;
  }

  const pathname = requestUrl.pathname;
  if (!pathname.startsWith("/api/work")) return false;

  try {
    // Inside the try so a loadWorkspace throw lands in the catch below (mapping
    // error.status ?? 500 to a JSON error response) rather than escaping the
    // handler — the caller awaits this bare in the http.createServer callback.
    const workspace = await loadWorkspace(path.resolve(options.projectDir ?? process.cwd()));

    if (request.method === "GET" && pathname === "/api/work/list") {
      sendJson(response, 200, await listStream(workspace.workDir));
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/doc") {
      await handleDoc(response, workspace, requestUrl.searchParams);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/tasks") {
      await handleTasks(response, workspace, requestUrl.searchParams);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/validate") {
      await handleValidate(response, workspace, requestUrl.searchParams);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/next") {
      await handleNext(response, workspace, requestUrl.searchParams);
      return true;
    }

    if (request.method === "POST" && pathname === "/api/work/feedback") {
      await handleFeedback(request, response, workspace);
      return true;
    }
  } catch (error) {
    sendApiError(response, error.status ?? 500, error.message, error.code ?? "work-api-failed");
    return true;
  }

  // An unknown `/api/work*` route: own the response with a 404 so the caller's
  // generic guard does not also try to respond.
  sendApiError(response, 404, "Work API route not found.", "not-found");
  return true;
}

async function handleDoc(response, workspace, params) {
  const ref = (params.get("ref") ?? "").trim();
  const docName = (params.get("doc") ?? "").trim().toUpperCase();
  const fileName = DOC_FILES[docName];
  if (!fileName) {
    sendApiError(response, 400, `Unknown document "${params.get("doc") ?? ""}".`, "invalid-doc");
    return;
  }

  const item = await resolveItem(workspace.workDir, ref);
  if (!item) {
    sendApiError(response, 404, `No item resolves to ref "${ref}".`, "ref-not-found");
    return;
  }

  // path.join on the native dir (findWork returns the OS-native path); a missing
  // file is NOT an error — ENOENT → { present: false, body: "" } (ADR-004).
  try {
    const body = await readFile(path.join(item.dir, fileName), "utf8");
    sendJson(response, 200, { ref: item.ref, doc: docName, present: true, body });
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 200, { ref: item.ref, doc: docName, present: false, body: "" });
      return;
    }
    throw error;
  }
}

// READ-ONLY (ADR-004): a story's tasks are the `<dir>/tasks/*.feature` files.
// The browser can't read disk, so we parse them server-side and return the
// scenarios + per-task lane counts. This route NEVER writes (the sole writer is
// appendFeedbackBullet) and NEVER shells out. A missing `tasks/` dir is
// absent-not-error → { ref, tasks: [] }, like /api/work/doc's ENOENT path.
async function handleTasks(response, workspace, params) {
  const ref = (params.get("ref") ?? "").trim();
  const item = await resolveItem(workspace.workDir, ref);
  if (!item) {
    sendApiError(response, 404, `No item resolves to ref "${ref}".`, "ref-not-found");
    return;
  }

  const tasksDir = path.join(item.dir, "tasks");
  let entries;
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 200, { ref: item.ref, tasks: [] });
      return;
    }
    throw error;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".feature"))
    .map((entry) => entry.name)
    .sort();

  const tasks = [];
  for (const file of fileNames) {
    const text = await readFile(path.join(tasksDir, file), "utf8");
    const parsed = parseFeature(text);
    const counts = { executable: 0, manual: 0, uat: 0 };
    for (const scenario of parsed.scenarios) {
      if (scenario.lane && counts[scenario.lane] !== undefined) counts[scenario.lane] += 1;
    }
    tasks.push({ file, feature: parsed.feature, scenarios: parsed.scenarios, counts });
  }

  sendJson(response, 200, { ref: item.ref, tasks });
}

async function handleValidate(response, workspace, params) {
  const scope = scopeParam(params);
  const findings = await validateWork(workspace.workDir, workspace.config, scope);
  sendJson(response, 200, {
    findings: findings.map((finding) => ({
      path: displayPath(workspace.projectRoot, finding.path),
      problem: finding.problem,
    })),
  });
}

async function handleNext(response, workspace, params) {
  const scope = scopeParam(params);
  const result = await nextWork(workspace.workDir, scope);
  const payload = { ...result };
  if (typeof payload.path === "string") {
    payload.path = displayPath(workspace.projectRoot, payload.path);
  }
  sendJson(response, 200, payload);
}

async function handleFeedback(request, response, workspace) {
  const body = await readJsonBody(request);
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const actor = typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "you";
  const refs = typeof body.refs === "string" ? body.refs.trim() : "";

  if (!ref) {
    sendApiError(response, 400, "A target ref is required.", "missing-ref");
    return;
  }
  if (!note) {
    sendApiError(response, 400, "Feedback note is required.", "missing-note");
    return;
  }

  // The feedback route is a WRITE, so it must resolve by EXACT ref — never the
  // free-text slug fallback the read routes tolerate. A typo'd/partial ref must
  // 404, not silently append the bullet to the first slug match (the wrong item).
  const item = await resolveItemExact(workspace.workDir, ref);
  if (!item) {
    sendApiError(response, 404, `No item resolves to ref "${ref}".`, "ref-not-found");
    return;
  }
  if (item.type !== "milestone" && item.type !== "story") {
    sendApiError(response, 400, "Feedback targets a milestone or story item.", "unsupported-target");
    return;
  }

  // The canonical bullet form (templates/uat/STATE.md:30): em-dash before
  // "Raised by:", and exactly three spaces before an optional "Refs:".
  const bullet = refs
    ? `- ${note} — Raised by: ${actor}   Refs: ${refs}`
    : `- ${note} — Raised by: ${actor}`;

  await appendFeedbackBullet(path.join(item.dir, "STATE.md"), bullet);
  sendJson(response, 200, { ok: true, bullet });
}

// The board's ONLY filesystem write: ensure the verbatim `## Feedback (for
// retro)` heading exists (creating it if absent), then append exactly one bullet
// beneath the existing entries — never disturbing prior content (ADR-004).
async function appendFeedbackBullet(statePath, bullet) {
  let original;
  try {
    original = await readFile(statePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    original = null;
  }

  if (original === null) {
    // No STATE.md at all: create it with the heading and the one bullet.
    await writeFile(statePath, `${FEEDBACK_HEADING}\n\n${bullet}\n`, "utf8");
    return;
  }

  if (!original.includes(FEEDBACK_HEADING)) {
    // Heading absent: append it verbatim, then the bullet, beneath existing body.
    const prefix = original.length === 0 || original.endsWith("\n") ? "" : "\n";
    const gap = original.length === 0 ? "" : "\n";
    await appendFile(statePath, `${prefix}${gap}${FEEDBACK_HEADING}\n\n${bullet}\n`, "utf8");
    return;
  }

  // Heading present: insert the bullet at the end of the heading's section,
  // beneath any existing bullets, without rewriting them.
  const lines = original.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === FEEDBACK_HEADING);
  // Find where this section ends (the next heading, or end of file).
  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  // Walk back over trailing blank lines so the new bullet sits with the others.
  let insertAt = sectionEnd;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  // If the section has no bullet yet, leave a blank line after the heading.
  if (insertAt === headingIndex + 1) {
    lines.splice(insertAt, 0, "", bullet);
  } else {
    lines.splice(insertAt, 0, bullet);
  }
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(statePath, lines.join(newline), "utf8");
}

// Resolve an item by ref to its native-path `dir` (+ ref/type) using findWork —
// the canonical resolver. Returns null when nothing resolves.
async function resolveItem(workDir, ref) {
  if (!ref) return null;
  const rows = await findWork(workDir, ref);
  // Prefer an exact ref match; findWork can return slug matches for free text.
  return rows.find((row) => row.ref === ref) ?? rows[0] ?? null;
}

function scopeParam(params) {
  const scope = (params.get("scope") ?? "").trim();
  return scope === "" ? undefined : scope;
}

// Turn an absolute item path into a forward-slashed path relative to the project
// root for display on the wire (Windows host → forward slashes, ADR-002 style).
function displayPath(projectRoot, absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);
  return relative.replaceAll("\\", "/");
}

// --- local response helpers (mirrors setup-ui.mjs; not exported there) -------

function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

function sendApiError(response, status, message, code) {
  sendJson(response, status, { ok: false, error: message, code });
}

function send(response, status, contentTypeValue, body) {
  response.writeHead(status, { "content-type": contentTypeValue });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 1_000_000) tooLarge = true;
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(httpError("Request body is too large.", "payload-too-large", 413));
        return;
      }
      if (body.trim() === "") {
        reject(httpError("Request body must be JSON.", "empty-json", 400));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(httpError(`Malformed JSON: ${error.message}`, "malformed-json", 400));
      }
    });
    request.on("error", reject);
  });
}

function httpError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
