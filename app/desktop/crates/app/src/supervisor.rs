// Milestone 36 · story 00 tasks 02/03 (@manual) — the REAL supervision runtime that
// the Tauri shell (`main.rs`) drives the cargo-tested pure seams with. This is the
// wiring `aof:verify 36`'s blocker F1 named as missing: a live `mesh status --json`
// poll on a cadence, a role-driven watchdog over real `tokio::process` children with
// jittered-backoff restart + named-clean-exit handling, and a Windows Job-Object
// kill-on-close containment so Quit/crash reaps the whole child tree.
//
// It owns NO decisions of its own — every choice (which children for this role, the
// backoff curve, the crash-vs-clean-exit classification, the four render states, the
// trusted co-located `aof` path) is COMPUTED by `mesh_desktop_core` and already
// `cargo test`-covered. This module only turns those decisions into real OS effects:
// spawn/wait/kill, a timer, a Job Object, a channel. Fleet data still flows through
// exactly one command — `aof mesh status --json` (ADR-004 d1-2) — and the only other
// spawns are the {serve, ui} LOCAL supervision lifecycle (ADR-004 d3); no bare-PATH /
// shell-string spawn exists (every `Command::new` takes the RESOLVED absolute path,
// ADR-004 d4 / `acd-desktop-trusted-spawn`).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mesh_desktop_core::render_state::{select_render_state, FetchOutcome, PriorGoodFrame, RenderState};
use mesh_desktop_core::resolve::{form_mesh_status_spawn, resolve_aof, ResolveEnv, ResolvedAof};
use mesh_desktop_core::status::{parse_status, MeshStatus};
use mesh_desktop_core::supervision::{
    jittered_backoff_ms, CleanExitReason, JitterSource, SupervisedChild,
};

use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::Notify;

/// The web `aof mesh ui`'s real local URL (`src/mesh-ui-serve.mjs`: `http.createServer`
/// bound to `127.0.0.1`, default port 4181) — the address the tray's "Open web UI"
/// launches in the default browser.
///
/// The app is a PATH-routed SPA (milestone 45 / ADR-001, ADR-002): `/` renders the shell
/// landing, `/fleet` the fleet, `/board` the board, `/config` the config editor. The
/// warning that stood here — that the bare `/` renders BLANK and the URL therefore MUST
/// carry `?mode=fleet&scope=global` — is RETIRED: `/` is now a real address with a real
/// surface behind it. This constant still targets `/fleet` DIRECTLY rather than `/`,
/// because the tray's "Open web UI" means "show me the fleet", and landing one click away
/// from it would be a worse door, not a more honest one. The scope rides as an ordinary
/// query parameter on that path — the exact URL `aof mesh ui` itself advertises
/// (`src/commands/mesh-ui.mjs` sets `scope` on `serveMeshUi`'s `/fleet` URL; `global` is
/// the default scope for the plain `mesh ui` the supervisor spawns).
///
/// The legacy `?mode=fleet&scope=global` address a PREVIOUSLY SHIPPED build compiled into
/// this same constant still works: the entry translates it once, client-side, onto this
/// URL (ADR-003, which sets no expiry precisely because this constant is compiled).
///
/// The supervisor starts `aof mesh ui` on this port (the CLI default), so the URL is
/// known without a second data path.
pub const MESH_UI_URL: &str = "http://127.0.0.1:4181/fleet?scope=global";

/// How often the single fleet-data poll re-issues `aof mesh status --json` (DESIGN
/// §Footer "refreshed Ns ago"). One poll feeds BOTH the fleet view and the
/// `isControlNode` role decision (ADR-004 d1-2 / ADR-002 d1) — no second cadence.
const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// `CREATE_NO_WINDOW` — keep the supervised `aof`/Node children from flashing a
/// console window on the operator's desktop (they are ambient background processes).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The live supervisor state the IPC layer reads. Populated by the poll (fleet + role
/// + render state) and by the per-child watchdogs (the local-process signals). The two
/// DESIGN ramps stay separate here: `last_good_status`/`render_state` are FLEET
/// PRESENCE; `server_signal`/`ui_signal` are the LOCAL-process ramp (DESIGN
/// §Non-negotiable framing).
pub struct SupervisorState {
    pub last_good_status: Option<MeshStatus>,
    pub is_control_node: bool,
    pub render_state: RenderState,
    pub ever_populated: bool,
    /// "running" | "restarting" | "stopped" — the local Mesh-server ramp signal.
    pub server_signal: &'static str,
    /// "running" | "restarting" | "stopped" — the local Mesh web-UI ramp signal.
    pub ui_signal: &'static str,
    /// The last named clean-exit-1 message surfaced (ui-build-missing / EADDRINUSE /
    /// launcher-already-running) — shown, never restart-stormed.
    pub last_clean_exit: Option<String>,
    pub window_visible: bool,
    pub ui_url: String,
}

