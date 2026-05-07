import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitiesPayload, loadEditableConfig, saveEditableResource, saveEditableSections } from "./config-editor.mjs";
import { supportedResourceKinds, supportedRuntimes } from "./model.mjs";

const MAX_BODY_BYTES = 1_000_000;
const VALID_CONFIG_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());
const VALID_CATALOG_KINDS = new Set(["skill", "agent"]);

export async function serveSetupUi(catalog, options = {}) {
  const port = Number.parseInt(options.port ?? "4177", 10);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uiRoot = path.join(repoRoot, "ui");
  const projectDir = path.resolve(options.projectDir ?? process.cwd());

  const server = http.createServer(async (request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendApiError(response, 400, "Invalid request URL.", "invalid-url");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/config") {
      try {
        sendJson(response, 200, await loadEditableConfig(projectDir));
      } catch (error) {
        sendApiError(response, 400, error.message, "config-load-failed");
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/capabilities") {
      sendJson(response, 200, capabilitiesPayload());
      return;
    }

    if (request.method === "PUT" && requestUrl.pathname === "/api/config/sections") {
      try {
        const sections = await readJsonBody(request);
        const result = await saveEditableSections(projectDir, sections);
        sendJson(response, result.ok ? 200 : 400, result);
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    const resourceMatch = requestUrl.pathname.match(/^\/api\/config\/resources\/([^/]+)\/([^/]+)$/);
    if (request.method === "PUT" && resourceMatch) {
      try {
        const routeKind = decodeRoutePart(resourceMatch[1]);
        const routeId = decodeRoutePart(resourceMatch[2]);
        if (!VALID_CONFIG_KINDS.has(routeKind)) {
          sendApiError(response, 400, `Unsupported resource kind "${routeKind}".`, "invalid-kind");
          return;
        }
        if (!routeId) {
          sendApiError(response, 400, "Resource id is required.", "invalid-id");
          return;
        }

        const item = await readJsonBody(request);
        if (item.kind !== undefined && item.kind !== routeKind) {
          sendApiError(response, 400, "Resource kind in payload does not match request path.", "route-payload-mismatch");
          return;
        }
        if (item.id !== undefined && item.id !== routeId) {
          sendApiError(response, 400, "Resource id in payload does not match request path.", "route-payload-mismatch");
          return;
        }
        const result = await saveEditableResource(projectDir, {
          ...item,
          kind: routeKind,
          id: routeId
        });
        sendJson(response, result.ok ? 200 : 400, result);
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/items") {
      sendJson(response, 200, catalog.listItems());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/items") {
      try {
        const item = await readJsonBody(request);
        const diagnostics = validateCatalogItem(item);
        if (diagnostics.length > 0) {
          sendApiError(response, 400, "Catalog item is invalid.", "validation-failed", diagnostics);
          return;
        }
        catalog.upsertItem(item);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendApiError(response, 404, "API route not found.", "not-found");
      return;
    }

    const filePath = safeStaticPath(uiRoot, requestUrl.pathname);
    if (!filePath) {
      send(response, 404, "text/plain", "Not found");
      return;
    }

    readFile(filePath).then((content) => {
      send(response, 200, contentType(filePath), content);
    }).catch(() => {
      send(response, 404, "text/plain", "Not found");
    });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

function sendApiError(response, status, message, code, diagnostics) {
  sendJson(response, status, {
    ok: false,
    error: message,
    code,
    ...(diagnostics ? { diagnostics } : {})
  });
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
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        tooLarge = true;
      }
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

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  return "application/octet-stream";
}

function safeStaticPath(uiRoot, pathname) {
  let relativePath;
  try {
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (path.isAbsolute(relativePath)) return null;
  const filePath = path.resolve(uiRoot, relativePath);
  const root = path.resolve(uiRoot);
  return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

function decodeRoutePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    const error = httpError("Invalid URL encoding.", "invalid-url", 400);
    throw error;
  }
}

function validateCatalogItem(item) {
  const diagnostics = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [diagnostic("item", "Catalog item must be a JSON object.")];
  }
  if (typeof item.id !== "string" || item.id.trim() === "") {
    diagnostics.push(diagnostic("id", "Catalog item id is required."));
  }
  if (!VALID_CATALOG_KINDS.has(item.kind)) {
    diagnostics.push(diagnostic("kind", "Only skills and agents are supported in setup for now."));
  }
  if (item.name !== undefined && typeof item.name !== "string") {
    diagnostics.push(diagnostic("name", "Catalog item name must be a string when provided."));
  }
  if (item.body !== undefined && typeof item.body !== "string") {
    diagnostics.push(diagnostic("body", "Catalog item body must be a string when provided."));
  }
  if (item.runtimes !== undefined) {
    if (!Array.isArray(item.runtimes) || item.runtimes.length === 0) {
      diagnostics.push(diagnostic("runtimes", "Catalog item runtimes must be a non-empty array when provided."));
    } else {
      for (const runtime of item.runtimes) {
        if (!VALID_RUNTIMES.has(runtime)) {
          diagnostics.push(diagnostic("runtimes", `Unsupported runtime "${runtime}".`));
        }
      }
    }
  }
  return diagnostics;
}

function diagnostic(pathName, message) {
  return { severity: "error", path: pathName, message, blocking: true };
}

function httpError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
