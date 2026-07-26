//! Task 00 — trusted `aof` resolution (ARCHITECTURE 36/ADR-004 decision 4).
//!
//! The supervisor resolves the sibling `aof` binary it spawns by an ABSOLUTE,
//! co-located path in its OWN install dir (`$HOME/.aof/bin`, ADR-003) — NEVER a
//! bare-PATH `aof` lookup (the exact hijack vector RESEARCH §4 documents). A
//! dev/unpackaged run (no co-located sibling) falls back per the `mesh-fabric`
//! PATH-first-then-pinned precedent (`src/mesh-fabric.mjs`) rather than crashing.
//!
//! This module returns a RESOLVED path + argv; it never itself calls
//! `std::process::Command::spawn` — the spawn call is `acd-desktop-trusted-spawn`'s
//! surface (feature file comment, task 00), kept in the Tauri shell crate that
//! consumes this resolver.

use std::path::{Path, PathBuf};

/// How the `aof` binary to spawn was resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolutionMode {
    /// The packaged happy path: an absolute path to the sibling binary inside the
    /// supervisor's own install dir. No PATH search at all.
    CoLocated,
    /// The dev/unpackaged fallback: no co-located sibling was found, so resolution
    /// fell back to the `mesh-fabric` PATH-first-then-pinned-absolute idiom.
    PathThenPinnedFallback,
}

/// The resolved `aof` binary: an absolute path plus how it was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAof {
    pub path: PathBuf,
    pub mode: ResolutionMode,
}

/// A minimal environment seam so resolution is testable without touching the real
/// process environment — mirrors the fake-clock/fake-`$HOME` seam the story's Build
/// notes call for ("a fake home dir … fed to the resolver").
pub trait ResolveEnv {
    /// The value of `PATH` as a list of directories (already split), most-preferred
    /// first — empty when unset/irrelevant for a test.
    fn path_dirs(&self) -> Vec<PathBuf>;
}

/// A simple `ResolveEnv` fed by explicit fixture values — the seam the `@executable`
/// scenarios drive (Scenario Outline "co-located sibling first / PATH fallback").
#[derive(Debug, Clone, Default)]
pub struct FixtureEnv {
    pub path_dirs: Vec<PathBuf>,
}

impl ResolveEnv for FixtureEnv {
    fn path_dirs(&self) -> Vec<PathBuf> {
        self.path_dirs.clone()
    }
}

/// The platform-specific aof executable filename inside the install dir.
#[cfg(windows)]
fn aof_filename() -> &'static str {
    "aof.exe"
}
#[cfg(not(windows))]
fn aof_filename() -> &'static str {
    "aof"
}

/// Resolve the `aof` binary to spawn.
///
/// `install_dir` is the supervisor's OWN install dir — `$HOME/.aof/bin` in
/// production (ADR-003), an arbitrary fixture dir in tests. `env` supplies the
/// PATH-fallback seam for the dev/unpackaged case.
///
/// CO-LOCATED FIRST: if `install_dir/aof(.exe)` exists, that absolute path is
/// returned with `ResolutionMode::CoLocated` — no PATH search performed at all.
///
/// FALLBACK: if no co-located sibling exists, resolution walks `env.path_dirs()`
/// looking for `aof(.exe)` in each directory (mirroring `mesh-fabric.mjs`'s
/// PATH-first idiom) and returns the FIRST match found, `PathThenPinnedFallback`.
/// If nothing is found anywhere, resolution still does not crash — it returns the
/// bare filename as a LAST-RESORT relative path (degrade, don't crash), still
/// tagged `PathThenPinnedFallback` so callers can surface a "dev mode, aof not
/// found" diagnostic rather than panicking.
pub fn resolve_aof(install_dir: &Path, env: &dyn ResolveEnv) -> ResolvedAof {
    let filename = aof_filename();
    let co_located = install_dir.join(filename);
    if co_located.is_file() {
        return ResolvedAof {
            path: co_located,
            mode: ResolutionMode::CoLocated,
        };
    }

    for dir in env.path_dirs() {
        let candidate = dir.join(filename);
        if candidate.is_file() {
            return ResolvedAof {
                path: candidate,
                mode: ResolutionMode::PathThenPinnedFallback,
            };
        }
    }

    // Degrade, don't crash: no sibling, no PATH match (or an unpopulated env in a
    // pure unit test) — fall back to the bare filename. The caller (the trusted-spawn
    // surface) is responsible for surfacing "aof not found" rather than looping.
    ResolvedAof {
        path: PathBuf::from(filename),
        mode: ResolutionMode::PathThenPinnedFallback,
    }
}

/// True when `path` is located inside `install_dir` (used to assert "the resolved
/// path points inside the supervisor's own install dir").
pub fn is_inside(path: &Path, install_dir: &Path) -> bool {
    path.starts_with(install_dir)
}

