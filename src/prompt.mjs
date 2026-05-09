import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function selectItems(items) {
  if (items.length === 0) return [];

  if (process.env.AOF_TEST_SELECTION_INPUT !== undefined) {
    printChoices(items);
    console.log("Install which items? Enter numbers, ids, 'all', or press Enter for preselected items: ");
    return resolveSelection(items, process.env.AOF_TEST_SELECTION_INPUT);
  }

  const rl = readline.createInterface({ input, output });
  try {
    printChoices(items);
    const answer = await rl.question("Install which items? Enter numbers, ids, 'all', or press Enter for preselected items: ");
    return resolveSelection(items, answer);
  } finally {
    rl.close();
  }
}

export async function selectRuntimes() {
  if (process.env.AOF_TEST_RUNTIMES_INPUT !== undefined) {
    return resolveRuntimeSelection(process.env.AOF_TEST_RUNTIMES_INPUT);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Initialize which coding assistants? Enter claude, codex, all, or press Enter for all: ");
    return resolveRuntimeSelection(answer);
  } finally {
    rl.close();
  }
}

export async function confirmAction(question, defaultValue = false) {
  if (process.env.AOF_TEST_CONFIRM_INPUT !== undefined) {
    return resolveConfirmation(nextTestConfirmation(), defaultValue);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const suffix = defaultValue ? " [Y/n]: " : " [y/N]: ";
    const answer = await rl.question(`${question}${suffix}`);
    return resolveConfirmation(answer, defaultValue);
  } finally {
    rl.close();
  }
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

function nextTestConfirmation() {
  const values = process.env.AOF_TEST_CONFIRM_INPUT.split(",");
  const value = values.shift() ?? "";
  process.env.AOF_TEST_CONFIRM_INPUT = values.join(",");
  return value;
}
