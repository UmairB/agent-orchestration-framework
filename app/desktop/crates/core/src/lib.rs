//! `mesh-desktop-core` — the shell-agnostic supervisor core for the Mesh Desktop App
//! (milestone 36, story 00 · supervisor-core).
//!
//! This crate holds ONLY plain, testable Rust functions — no `tauri`, no window, no
//! real process spawn, no real sleep/timer. It is the `@executable` seam: `cargo
//! test` over this crate runs headlessly and fast (STORY.md "Build notes" — "the
//! pure functions live in a shell-agnostic core module, separate from the
//! Tauri/native-shell glue"). The Tauri shell that spawns real children, opens the
//! window, and owns the Job Object containment (tasks 02/03, `@manual`) is a
//! separate crate consuming this one — deliberately not added to the workspace yet
//! so this crate's tests stay independent of the heavy WebView2/Tauri dependency
//! tree.
//!
//! Modules map 1:1 onto the story's tasks:
//! - [`resolve`] — task 00, trusted co-located `aof` resolution (ADR-004 d4).
//! - [`status`] — task 01, the corrected `mesh status --json` shape (ADR-004 d1-2).
//! - [`poll`] — task 01 (continued), the single-fleet-data-path cadence.
//! - [`supervision`] — task 02's PURE seams: the role-driven supervision set and the
//!   restart/backoff + local-process state machine (ADR-002 d1-2). The task 02
//!   `.feature` itself is `@manual` (a real watchdog over real/stub children); this
//!   module is the decision logic that engine is built from.
//!
//! Story 01 (tray-presence) + story 02 (node-work-view) modules — both extend this
//! SAME core crate, sitting on story 00's health/role model and `status::MeshStatus`:
//! - [`icon`] — story 01 task 00, the pure health-summary → tray-icon-state mapping
//!   (`icon_state`).
//! - [`tray_menu`] — story 01 task 01, the pure tray-menu model (`tray_menu`).
//! - [`view_model`] — story 02 task 00, the pure `mesh status --json` → node-row
//!   view-model, built directly on [`status::MeshStatus`]/[`status::Node`].
//! - [`render_state`] — story 02 task 01, the four-state (empty/loading/error/
//!   populated) selection logic.
//! - [`read_only_inventory`] — story 02 task 02, the read-only window WIRE
//!   inventory (arms `acd-desktop-read-only-fleet`, exercises
//!   `acd-desktop-single-data-path`).

pub mod icon;
pub mod poll;
pub mod read_only_inventory;
pub mod render_state;
pub mod resolve;
pub mod status;
pub mod supervision;
pub mod tray_menu;
pub mod view_model;