/// A shell-less spawn form: a program path plus an argv vector — never a shell
/// command string. `form_spawn` builds this WITHOUT spawning anything (the spawn
/// call itself is the trusted-spawn fitness's surface, owned by the Tauri shell).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnForm {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Form the argv for `aof mesh status --json` off a resolved aof path. Shell-less:
/// program is the resolved absolute path, args is a plain vector — never a
/// `cmd`/`sh`/`powershell` wrapper string.
pub fn form_mesh_status_spawn(resolved: &ResolvedAof) -> SpawnForm {
    SpawnForm {
        program: resolved.path.clone(),
        args: vec!["mesh".to_string(), "status".to_string(), "--json".to_string()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn touch_executable(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"stub").expect("write stub binary");
        p
    }

    // Scenario: the packaged supervisor resolves aof by an absolute path to its
    // co-located sibling.
    #[test]
    fn resolves_co_located_sibling_by_absolute_path_with_no_path_search() {
        let home = TempDir::new().unwrap();
        let install_dir = home.path().join(".aof").join("bin");
        fs::create_dir_all(&install_dir).unwrap();
        let expected = touch_executable(&install_dir, aof_filename());

        // A poisoned PATH env that, if consulted, would resolve to a DIFFERENT file —
        // proving no PATH search happened for the co-located case.
        let poisoned_dir = home.path().join("poisoned-path-entry");
        fs::create_dir_all(&poisoned_dir).unwrap();
        touch_executable(&poisoned_dir, aof_filename());
        let env = FixtureEnv { path_dirs: vec![poisoned_dir.clone()] };

        let resolved = resolve_aof(&install_dir, &env);

        assert_eq!(resolved.path, expected, "resolved path is the absolute co-located path");
        assert_eq!(resolved.mode, ResolutionMode::CoLocated, "resolution performed no PATH search");
        assert!(is_inside(&resolved.path, &install_dir), "resolved path is inside the supervisor's own install dir");
    }

    // Scenario: resolution never spawns a bare-PATH "aof" that an earlier PATH entry
    // could hijack.
    #[test]
    fn never_resolves_to_the_earlier_path_hijack_when_co_located_sibling_exists() {
        let home = TempDir::new().unwrap();
        let install_dir = home.path().join(".aof").join("bin");
        fs::create_dir_all(&install_dir).unwrap();
        let expected = touch_executable(&install_dir, aof_filename());

        let earlier_path_entry = home.path().join("earlier-on-path");
        fs::create_dir_all(&earlier_path_entry).unwrap();
        let hijack = touch_executable(&earlier_path_entry, aof_filename());

        let env = FixtureEnv { path_dirs: vec![earlier_path_entry.clone()] };
        let resolved = resolve_aof(&install_dir, &env);

        assert_eq!(resolved.path, expected, "the resolved program is the absolute co-located path, not the bare name");
        assert_ne!(resolved.path, hijack, "the earlier PATH aof.exe is not the resolved target");
    }

    // Scenario: the spawn is a shell-less argv, never routed through a shell
    // interpreter.
    #[test]
    fn forms_a_shell_less_argv_for_mesh_status() {
        let home = TempDir::new().unwrap();
        let install_dir = home.path().join(".aof").join("bin");
        fs::create_dir_all(&install_dir).unwrap();
        let expected = touch_executable(&install_dir, aof_filename());
        let env = FixtureEnv::default();

        let resolved = resolve_aof(&install_dir, &env);
        let spawn = form_mesh_status_spawn(&resolved);

        assert_eq!(spawn.program, expected, "the spawn program is the resolved absolute aof path");
        assert_eq!(
            spawn.args,
            vec!["mesh".to_string(), "status".to_string(), "--json".to_string()],
            "the arguments are the argv vector [mesh, status, --json]"
        );
        // Shell-less: the program is never one of the shell interpreters, and args
        // never collapse into a single joined command string.
        let program_str = spawn.program.to_string_lossy().to_lowercase();
        for shell in ["cmd", "cmd.exe", "sh", "bash", "powershell", "powershell.exe", "pwsh"] {
            assert!(
                !program_str.ends_with(shell),
                "the spawn is not wrapped in a {shell} shell string"
            );
        }
        assert_eq!(spawn.args.len(), 3, "argv stays a vector of discrete arguments, not one joined string");
    }

    // Scenario Outline: resolution chooses the co-located sibling first and the PATH
    // fallback only when no sibling exists.
    #[test]
    fn resolution_mode_is_co_located_when_sibling_present() {
        let home = TempDir::new().unwrap();
        let install_dir = home.path().join(".aof").join("bin");
        fs::create_dir_all(&install_dir).unwrap();
        touch_executable(&install_dir, aof_filename());
        let env = FixtureEnv::default();

        let resolved = resolve_aof(&install_dir, &env);

        assert_eq!(resolved.mode, ResolutionMode::CoLocated, "mode is \"co-located absolute path\"");
    }

    #[test]
    fn resolution_mode_is_path_then_pinned_fallback_when_sibling_absent_dev_run() {
        let home = TempDir::new().unwrap();
        let install_dir = home.path().join(".aof").join("bin");
        fs::create_dir_all(&install_dir).unwrap(); // install dir exists, but empty — a dev/unpackaged run

        let path_dir = home.path().join("some-path-dir");
        fs::create_dir_all(&path_dir).unwrap();
        touch_executable(&path_dir, aof_filename());
        let env = FixtureEnv { path_dirs: vec![path_dir] };

        let resolved = resolve_aof(&install_dir, &env);

        assert_eq!(resolved.mode, ResolutionMode::PathThenPinnedFallback, "mode is \"PATH-then-pinned fallback (dev run)\"");
    }

    #[test]
    fn resolution_never_crashes_even_when_nothing_is_found_anywhere() {
        let home = TempDir::new().unwrap();
        let install_dir = home.path().join(".aof").join("bin");
        fs::create_dir_all(&install_dir).unwrap();
        let env = FixtureEnv::default(); // no PATH dirs at all, no co-located sibling

        // The point of the assertion: this call returns instead of panicking.
        let resolved = resolve_aof(&install_dir, &env);

        assert_eq!(resolved.mode, ResolutionMode::PathThenPinnedFallback, "resolution does not crash — it degrades to the fallback mode");
        let spawn = form_mesh_status_spawn(&resolved);
        assert!(!spawn.program.as_os_str().is_empty(), "whichever program is chosen, it is non-empty");
    }
}
