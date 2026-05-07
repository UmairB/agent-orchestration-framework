import os from "node:os";
import path from "node:path";

export function defaultDataDir(env = process.env, platform = process.platform, homedir = os.homedir()) {
  if (env.AOF_DATA_DIR) return path.resolve(env.AOF_DATA_DIR);

  if (platform === "win32") {
    return path.join(env.APPDATA ?? path.join(homedir, "AppData", "Roaming"), "aof");
  }

  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", "aof");
  }

  return path.join(env.XDG_DATA_HOME ?? path.join(homedir, ".local", "share"), "aof");
}

export function defaultDbPath(options = {}) {
  if (options.db) return path.resolve(options.db);
  return path.join(defaultDataDir(), "aof.sqlite");
}
