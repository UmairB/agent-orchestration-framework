import { checkbox, confirm, input, select } from "@inquirer/prompts";

const PROJECT_RESOURCE_KINDS = ["skill", "command", "agent", "rule"];
const GLOBAL_RESOURCE_KINDS = ["skill", "agent", "rule"];

export async function selectItems(items) {
  if (items.length === 0) return [];

  if (process.env.AOF_TEST_SELECTION_INPUT !== undefined) {
    printChoices(items);
    console.log("Install which items? Enter numbers, ids, 'all', or press Enter for preselected items: ");
    return resolveSelection(items, process.env.AOF_TEST_SELECTION_INPUT);
  }

  assertInteractiveTerminal("select project items");
  const selectedIds = await checkbox({
    message: "Select project items",
    instructions: "Use arrows to move, space to toggle, enter to confirm.",
    choices: items.map((item) => ({
      name: `${item.id} (${item.kind}) - ${item.description ?? ""}`,
      value: item.id,
      checked: Boolean(item.defaultEnabled)
    }))
  });
  return selectedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);
}

export async function selectRuntimes() {
  if (process.env.AOF_TEST_RUNTIMES_INPUT !== undefined) {
    return resolveRuntimeSelection(process.env.AOF_TEST_RUNTIMES_INPUT);
  }

  assertInteractiveTerminal("select coding assistants");
  return checkbox({
    message: "Select coding assistants",
    instructions: "Use arrows to move, space to toggle, enter to confirm.",
    choices: [
      { name: "Claude Code", value: "claude", checked: true },
      { name: "Codex", value: "codex", checked: true }
    ],
    validate(selected) {
      return selected.length > 0 || "Select at least one coding assistant.";
    }
  });
}

export async function confirmAction(question, defaultValue = false) {
  if (process.env.AOF_TEST_CONFIRM_INPUT !== undefined) {
    return resolveConfirmation(nextTestConfirmation(), defaultValue);
  }

  assertInteractiveTerminal("confirm action");
  return confirm({ message: question, default: defaultValue });
}

export async function promptResourceInput(options = {}) {
  if (process.env.AOF_TEST_RESOURCE_INPUT !== undefined) {
    return parseResourceInput(process.env.AOF_TEST_RESOURCE_INPUT, options);
  }

  assertInteractiveTerminal("create a resource interactively");
  const allowedKinds = options.global ? GLOBAL_RESOURCE_KINDS : PROJECT_RESOURCE_KINDS;
  const kind = options.kind ?? (await select({
    message: options.global ? "Select global asset type" : "Select project asset type",
    choices: allowedKinds.map((value) => ({ name: value, value }))
  }));
  if (!allowedKinds.includes(kind)) {
    throw new Error(`Invalid ${options.global ? "global " : ""}resource kind "${kind}". Expected ${allowedKinds.join(", ")}.`);
  }

  const id = options.id ?? (await input({
    message: "Asset id",
    validate(value) {
      return value.trim() !== "" || "Asset id is required.";
    }
  }));
  const description = await input({
    message: "Description",
    default: options.description ?? ""
  });
  const runtimes = options.runtimes ?? (await selectRuntimes());
  const body = await input({
    message: "Initial body (optional)",
    default: options.body ?? ""
  });

  return {
    kind,
    id: id.trim(),
    description: description.trim(),
    runtimes,
    body
  };
}

export function resolveConfirmation(answer, defaultValue = false) {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultValue;
  if (["y", "yes", "true", "1"].includes(trimmed)) return true;
  if (["n", "no", "false", "0"].includes(trimmed)) return false;
  throw new Error(`Unsupported confirmation "${answer}". Expected yes or no.`);
}

export function resolveRuntimeSelection(answer) {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "" || trimmed === "all") return ["claude", "codex"];
  const runtimes = trimmed.split(",").map((runtime) => runtime.trim()).filter(Boolean);
  for (const runtime of runtimes) {
    if (!["claude", "codex"].includes(runtime)) {
      throw new Error(`Unsupported runtime "${runtime}". Expected claude, codex, or all.`);
    }
  }
  return [...new Set(runtimes)];
}

export function resolveSelection(items, answer) {
  const trimmed = answer.trim();
  if (trimmed === "") return items.filter((item) => item.defaultEnabled);
  if (trimmed.toLowerCase() === "all") return items;

  const tokens = trimmed.split(",").map((token) => token.trim()).filter(Boolean);
  const selected = [];
  for (const token of tokens) {
    const byIndex = Number.parseInt(token, 10);
    const item = Number.isInteger(byIndex) && String(byIndex) === token
      ? items[byIndex - 1]
      : items.find((candidate) => candidate.id === token);

    if (!item) {
      throw new Error(`Unknown selection "${token}". Use listed numbers or ids.`);
    }

    if (!selected.some((candidate) => candidate.id === item.id)) {
      selected.push(item);
    }
  }

  return selected;
}

function printChoices(items) {
  for (const [index, item] of items.entries()) {
    const marker = item.defaultEnabled ? "*" : " ";
    console.log(`${index + 1}. [${marker}] ${item.id} (${item.kind}) - ${item.description}`);
  }
}

export function parseResourceInput(value, options = {}) {
  const parsed = JSON.parse(value);
  const allowedKinds = options.global ? GLOBAL_RESOURCE_KINDS : PROJECT_RESOURCE_KINDS;
  const kind = parsed.kind ?? options.kind;
  if (!allowedKinds.includes(kind)) {
    throw new Error(`Invalid ${options.global ? "global " : ""}resource kind "${kind}". Expected ${allowedKinds.join(", ")}.`);
  }
  const id = parsed.id ?? options.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Asset id is required.");
  }
  return {
    kind,
    id: id.trim(),
    description: typeof parsed.description === "string" ? parsed.description : "",
    runtimes: parseResourceRuntimes(parsed.runtimes),
    body: typeof parsed.body === "string" ? parsed.body : ""
  };
}

function parseResourceRuntimes(value) {
  const runtimes = Array.isArray(value) ? value : resolveRuntimeSelection(value ?? "all");
  for (const runtime of runtimes) {
    if (!["claude", "codex"].includes(runtime)) {
      throw new Error(`Unsupported runtime "${runtime}". Expected claude, codex, or all.`);
    }
  }
  return [...new Set(runtimes)];
}

function assertInteractiveTerminal(action) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Cannot ${action} in a non-interactive terminal. Pass explicit CLI flags for automation.`);
  }
}

function nextTestConfirmation() {
  const values = process.env.AOF_TEST_CONFIRM_INPUT.split(",");
  const value = values.shift() ?? "";
  process.env.AOF_TEST_CONFIRM_INPUT = values.join(",");
  return value;
}
