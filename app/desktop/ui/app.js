/*
  Milestone 36 · Mesh Desktop App — node/work view renderer (DESIGN.md §Surface 1).

  READ-ONLY over the fleet (ADR-004 d3): this renders `aof mesh status --json` and offers NO
  assign/route/dispatch affordance. Two health vocabularies are kept strictly separate:
    · LOCAL_STATE  → the control-bar process pills (running/stopped/restarting) — the supervisor's
                     own state (story 00), NOT from mesh:status.
    · FLEET_STATUS → the body node dots (online/stale/offline) — the mesh:status heartbeat signal.

  THE RUST CORE VIEW-MODEL IS AUTHORITATIVE (ARCHITECTURE/DESIGN ADR-001 consequences): under Tauri, the
  supervisor polls `mesh status`, shapes the view-model in Rust (`mesh-desktop-core::view_model`/
  `render_state`), and hands it to this WebView over IPC (`get_view_model`) — this file does NOT re-derive
  the mapping from a raw payload when running under Tauri, it renders the ALREADY-SHAPED rows the Rust side
  computed. When running standalone in a plain browser (no Tauri host — the screenshot/`@uat` harness and the
  committed mocks), `window.__TAURI_INTERNALS__` is absent and this file falls back to the FLEET_STATUS/
  LOCAL_STATE fixtures below, running `mapStatusToView()` itself so the demo/screenshot mode and the
  `?state=`/`?theme=` params keep working unchanged. `mapStatusToView()` remains the pure fixture-mode
  view-model — story 02's `status-render-model` fallback path, coded against the CORRECTED shape
  ({ nodes, boards, isControlNode }; presence.activeRuns / presence.aofVersion nested; node.local; node.stale)
  — mirroring the Rust core's `view_model.rs`/`render_state.rs` so both paths agree on shape.
*/

// ---------- Tauri IPC detection (ADR-001: Rust core is authoritative under Tauri) ----------
function tauriInvoke() {
  // Tauri v2 always injects `window.__TAURI_INTERNALS__.invoke`, regardless of the
  // `withGlobalTauri` config flag (this app ships withGlobalTauri:false) — this is
  // the correct "are we hosted in the Tauri shell" detection point, not a `window.__TAURI__` check.
  return (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function')
    ? window.__TAURI_INTERNALS__.invoke
    : null;
}

// ---------- fixtures (replaced by real IPC data in the packaged app) ----------
const FLEET_STATUS = {
  isControlNode: true,
  boards: [],
  nodes: [
    { nodeId: 'umair-mbp',  local: true,  stale: false, role: 'control',
      presence: { activeRuns: [{ ref: '36/00', title: 'supervisor core' }], aofVersion: '1.9.3', heartbeatAt: '2026-07-09T17:00:00Z' } },
    { nodeId: 'worker-01',  local: false, stale: false, role: 'worker',
      presence: { activeRuns: [{ ref: '35/02', title: 'isolated worker execution' }], aofVersion: '1.9.3', heartbeatAt: '2026-07-09T17:00:00Z' } },
    { nodeId: 'worker-02',  local: false, stale: false, role: 'worker',
      presence: { activeRuns: [], aofVersion: '1.9.2', heartbeatAt: '2026-07-09T17:00:00Z' } },
    { nodeId: 'mac-studio', local: false, stale: true,  role: 'worker',
      presence: { activeRuns: [], aofVersion: '1.9.3', heartbeatAt: '2026-07-09T16:57:00Z' } },
  ],
};
const LOCAL_STATE = { meshServer: 'running', meshWebUi: 'running', aofVersion: '1.9.3' };

// ---------- pure view-model (story 02 · status-render-model) ----------
// STALE-FIRST PRECEDENCE (authoritative rule mirrored from the Rust core's
// `view_model::health_dot()` — app/desktop/crates/core/src/view_model.rs): `stale` is
// checked BEFORE the no-presence branch, so a `{stale:true, no-presence}` node still
// renders `stale` (muted grey — DESIGN), never `offline`. Both paths MUST agree.
function presenceOf(node) {
  if (node.stale === true) return 'stale';
  return node.presence ? 'online' : 'offline';          // no presence record ⇒ offline, never a crash
}
function currentWork(node) {
  const runs = node.presence && Array.isArray(node.presence.activeRuns) ? node.presence.activeRuns : [];
  if (runs.length === 0) return null;                    // no active runs ⇒ idle
  const r = runs[0];
  return typeof r === 'string' ? { ref: r, title: '' } : { ref: r.ref || r.itemRef || '', title: r.title || '' };
}
function aofVersionOf(node) {
  const v = node.presence && node.presence.aofVersion;
  return v ? (String(v).startsWith('v') ? String(v) : 'v' + v) : '';
}
function roleOf(node) { return node.role === 'control' ? 'control' : 'worker'; } // binds to the field story 00 freezes

function mapStatusToView(status) {
  const nodes = (status.nodes || []).map((n) => {
    const work = currentWork(n);
    return {
      name: n.nodeId,
      thisNode: n.local === true,
      role: roleOf(n),
      version: aofVersionOf(n),
      presence: presenceOf(n),
      running: !!work,
      workRef: work ? work.ref : '',
      workTitle: work ? work.title : '',
    };
  });
  return {
    isControlNode: status.isControlNode === true,
    nodes,
    count: nodes.length,
    online: nodes.filter((n) => n.presence === 'online').length,
    stale: nodes.filter((n) => n.presence === 'stale').length,
  };
}

// ---------- rendering ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function procControlHTML(label, state, primary, action) {
  const dotClass = state === 'running' ? 'running' : state === 'restarting' ? 'restarting' : 'stopped';
  const toggleCls = primary ? 'toggle primary' : 'toggle subtle';
  const glyph = state === 'running' ? '<span class="stop-glyph"></span>' : '<span class="play-glyph"></span>';
  const title = state === 'running' ? `Stop ${label.toLowerCase()}` : `Start ${label.toLowerCase()}`;
  // `data-action`/`data-running` let the Tauri host wire these to the LOCAL supervisor
  // IPC commands (start/stop the real child); the browser-fixture path ignores them.
  return `<div class="proc">
    <span class="proc-label">${esc(label)}</span>
    <span class="pill"><span class="pill-dot ${dotClass}"></span><span class="pill-text">${esc(state)}</span></span>
    <button class="${toggleCls}" data-action="${action}" data-running="${state === 'running'}" title="${esc(title)}" aria-label="${esc(title)}">${glyph}</button>
  </div>`;
}

