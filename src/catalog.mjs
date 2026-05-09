export const BUILTIN_ITEMS = [];

export async function openCatalog() {
  return new Catalog();
}

class Catalog {
  constructor() {
    this.path = null;
    this.items = [];
  }

  close() {}

  seedBuiltins() {}

  listItems() {
    return [...this.items];
  }

  getItems(ids) {
    return this.items.filter((item) => ids.includes(item.id));
  }

  upsertItem(item) {
    const normalized = {
      id: item.id,
      kind: item.kind,
      name: item.name ?? item.id,
      description: item.description ?? "",
      body: item.body ?? "",
      source: item.source ?? "user",
      runtimes: item.runtimes ?? ["claude", "codex"],
      defaultEnabled: Boolean(item.defaultEnabled)
    };
    const index = this.items.findIndex((candidate) => candidate.id === normalized.id);
    if (index >= 0) {
      this.items[index] = normalized;
    } else {
      this.items.push(normalized);
    }
  }

  defaultItems() {
    return this.items.filter((item) => item.defaultEnabled);
  }
}

export function itemsToConfig(items) {
  return {
    name: "catalog-selection",
    resources: items.filter((item) => item.kind !== "framework").map((item) => ({
      kind: item.kind,
      id: item.id,
      name: item.name,
      description: item.description,
      runtimes: item.runtimes,
      body: item.body
    })),
    packages: items.filter((item) => item.kind === "framework").map((item) => ({
      id: item.id,
      namespace: item.id,
      source: item.source,
      runtimes: item.runtimes
    }))
  };
}