impl Default for SupervisorState {
    fn default() -> Self {
        SupervisorState {
            last_good_status: None,
            is_control_node: false,
            render_state: RenderState::Loading,
            ever_populated: false,
            server_signal: "stopped",
            ui_signal: "stopped",
            last_clean_exit: None,
            window_visible: true,
            ui_url: MESH_UI_URL.to_string(),
        }
    }
}

pub type SharedState = Arc<Mutex<SupervisorState>>;

/// Commands the IPC layer (tray menu / window buttons) sends into the running engine.
/// Every command is LOCAL process supervision — never a fleet mutation (ADR-004 d3).
#[derive(Debug, Clone, Copy)]
pub enum SupervisorCommand {
    StartServer,
    StopServer,
    StartUi,
    StopUi,
}

/// Which supervised child a signal update / command targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildKind {
    Server,
    Ui,
}

/// The terminal outcome of one supervised-child wait: the child exited (carrying its
/// status), or a Stop was requested (kill it).
enum WaitResult {
    Exited(std::io::Result<std::process::ExitStatus>),
    Stop,
}

/// A real system `ResolveEnv` — supplies the actual `PATH` for the dev/unpackaged
/// FALLBACK only (the packaged path is the absolute co-located sibling, resolved with
/// NO PATH search — ADR-004 d4). The pure `resolve_aof` seam owns the co-located-first
/// logic; this only feeds it the real environment.
struct SystemEnv;

impl ResolveEnv for SystemEnv {
    fn path_dirs(&self) -> Vec<PathBuf> {
        std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default()
    }
}

/// Resolve the sibling `aof` binary by its ABSOLUTE co-located path (ADR-004 d4) — the
/// trusted-spawn surface. The returned path is a VARIABLE the spawns below pass to
/// `Command::new`, never a bare `"aof"` literal.
fn resolve(install_dir: &Path) -> ResolvedAof {
    resolve_aof(install_dir, &SystemEnv)
}

/// A per-child watchdog controller: its desired running-state (flipped by Start/Stop)
/// and a notify to wake the supervised loop on a state change.
struct ChildController {
    spec: SupervisedChild,
    desired: AtomicBool,
    /// True once the poll has auto-started this child for its role, so the poll never
    /// re-starts a child the operator deliberately stopped afterwards.
    role_started: AtomicBool,
    notify: Notify,
}