function renderControlBar(view, local) {
  const parts = [];
  // A WORKER node omits the Mesh-server control entirely (DESIGN §Surface 2 / §States) — no server to run there.
  if (view.isControlNode) {
    parts.push(procControlHTML('Mesh server', local.meshServer, true, 'server'));
    parts.push('<span class="vsep"></span>');
  }
  parts.push(procControlHTML('Mesh web UI', local.meshWebUi, false, 'ui'));
  const webUiUp = local.meshWebUi === 'running';
  parts.push(`<button class="open-web-ui" data-action="open-web-ui"${webUiUp ? '' : ' disabled'} title="Open web UI in browser">
    <span class="arrow">&#8599;</span>Open web UI</button>`);
  parts.push(`<div class="identity">
    <span class="lead">this machine</span>
    <span class="role">${view.isControlNode ? 'control node' : 'worker node'}</span>
    <span class="ver">v${esc(local.aofVersion)}</span>
  </div>`);
  document.getElementById('controlbar').innerHTML = parts.join('');
}

function nodeRowHTML(n) {
  // `n.workLabel` (set only by the Tauri-IPC path, `normalizeIpcView` — F7/F8 fix):
  // the Rust core's already-formatted current-work TEXT is rendered VERBATIM as ONE
  // active label — `running N runs` and the NEW `working · <repo> (session)` state
  // both render here, identically styled (DESIGN "working is a PEER of running").
  // The demo/fixture path (`mapStatusToView`, no Tauri host) has no `workLabel` and
  // keeps its own unchanged ref/title rendering below (milestone 36 baseline).
  const work = typeof n.workLabel === 'string'
    ? (n.workLabel
        ? `<span class="work-dot"></span><span class="work-label">${esc(n.workLabel)}</span>`
        : `<span class="work-idle">idle</span>`)
    : (n.running
        ? `<span class="work-dot"></span><span class="work-ref">${esc(n.workRef)}</span><span class="work-title">${esc(n.workTitle)}</span>`
        : `<span class="work-idle">idle</span>`);
  const thisNode = n.thisNode ? '<span class="chip">this node</span>' : '';
  return `<div class="node-row">
    <span class="dot ${n.presence}"></span>
    <div class="node-id"><span class="node-name">${esc(n.name)}</span>${thisNode}</div>
    <span class="role-badge">${esc(n.role)}</span>
    <span class="node-ver">${esc(n.version)}</span>
    <div class="work">${work}</div>
  </div>`;
}

