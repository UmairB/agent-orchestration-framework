import { readdir } from "node:fs/promises";
import path from "node:path";

export async function* walkFiles(root, extensions) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  const extensionSet = new Set(extensions);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath, extensions);
    } else if (entry.isFile() && extensionSet.has(path.extname(entry.name))) {
      yield fullPath;
    }
  }
}