impl ChildController {
    fn new(spec: SupervisedChild) -> Self {
        ChildController {
            spec,
            desired: AtomicBool::new(false),
            role_started: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
    fn set_desired(&self, on: bool) {
        self.desired.store(on, Ordering::SeqCst);
        self.notify.notify_one();
    }
    fn desired(&self) -> bool {
        self.desired.load(Ordering::SeqCst)
    }
}

// ------------------------------------------------------------------------------------
// Windows Job Object — the child-tree reaper (ADR-002 d3 / RESEARCH §2).
// ------------------------------------------------------------------------------------

/// A shareable owner of the kill-on-close Job Object. The handle is a plain `isize`
/// wrapped by `win32job`; sharing it across watchdog tasks is sound (the Win32
/// AssignProcessToJobObject call is thread-safe), so a manual Send/Sync is safe here.
#[cfg(windows)]
struct SharedJob(win32job::Job);
#[cfg(windows)]
unsafe impl Send for SharedJob {}
#[cfg(windows)]
unsafe impl Sync for SharedJob {}

/// Create the containment Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` set, so
/// closing/dropping the handle — on Quit OR on the supervisor's OWN crash/exit (the OS
/// closes every handle on process termination) — reaps every process in the job
/// transitively (`aof`, its Node child, grandchildren). `None` on failure degrades to
/// "supervise without containment" rather than refusing to run.
#[cfg(windows)]
fn create_job() -> Option<Arc<SharedJob>> {
    let job = win32job::Job::create().ok()?;
    let mut info = job.query_extended_limit_info().ok()?;
    info.limit_kill_on_job_close();
    job.set_extended_limit_info(&info).ok()?;
    Some(Arc::new(SharedJob(job)))
}

/// Assign a freshly-spawned child to the kill-on-close job so it (and its whole tree)
/// is reaped when the job handle drops. A bare `child.kill()` would signal only the
/// direct child, orphaning the Node process's descendants (RESEARCH §2) — the Job
/// Object is the correct Windows primitive.
#[cfg(windows)]
fn assign_to_job(job: &Option<Arc<SharedJob>>, child: &tokio::process::Child) {
    if let (Some(job), Some(handle)) = (job.as_ref(), child.raw_handle()) {
        let _ = job.0.assign_process(handle as isize);
    }
}

// A non-Windows build (ADR-001 portable-core posture) supervises without the Win32
// Job Object — a later macOS/Linux tray swaps a process-group/cgroup behind the same
// neutral "reap the supervised tree" seam.
#[cfg(not(windows))]
type SharedJob = ();
#[cfg(not(windows))]
fn create_job() -> Option<Arc<SharedJob>> {
    None
}
#[cfg(not(windows))]
fn assign_to_job(_job: &Option<Arc<SharedJob>>, _child: &tokio::process::Child) {}

// ------------------------------------------------------------------------------------
// Jitter — a real, non-fixed jitter source for the restart backoff (ADR-002 d2).
// ------------------------------------------------------------------------------------

/// A small xorshift jitter source seeded from the wall clock — the RUN-TIME jitter the
/// pure `jittered_backoff_ms` seam consumes, so successive restart delays are never a
/// fixed value (the deterministic `FixedJitter` is the test seam; this is production).
struct SystemJitter {
    state: u64,
}

impl SystemJitter {
    fn new(seed: u64) -> Self {
        SystemJitter { state: seed | 1 }
    }
}

impl JitterSource for SystemJitter {
    fn next_unit(&mut self) -> f64 {
        // xorshift64 → a value in [0.0, 1.0).
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        ((x >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

fn seed_for(kind: ChildKind) -> u64 {
    let base = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15);
    base ^ if matches!(kind, ChildKind::Server) { 0xA5A5_A5A5 } else { 0x5A5A_5A5A }
}

// ------------------------------------------------------------------------------------
// The engine.
// ------------------------------------------------------------------------------------

/// Spawn the supervisor engine on its OWN dedicated multi-thread tokio runtime (a
/// background OS thread), returning the command channel the IPC layer drives it with.
/// A dedicated runtime keeps full control of the process + timer drivers `tokio::process`
/// needs, independent of Tauri's own event loop.
pub fn spawn_engine(app: AppHandle, install_dir: PathBuf, shared: SharedState) -> UnboundedSender<SupervisorCommand> {
    let (tx, rx) = unbounded_channel();
    std::thread::Builder::new()
        .name("mesh-supervisor".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("build the supervisor tokio runtime");
            rt.block_on(engine_main(app, install_dir, shared, rx));
        })
        .expect("spawn the supervisor thread");
    tx
}

async fn engine_main(
    app: AppHandle,
    install_dir: PathBuf,
    shared: SharedState,
    mut rx: UnboundedReceiver<SupervisorCommand>,
) {
    let job = create_job();

    // The role-driven set is COMPUTED by the core (ADR-002 d1): `mesh ui` runs on every
    // node (started immediately, per SPEC/RESEARCH §3); `mesh serve --serve` only on a
    // control node (started by the poll once `isControlNode` is confirmed).
    let ui = Arc::new(ChildController::new(SupervisedChild::mesh_ui()));
    let server = Arc::new(ChildController::new(SupervisedChild::mesh_serve()));
    ui.desired.store(true, Ordering::SeqCst);

    tokio::spawn(supervise_child(app.clone(), install_dir.clone(), job.clone(), ui.clone(), ChildKind::Ui, shared.clone()));
    tokio::spawn(supervise_child(app.clone(), install_dir.clone(), job.clone(), server.clone(), ChildKind::Server, shared.clone()));
    tokio::spawn(poll_loop(app.clone(), install_dir.clone(), shared.clone(), server.clone()));

    while let Some(cmd) = rx.recv().await {
        match cmd {
            SupervisorCommand::StartServer => {
                server.role_started.store(true, Ordering::SeqCst);
                server.set_desired(true);
            }
            SupervisorCommand::StopServer => {
                server.role_started.store(true, Ordering::SeqCst);
                server.set_desired(false);
            }
            SupervisorCommand::StartUi => ui.set_desired(true),
            SupervisorCommand::StopUi => ui.set_desired(false),
        }
    }
}

/// The single fleet-data poll (ADR-004 d1-2): re-issue `aof mesh status --json` once
/// per cadence tick, feeding `last_good_status` + `render_state` (keep-last-good on a
/// miss) and latching the control-node server start off the SAME poll's `isControlNode`.
async fn poll_loop(app: AppHandle, install_dir: PathBuf, shared: SharedState, server: Arc<ChildController>) {
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    loop {
        interval.tick().await;

        let resolved = resolve(&install_dir);
        let spawn = form_mesh_status_spawn(&resolved);
        let mut cmd = Command::new(&spawn.program);
        cmd.args(&spawn.args);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let parsed: Option<MeshStatus> = match cmd.output().await {
            Ok(out) if out.status.success() => parse_status(&String::from_utf8_lossy(&out.stdout)).ok(),
            _ => None,
        };

        // Read the role decision out of the SAME locked update — no second lock (one
        // poll feeds both the render state and the isControlNode role, ADR-004 d1-2).
        let is_control = {
            let mut g = shared.lock().unwrap();
            let prior = if g.ever_populated { PriorGoodFrame::Populated } else { PriorGoodFrame::None };
            match parsed {
                Some(status) => {
                    let n = status.nodes.len() as u32;
                    g.render_state = select_render_state(FetchOutcome::Ok { node_count: n }, prior);
                    if n > 0 {
                        g.ever_populated = true;
                    }
                    g.is_control_node = status.is_control_node();
                    g.last_good_status = Some(status);
                }
                None => {
                    g.render_state = select_render_state(FetchOutcome::Failed, prior);
                }
            }
            g.is_control_node
        };

        // Role latch (ADR-002 d1): once the poll confirms this is a control node, start
        // the server ONCE. After that only explicit Start/Stop touch it, so a manual
        // Stop is never overridden by the next poll.
        if is_control && !server.role_started.load(Ordering::SeqCst) {
            server.role_started.store(true, Ordering::SeqCst);
            server.set_desired(true);
        }

        refresh_tray(&app, &shared);
    }
}

/// One supervised child's watchdog loop (ADR-002 d2): keep it running while desired,
/// restart a genuine crash under jittered exponential backoff, and SURFACE — never
/// tight-loop — a named clean-exit-1. Every spawn is the resolved absolute `aof` path
/// assigned to the kill-on-close Job Object.
async fn supervise_child(
    app: AppHandle,
    install_dir: PathBuf,
    job: Option<Arc<SharedJob>>,
    ctl: Arc<ChildController>,
    kind: ChildKind,
    shared: SharedState,
) {
    let mut attempt: u32 = 0;
    let mut jitter = SystemJitter::new(seed_for(kind));

    loop {
        if !ctl.desired() {
            set_signal(&shared, kind, "stopped");
            refresh_tray(&app, &shared);
            // Park until Start flips desired true.
            while !ctl.desired() {
                ctl.notify.notified().await;
            }
            continue;
        }

        let resolved = resolve(&install_dir);
        let mut cmd = Command::new(&resolved.path);
        cmd.args(ctl.spec.argv.iter());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(_) => {
                // Could not spawn (aof not resolvable in a dev/unpackaged run) — back
                // off like a crash rather than a tight loop.
                attempt += 1;
                let backoff = jittered_backoff_ms(attempt, &mut jitter);
                set_signal(&shared, kind, "restarting");
                refresh_tray(&app, &shared);
                sleep_or_wake(&ctl, backoff).await;
                continue;
            }
        };
        assign_to_job(&job, &child);
        attempt = 0;
        set_signal(&shared, kind, "running");
        // A successful (re)start clears any surfaced clean-exit notice — the reason is
        // stale once the child is running again.
        shared.lock().unwrap().last_clean_exit = None;
        refresh_tray(&app, &shared);

        // Drain both pipes continuously (bounded tail) so a long-lived child never
        // deadlocks on a full pipe buffer, while still capturing the message a fast
        // exit-1 prints for classification.
        let out_handle = tokio::spawn(read_tail(child.stdout.take()));
        let err_handle = tokio::spawn(read_tail(child.stderr.take()));

        // Wait for the child to exit OR a Stop to be requested. A spurious wake (e.g.
        // Start while already running) re-enters the wait rather than abandoning the
        // running child — the reader handles are consumed exactly once, after the loop.
        let result = loop {
            tokio::select! {
                status = child.wait() => break WaitResult::Exited(status),
                _ = ctl.notify.notified() => {
                    if !ctl.desired() {
                        break WaitResult::Stop;
                    }
                }
            }
        };

        match result {
            WaitResult::Exited(status) => {
                let msg = format!(
                    "{}\n{}",
                    out_handle.await.unwrap_or_default(),
                    err_handle.await.unwrap_or_default()
                );
                handle_exit(
                    &shared,
                    &ctl,
                    kind,
                    status.map(|s| s.success()).unwrap_or(false),
                    &msg,
                    &mut attempt,
                );
                if matches!(get_signal(&shared, kind), "restarting") {
                    let backoff = jittered_backoff_ms(attempt, &mut jitter);
                    refresh_tray(&app, &shared);
                    sleep_or_wake(&ctl, backoff).await;
                }
            }
            WaitResult::Stop => {
                out_handle.abort();
                err_handle.abort();
                let _ = child.start_kill();
                let _ = child.wait().await;
                set_signal(&shared, kind, "stopped");
            }
        }
        refresh_tray(&app, &shared);
    }
}

/// Classify a child exit and update its signal (ADR-002 d2). A clean exit (code 0, or a
/// named clean-exit-1) STOPS it without a restart-storm; a genuine crash sets
/// "restarting" and bumps the attempt so the caller applies the jittered backoff.
fn handle_exit(
    shared: &SharedState,
    ctl: &ChildController,
    kind: ChildKind,
    success: bool,
    msg: &str,
    attempt: &mut u32,
) {
    if success {
        ctl.desired.store(false, Ordering::SeqCst);
        set_signal(shared, kind, "stopped");
        return;
    }
    match CleanExitReason::classify(msg) {
        Some(reason) => {
            // Named clean exit-1 — surface it, do NOT tight-loop-restart.
            ctl.desired.store(false, Ordering::SeqCst);
            shared.lock().unwrap().last_clean_exit =
                Some(format!("{}: {}", ctl.spec.label, reason.message()));
            set_signal(shared, kind, "stopped");
        }
        None => {
            // A genuine crash — mark restarting; the caller applies the backoff.
            *attempt += 1;
            set_signal(shared, kind, "restarting");
        }
    }
}

/// Sleep for `backoff_ms`, waking early if the child's desired-state changes (so a Stop
/// during a backoff window doesn't wait out the whole delay before parking).
async fn sleep_or_wake(ctl: &ChildController, backoff_ms: u64) {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(backoff_ms)) => {}
        _ = ctl.notify.notified() => {}
    }
}

/// Read a child pipe to EOF keeping only a bounded tail — drains continuously (no pipe
/// deadlock) and bounds memory for a long-lived child, while retaining the last lines a
/// fast exit-1 prints for `CleanExitReason::classify`.
async fn read_tail<R: tokio::io::AsyncRead + Unpin>(pipe: Option<R>) -> String {
    let mut tail = String::new();
    if let Some(mut r) = pipe {
        let mut chunk = [0u8; 1024];
        loop {
            match r.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    tail.push_str(&String::from_utf8_lossy(&chunk[..n]));
                    if tail.len() > 8192 {
                        let cut = tail.len() - 4096;
                        tail = tail.split_off(cut);
                    }
                }
            }
        }
    }
    tail
}

fn set_signal(shared: &SharedState, kind: ChildKind, sig: &'static str) {
    let mut g = shared.lock().unwrap();
    match kind {
        ChildKind::Server => g.server_signal = sig,
        ChildKind::Ui => g.ui_signal = sig,
    }
}

fn get_signal(shared: &SharedState, kind: ChildKind) -> &'static str {
    let g = shared.lock().unwrap();
    match kind {
        ChildKind::Server => g.server_signal,
        ChildKind::Ui => g.ui_signal,
    }
}

/// Rebuild the tray menu + icon from the current supervisor state, on the main thread
/// (the only thread that may touch the native tray on Windows). Called after every
/// state change (poll tick, child signal change) so the tray header/labels/icon reflect
/// reality, not a build-time snapshot.
pub fn refresh_tray(app: &AppHandle, shared: &SharedState) {
    let app = app.clone();
    let shared = shared.clone();
    let _ = app.clone().run_on_main_thread(move || {
        crate::rebuild_tray(&app, &shared);
    });
}
