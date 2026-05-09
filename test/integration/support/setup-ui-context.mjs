import { mkdir } from "node:fs/promises";
import { serveSetupUi } from "../../../src/setup-ui.mjs";

export async function startSetupUi(context) {
  if (context.setupUi) return;
  await mkdir(context.projectDir, { recursive: true });
  const savedItems = [];
  const catalog = {
    listItems: () => savedItems,
    upsertItem: (item) => savedItems.push(item)
  };
  const { server, url } = await serveSetupUi(catalog, {
    port: 0,
    projectDir: context.projectDir,
    env: { AOF_GLOBAL_HOME: context.globalDir }
  });
  context.setupUi = { server, url, savedItems };
  context.lastHttpResponse = null;
}

export async function cleanupSetupUiContext(context) {
  if (!context.setupUi?.server) return;
  await new Promise((resolve, reject) => {
    context.setupUi.server.close((error) => error ? reject(error) : resolve());
  });
  context.setupUi = null;
}

export async function requestSetupUi(context, method, route, body, options = {}) {
  if (!context.setupUi) throw new Error("Setup UI server has not been started.");
  const response = await fetch(new URL(route.replace(/^\//, ""), context.setupUi.url), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : options.raw ? body : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  context.lastHttpResponse = { status: response.status, text, json };
  return context.lastHttpResponse;
}
