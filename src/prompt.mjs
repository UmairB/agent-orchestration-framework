import { checkbox, confirm } from "@inquirer/prompts";

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