function renderBody(view, state) {
  const body = document.getElementById('body');

  if (state === 'empty') {
    body.innerHTML = `<div class="empty"><div class="empty-card">
      <div class="empty-logo"><i></i><i></i><i></i><i></i></div>
      <div class="empty-title">No machines on the mesh yet</div>
      <div class="empty-sub">Enrol a machine to bring it onto the mesh. Run one of these on the box you want to add.</div>
      <div class="empty-cmds">
        <div class="cmd"><code>aof mesh invite</code><span class="copy">&#10697;</span></div>
        <div class="cmd"><code>aof mesh join</code><span class="copy">&#10697;</span></div>
      </div>
    </div></div>`;
    return;
  }

  if (state === 'loading') {
    const rows = [0, 1, 2, 3].map(() => `<div class="skel-row">
      <span class="dot-sk"></span>
      <div class="sk" style="width:120px;height:12px"></div>
      <div class="sk dim" style="width:66px;height:12px"></div>
      <div class="sk dim" style="width:44px;height:12px"></div>
      <div class="sk dim" style="flex:1;height:12px;max-width:240px"></div>
    </div>`).join('');
    body.innerHTML = `<div class="skel-header">
      <div class="sk" style="width:44px;height:11px"></div>
      <div class="sk dim" style="width:150px;height:11px"></div>
    </div>${rows}`;
    return;
  }

  // populated / error — both show the (keep-last-good) list; error adds a calm banner + dims the list.
  const isError = state === 'error';
  const banner = isError ? `<div class="error-banner">
    <span class="glyph">&#9888;</span>
    <span class="msg">Couldn&rsquo;t reach the mesh &mdash; showing the last known fleet. Retrying every 5s.</span>
    <button class="retry">Retry</button>
  </div>` : '';
  const headerText = isError ? '&middot; last checked 2m ago'
    : `&middot; ${view.count} nodes &middot; ${view.online} online &middot; ${view.stale} stale`;
  const rows = view.nodes.map(nodeRowHTML).join('');
  body.innerHTML = `${banner}
    <div class="nodes-header"><span class="kicker">Nodes</span><span class="summary">${headerText}</span></div>
    <div class="node-list${isError ? ' degraded' : ''}">${rows}</div>`;
}

const FOOTERS = {
  populated: 'refreshed 3s ago',
  loading: 'checking mesh…',
  empty: 'no machines enrolled',
  error: 'reconnecting — retrying every 5s',
};

// Normalize the Rust-computed IPC view-model (`get_view_model`'s snake_case node
// rows) into the SAME shape `mapStatusToView()` produces, so `renderControlBar`/
// `renderBody`/`nodeRowHTML` stay ONE rendering code path regardless of source —
// the Rust core is authoritative for the DATA, this is display-shape plumbing only.
function normalizeIpcView(ipcModel) {
  const nodes = (ipcModel.nodes || []).map((n) => {
    // F7/F8 fix (aof:verify 38, BLOCKER): `work_state` is now one of THREE values —
    // 'idle' | 'running' | 'working' (milestone 38's session signal, view_model.rs
    // `CurrentWork::state_str()`) — 'working' is the NEW session-derived state this
    // desktop never rendered before. Both 'running' AND 'working' are ACTIVE
    // (DESIGN §Surface 1 "working reads as a PEER of running, not louder and not
    // quieter"); only 'idle' is muted. The Rust core ALREADY renders the exact label
    // text (`running N runs` / `working · <repo> (session)` / `idle`,
    // `CurrentWork::display()`) — this path hands it straight through VERBATIM,
    // never re-splitting it into a synthetic ref/title pair (that shape only ever
    // matched the retired activeRuns-as-objects assumption, F8's twin on this side).
    const active = n.work_state !== 'idle';
    return {
      name: n.name,
      thisNode: n.this_node === true,
      role: n.role,
      // The Rust core's `version_cell()` hands back the RAW version ("1.9.3") — this
      // path must prepend the `v` in the render the same way the fixture path's
      // `aofVersionOf()` does, so fixture AND Tauri-IPC both display "v1.9.3".
      version: n.version === '—' ? '' : (String(n.version).startsWith('v') ? n.version : 'v' + n.version),
      presence: n.health_dot,               // 'online' | 'stale' | 'offline' — same vocabulary as presenceOf()
      running: active,
      workLabel: active ? n.current_work : '',
    };
  });
  return {
    isControlNode: ipcModel.is_control_node === true,
    nodes,
    count: nodes.length,
    online: nodes.filter((n) => n.presence === 'online').length,
    stale: nodes.filter((n) => n.presence === 'stale').length,
  };
}

// ---------- Tauri host wiring (idempotent — attached once) ----------
// The window reflects the LIVE supervisor: re-fetch the Rust-authoritative view-model
// on the same cadence the poll refreshes it (the "refreshed 3s ago" footer idiom), so
// the fleet + local-process signals stay current without a second data path.
let _tauriPolling = false;
function startTauriPolling() {
  if (_tauriPolling) return;
  _tauriPolling = true;
  setInterval(() => { render(); }, 3000);
}

