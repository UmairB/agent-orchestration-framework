import assert from "node:assert/strict";
import path from "node:path";
import { defaultDataDir, defaultGlobalWorkspaceDir } from "../src/paths.mjs";

export const pathTests = [
  {
    name: "uses APPDATA on Windows",
    run() {
      assert.equal(
        defaultDataDir({ APPDATA: "C:\\Users\\Test\\AppData\\Roaming" }, "win32", "C:\\Users\\Test"),
        path.join("C:\\Users\\Test\\AppData\\Roaming", "aof")
      );
    }
  },
  {
    name: "uses XDG_DATA_HOME on Linux",
    run() {
      assert.equal(
        defaultDataDir({ XDG_DATA_HOME: "/tmp/data" }, "linux", "/home/test"),
        path.join("/tmp/data", "aof")
      );
    }
  },
  {
    name: "uses ~/.aof for global source workspace",
    run() {
      assert.equal(defaultGlobalWorkspaceDir({}, "linux", "/home/test"), path.join("/home/test", ".aof"));
    }
  },
  {
    name: "global source workspace is separate from app data",
    run() {
      const env = { XDG_DATA_HOME: "/tmp/data" };
      assert.equal(defaultDataDir(env, "linux", "/home/test"), path.join("/tmp/data", "aof"));
      assert.equal(defaultGlobalWorkspaceDir(env, "linux", "/home/test"), path.join("/home/test", ".aof"));
    }
  },
  {
    name: "AOF_GLOBAL_HOME overrides global source workspace",
    run() {
      assert.equal(defaultGlobalWorkspaceDir({ AOF_GLOBAL_HOME: "/tmp/aof-global" }, "linux", "/home/test"), path.resolve("/tmp/aof-global"));
    }
  }
];
