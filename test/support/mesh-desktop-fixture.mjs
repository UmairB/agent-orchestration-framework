// Shared fixture builder for the milestone 36 / story 03 desktop install/run test
// suites — a fixture install root (a temp $HOME/.aof/bin) + a fixture "app
// artifact" + a fixture "WebView2 bootstrapper artifact" standing in for the real
// packaged Tauri bundle (the story's Build notes: "a fixture app artifact stands
// in for the built Tauri bundle; the test asserts WHERE files land and the
// refusal shape, not that a real signed .exe runs").
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DESKTOP_APP_EXE, WEBVIEW2_BOOTSTRAPPER } from "../../src/commands/mesh-desktop.mjs";

// withMeshDesktopFixture(fn, { seedAofBinary, seedArtifacts }) — builds a temp
// tree: <tmp>/home/.aof/bin (the fixture $HOME/.aof/bin install dir, with the m28
// `aof` binary already present per the Background) and <tmp>/artifacts (a fixture
// app exe + WebView2 bootstrapper exe to place). Cleans up unconditionally.
export async function withMeshDesktopFixture(fn, { seedAofBinary = true, seedArtifacts = true } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-desktop-"));
  const home = path.join(tmp, "home");
  const installDir = path.join(home, ".aof", "bin");
  const artifactsDir = path.join(tmp, "artifacts");
  try {
    await mkdir(installDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });

    if (seedAofBinary) {
      await writeFile(path.join(installDir, "aof.exe"), "fixture-aof-binary-v1", "utf8");
    }

    const appArtifactPath = path.join(artifactsDir, "aof-mesh-desktop-source.exe");
    const bootstrapperArtifactPath = path.join(artifactsDir, "webview2-bootstrapper-source.exe");
    if (seedArtifacts) {
      await writeFile(appArtifactPath, "fixture-app-bytes-v1", "utf8");
      await writeFile(bootstrapperArtifactPath, "fixture-bootstrapper-bytes", "utf8");
    }

    return await fn({ tmp, home, installDir, artifactsDir, appArtifactPath, bootstrapperArtifactPath });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// seedInstalledApp(installDir, { appBytes }) — pre-place a runnable fixture app
// (+ bootstrapper) as if a PRIOR install already ran (the "already installed"
// Background several scenarios need).
export async function seedInstalledApp(installDir, { appBytes = "fixture-app-bytes-prior", bootstrapperBytes = "fixture-bootstrapper-bytes-prior" } = {}) {
  await mkdir(installDir, { recursive: true });
  await writeFile(path.join(installDir, DESKTOP_APP_EXE), appBytes, "utf8");
  await writeFile(path.join(installDir, WEBVIEW2_BOOTSTRAPPER), bootstrapperBytes, "utf8");
}

export { DESKTOP_APP_EXE, WEBVIEW2_BOOTSTRAPPER };