// Wire the control-bar buttons to the LOCAL-supervisor IPC commands (start/stop the
// real child on THIS machine; open the running web UI). Read-only over the fleet — no
// affordance here spawns a mesh-mutating verb (ADR-004 d3). Event-delegated + attached
// once, so re-renders don't stack listeners.
let _controlBarWired = false;
function wireControlBarActions(invoke) {
  if (_controlBarWired) return;
  _controlBarWired = true;
  const bar = document.getElementById('controlbar');
  if (!bar) return;
  bar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.getAttribute('data-action');
    const running = btn.getAttribute('data-running') === 'true';
    if (action === 'server') {
      invoke(running ? 'stop_mesh_server' : 'start_mesh_server');
    } else if (action === 'ui') {
      invoke(running ? 'stop_mesh_ui' : 'start_mesh_ui');
    } else if (action === 'open-web-ui') {
      invoke('open_web_ui');
    }
    // The next poll tick re-renders the true state the supervisor reports.
  });
}

// Wire the frameless titlebar's window controls to their narrow IPC commands (the
// frameless window has no native caption buttons — DESIGN §Surface 1 region 1). Close
// HIDES to tray (ambient residency), never a full exit; Quit (tray) is the only exit.
let _windowControlsWired = false;
function wireWindowControls(invoke) {
  if (_windowControlsWired) return;
  _windowControlsWired = true;
  const bind = (id, cmd) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { invoke(cmd); });
  };
  bind('wc-min', 'minimize_window');
  bind('wc-max', 'toggle_maximize_window');
  bind('wc-close', 'hide_to_tray');
}

async function render() {
  const params = new URLSearchParams(location.search);
  const requestedState = ['populated', 'empty', 'loading', 'error'].includes(params.get('state')) ? params.get('state') : null;
  const theme = params.get('theme') === 'dark' ? 'dark'
    : params.get('theme') === 'light' ? 'light'
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  const invoke = tauriInvoke();
  if (invoke) {
    // TAURI HOST: the Rust core view-model is authoritative — fetch it over IPC and
    // render it as-is (no fixture, no re-derivation). `?state=` is NOT honoured here
    // (there is no fixture to override): the render reflects the real supervisor.
    // Both ramps come from the SAME poll: `render_state`/`nodes` are FLEET presence;
    // `server_state`/`ui_state` are the LOCAL-process control-bar signals.
    // Mark the real host so the CSS drops the standalone-mock chrome (the fixed 760×520
    // card + the fake desktop backdrop) and fills the frameless OS window instead.
    document.documentElement.dataset.host = 'tauri';
    wireControlBarActions(invoke);
    wireWindowControls(invoke);
    startTauriPolling();
    try {
      const ipcModel = await invoke('get_view_model');
      const view = normalizeIpcView(ipcModel);
      const state = ['populated', 'empty', 'loading', 'error'].includes(ipcModel.render_state) ? ipcModel.render_state : 'populated';
      const thisNode = view.nodes.find((n) => n.thisNode);
      const local = {
        meshServer: ipcModel.server_state || 'stopped',
        meshWebUi: ipcModel.ui_state || 'stopped',
        aofVersion: thisNode && thisNode.version ? thisNode.version.replace(/^v/, '') : '',
      };
      renderControlBar(view, local);
      renderBody(view, state);
      // Surface a named clean-exit reason (ui-build-missing / EADDRINUSE / launcher
      // already running) in the footer when the supervisor reports one — the "surface
      // the message, don't restart-storm" half of ADR-002 d2 (cleared on a restart).
      document.getElementById('footer-text').textContent =
        ipcModel.notice || FOOTERS[state] || FOOTERS.populated;
    } catch (err) {
      // A failed IPC call renders the calm error state — never a stack trace on screen.
      renderBody(mapStatusToView(FLEET_STATUS), 'error');
      document.getElementById('footer-text').textContent = FOOTERS.error;
    }
    return;
  }

  // STANDALONE / BROWSER FALLBACK (no Tauri host): the fixtures + ?state=/?theme=
  // demo params drive the render unchanged — this is the screenshot/@uat harness and
  // the committed mocks' path, untouched by the IPC wiring above.
  const state = requestedState || 'populated';
  const view = mapStatusToView(FLEET_STATUS);
  renderControlBar(view, LOCAL_STATE);
  renderBody(view, state);
  document.getElementById('footer-text').textContent = FOOTERS[state] || FOOTERS.populated;
}

// Expose the pure view-model for reuse/testing (story 02's status-render-model unit).
window.MeshView = { mapStatusToView, presenceOf, currentWork, aofVersionOf, roleOf, normalizeIpcView, tauriInvoke };

render();
