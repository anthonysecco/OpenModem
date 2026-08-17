/* app.js — shared nav/shell for all pages. No framework, no build step. */
(function () {
  'use strict';

  var NAV = [
    { label: 'Dashboard', href: '/',            key: 'dashboard' },
    { label: 'Cellular',  href: '/cellular.html', key: 'cellular'  },
    { label: 'SIM',       href: '/sim.html',      key: 'sim'       },
    { label: 'WAN',       href: '/wan.html',      key: 'wan'       },
    { label: 'LAN',       href: '/lan.html',      key: 'lan'       },
    { label: 'System',    href: '/system.html',   key: 'system'    },
  ];

  /* Material-Design-style outline icons (24x24, stroke=currentColor).
     Hand-built with plain shapes rather than pasted-in Material Icons
     path data — a misremembered path string renders as visible garbage,
     a wrong rect/circle coordinate is at worst a slightly-off shape. */
  var ICONS = {
    dashboard:
      '<rect x="3" y="3" width="8" height="8" rx="1.5"/>' +
      '<rect x="13" y="3" width="8" height="8" rx="1.5"/>' +
      '<rect x="3" y="13" width="8" height="8" rx="1.5"/>' +
      '<rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    cellular:
      '<rect x="4" y="15" width="3" height="6" rx="0.5"/>' +
      '<rect x="10.5" y="10" width="3" height="11" rx="0.5"/>' +
      '<rect x="17" y="5" width="3" height="16" rx="0.5"/>',
    sim:
      '<path d="M8 3h10l2 2v16H6V5z"/>' +
      '<rect x="9" y="9" width="6" height="5" rx="1"/>',
    wan:
      '<circle cx="12" cy="12" r="9"/>' +
      '<ellipse cx="12" cy="12" rx="4" ry="9"/>' +
      '<line x1="3" y1="12" x2="21" y2="12"/>',
    lan:
      '<circle cx="12" cy="12" r="2"/>' +
      '<circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="12" cy="20" r="2"/>' +
      '<line x1="12" y1="12" x2="4" y2="5"/><line x1="12" y1="12" x2="20" y2="5"/><line x1="12" y1="12" x2="12" y2="20"/>',
    system:
      '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/>' +
      '<line x1="19" y1="12" x2="21.5" y2="12"/>' +
      '<line x1="16.95" y1="16.95" x2="18.72" y2="18.72"/>' +
      '<line x1="12" y1="19" x2="12" y2="21.5"/>' +
      '<line x1="7.05" y1="16.95" x2="5.28" y2="18.72"/>' +
      '<line x1="5" y1="12" x2="2.5" y2="12"/>' +
      '<line x1="7.05" y1="7.05" x2="5.28" y2="5.28"/>' +
      '<line x1="12" y1="5" x2="12" y2="2.5"/>' +
      '<line x1="16.95" y1="7.05" x2="18.72" y2="5.28"/>'
  };

  function iconSvg(key) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[key] || '') + '</svg>';
  }

  function buildNavLinks(activeKey) {
    return NAV.map(function (item) {
      var cls = item.key === activeKey ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + iconSvg(item.key) +
        '<span class="label">' + item.label + '</span></a>';
    }).join('');
  }

  /* Footer markup (connection status + "Updated Xs ago" + status dot)
     is identical on every page, so it's injected here alongside the
     nav links rather than hand-duplicated across 6 HTML files — same
     reasoning as buildNavLinks() itself. Each page just carries an
     empty <footer id="om-footer"> for this to fill. refreshState()/
     tickAge() then drive #om-conn-status/[data-field="_polled_at"]/
     #om-footer-dot exactly as before, just relocated from the topbar
     + a page-local <p class="om-updated"> into this one shared spot. */
  function initShell(activeKey) {
    var links = buildNavLinks(activeKey);

    var sidebar = document.getElementById('om-sidebar-nav');
    if (sidebar) sidebar.innerHTML = links;

    var tabbar = document.getElementById('om-tabbar-nav');
    if (tabbar) tabbar.innerHTML = links;

    var footer = document.getElementById('om-footer');
    if (footer) {
      footer.innerHTML = '<span class="om-ring-dot" id="om-footer-dot"></span>' +
        '<span id="om-conn-status">Loading…</span> - Updated ' +
        '<span data-field="_polled_at">—</span>';
    }
  }

  /* ── Signal quality thresholds (RSRP/RSRQ/SINR) ──────────────────────
     Single canonical source for what counts as excellent/good/fair/
     poor/critical signal, so every UI element that shows these — CA
     table columns, the Cellular page's ring dots, the Dashboard's
     Signal Strength showcase — colors against the exact same
     breakpoints instead of each defining its own. RSRP/SINR base
     thresholds/colors ported from QuecControl (3GPP TS 36.133/38.133
     for RSRP, TS 36.214/38.215 for SINR); RSRQ's are the standard
     3GPP RSRQ quality bands. sigPct clamps to [2,97] so a bar fill is
     always visible even at the extreme ends of the range.

     5th tier ("Critical", 2026-08-17): the original 4-tier "Poor"
     bucket for each metric was a wide catch-all (RSRP: everything
     below -100, a 40+ dB span down to the -140 floor) collapsing
     "degraded but usable" and "about to drop" into one identical
     color — the distinction that matters most for a vehicle roaming
     between urban and rural coverage. Added one more boundary per
     metric, continuing that metric's own existing step size one more
     increment (RSRP: -10 dB steps -> -110; RSRQ: -5 dB steps -> -25;
     SINR: ~5 dB step -> -5, matching SINR_MIN's existing -10 floor).

     Color scheme (also 2026-08-17): a genuine 5-step dark-green ->
     green -> yellow -> orange -> red gradient, replacing the earlier
     pass's green/green/amber/red/dark-red (which reused the site's
     flat green/amber/red status-dot palette plus its one spare dark-
     red token). This gradient is a deliberate LOCAL exception to that
     shared vocabulary, scoped to these three signal-quality arrays
     only — registration dots, the connection-status footer, etc. all
     keep the fixed green/amber/red/gray set from the status-indicator
     style guide, since a 5-step severity gradient reads naturally for
     a continuous physical measurement in a way it wouldn't for a
     handful of discrete states like "Registered"/"Denied". */
  var RSRP_MIN = -140, RSRP_MAX = -75;
  var SINR_MIN = -10, SINR_MAX = 30;
  var RSRP_ZONES = [
    { thresh: -80, bar: '#1e8a4e', label: 'Excellent' },
    { thresh: -90, bar: '#34c777', label: 'Good' },
    { thresh: -100, bar: '#f0c64c', label: 'Fair' },
    { thresh: -110, bar: '#e0873a', label: 'Poor' },
    { thresh: -999, bar: '#e0473e', label: 'Critical' }
  ];
  var SINR_ZONES = [
    { thresh: 20, bar: '#1e8a4e', label: 'Excellent' },
    { thresh: 13, bar: '#34c777', label: 'Good' },
    { thresh: 0, bar: '#f0c64c', label: 'Fair' },
    { thresh: -5, bar: '#e0873a', label: 'Poor' },
    { thresh: -999, bar: '#e0473e', label: 'Critical' }
  ];
  var RSRQ_ZONES = [
    { thresh: -10, bar: '#1e8a4e', label: 'Excellent' },
    { thresh: -15, bar: '#34c777', label: 'Good' },
    { thresh: -20, bar: '#f0c64c', label: 'Fair' },
    { thresh: -25, bar: '#e0873a', label: 'Poor' },
    { thresh: -999, bar: '#e0473e', label: 'Critical' }
  ];

  function sigZoneColor(val, zones) {
    for (var i = 0; i < zones.length; i++) {
      if (val >= zones[i].thresh) return zones[i].bar;
    }
    return zones[zones.length - 1].bar;
  }

  function sigZoneLabel(val, zones) {
    for (var i = 0; i < zones.length; i++) {
      if (val >= zones[i].thresh) return zones[i].label || '';
    }
    return zones[zones.length - 1].label || '';
  }

  // Index of the matching zone (0 = best tier, e.g. Excellent).
  function sigZoneIndex(val, zones) {
    for (var i = 0; i < zones.length; i++) {
      if (val >= zones[i].thresh) return i;
    }
    return zones.length - 1;
  }

  function sigPct(val, min, max) {
    return Math.max(2, Math.min(97, Math.round(((val - min) / (max - min)) * 100)));
  }

  /* Shared inline bar markup for any RSRP/SINR value — pass the right
     zone table/range/unit (RSRP_ZONES/RSRP_MIN/RSRP_MAX/'dBm' or
     SINR_ZONES/SINR_MIN/SINR_MAX/'dB') and it renders identically
     wherever it's used. */
  function sigBarCell(val, zones, min, max, unit) {
    if (typeof val !== 'number') return '—';
    var color = sigZoneColor(val, zones);
    var pct = sigPct(val, min, max);
    return '<div class="om-sigbar">' +
      '<div class="om-sigbar-track"><div class="om-sigbar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '<span class="om-sigbar-val" style="color:' + color + '">' + val + ' ' + unit + '</span>' +
      '</div>';
  }

  /* ── State binding ───────────────────────────────────────────────
     Any element with data-field="some_key" gets its textContent set to
     state[some_key], run through FORMATTERS[some_key] if one exists
     (default: raw value, or "—" for null/undefined/empty). No
     per-page render functions needed — pages just add data-field
     attributes to the markup they want populated.

     _polled_at is handled separately (see "Live updated-ago timer"
     below) so it can tick every second independent of how often the
     state actually refreshes, rather than only updating on fetch. */
  var REG_LABELS = {
    0: 'Not registered', 1: 'Registered', 2: 'Searching',
    3: 'Denied', 4: 'Unknown', 5: 'Roaming'
  };

  function fmtDbm(v) { return (v === null || v === undefined) ? null : v + ' dBm'; }
  function fmtReg(v) { return REG_LABELS[v] !== undefined ? REG_LABELS[v] : null; }
  function fmtBool(v) { return v === true ? 'Active' : v === false ? 'Inactive' : null; }
  function fmtBands(v) { return (typeof v === 'string' && v.length) ? v.split(':').join(', ') : v; }
  function fmtMhz(v) { return (typeof v === 'number') ? v + ' MHz' : null; }
  function fmtMbps(v) { return (typeof v === 'number') ? v + ' Mbps' : null; }
  function fmtDnsMode(v) {
    return v === 'local' ? 'Local (Modem DNS)' : v === 'carrier' ? 'Carrier (PDP Context)' : null;
  }
  function fmtBytes(v) {
    if (typeof v !== 'number') return null;
    if (v === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(v) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    return (v / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
  }
  function fmtSimSlot(v) { return v === 1 ? 'SIM1' : v === 2 ? 'SIM2' : null; }

  /* System (Application Processor) uptime — the poller supplies raw
     seconds from /proc/uptime (collect_uptime() in at_poller.sh, not
     an AT command at all); the years/months/weeks/days/hours/minutes
     breakdown happens here, same split as fmtBytes above. Leading
     zero units are skipped entirely (a freshly-booted device reads
     "12 minutes", not "0 years, 0 months, ..., 12 minutes"); units
     are the calendar-approximate kind uptime displays conventionally
     use (year=365d, month=30d), not calendar-exact, since an uptime
     counter has no real calendar anchor to be exact against anyway. */
  var UPTIME_UNITS = [
    { label: 'year', secs: 365 * 24 * 3600 },
    { label: 'month', secs: 30 * 24 * 3600 },
    { label: 'week', secs: 7 * 24 * 3600 },
    { label: 'day', secs: 24 * 3600 },
    { label: 'hour', secs: 3600 },
    { label: 'minute', secs: 60 }
  ];
  function fmtUptime(v) {
    if (typeof v !== 'number' || v < 0) return null;
    var remaining = Math.floor(v);
    var parts = [];
    UPTIME_UNITS.forEach(function (u) {
      var n = Math.floor(remaining / u.secs);
      remaining -= n * u.secs;
      if (n > 0) parts.push(n + ' ' + u.label + (n === 1 ? '' : 's'));
    });
    return parts.length ? parts.join(', ') : 'Less than a minute';
  }
  /* Standard industry nominal band frequency (e.g. "B13" = "700 MHz
     band"), NOT the precise DL-low-edge math LTE_BAND_TABLE/nrArfcnToMhz
     use further below for the CA bandwidth bar (band 13's real DL edge
     is 746MHz; its nominal name is still "700") — these two tables
     serve different purposes and are deliberately kept separate.
     Covers the same band universes as LTE_BANDS/NR_BANDS (Band Lock's
     own checkbox lists), dual-block bands (e.g. AWS) shown as
     "low/high" rather than picking one arbitrarily. */
  var LTE_BAND_NOMINAL_MHZ = {
    1: '2100', 2: '1900', 3: '1800', 4: '1700/2100', 5: '850', 7: '2600', 8: '900',
    12: '700', 13: '700', 14: '700', 17: '700', 18: '800', 19: '800', 20: '800',
    25: '1900', 26: '850', 28: '700', 29: '700', 30: '2300', 32: '1500', 34: '2000',
    38: '2600', 39: '1900', 40: '2300', 41: '2500', 42: '3500', 43: '3700',
    46: '5200', 48: '3500', 65: '2100', 66: '1700/2100', 71: '600'
  };
  var NR_BAND_NOMINAL_MHZ = {
    1: '2100', 2: '1900', 3: '1800', 5: '850', 7: '2600', 8: '900',
    12: '700', 13: '700', 14: '700', 18: '800', 20: '800', 25: '1900', 26: '850',
    28: '700', 29: '700', 30: '2300', 38: '2600', 40: '2300', 41: '2500', 48: '3500',
    66: '1700/2100', 70: '1700/2100', 71: '600', 75: '1500', 76: '1500',
    77: '3700', 78: '3500', 79: '4700'
  };

  function fmtLteBandNum(v) {
    if (typeof v !== 'string' || !v) return null;
    var mhz = LTE_BAND_NOMINAL_MHZ[Number(v)];
    return 'B' + v + (mhz ? ' (' + mhz + ')' : '');
  }
  function fmtNrBandNum(v) {
    if (typeof v !== 'string' || !v) return null;
    var mhz = NR_BAND_NOMINAL_MHZ[Number(v)];
    return 'n' + v + (mhz ? ' (' + mhz + ')' : '');
  }
  function fmtNrType(v) {
    return v === 'NR5G-SA' ? 'Standalone (SA)' : v === 'NR5G-NSA' ? 'Non-Standalone (NSA)' : null;
  }

  var FORMATTERS = {
    reg_lte: fmtReg, reg_nr: fmtReg, reg_creg: fmtReg,
    signal_lte_rsrp: fmtDbm, signal_lte_rsrq: fmtDbm, signal_lte_sinr: fmtDbm,
    signal_nr_rsrp: fmtDbm, signal_nr_rsrq: fmtDbm, signal_nr_sinr: fmtDbm,
    cell_lte_band: fmtLteBandNum, cell_nr_band: fmtNrBandNum, cell_nr_type: fmtNrType,
    wan_active: fmtBool,
    ca_total_bw_mhz: fmtMhz,
    ca_dl_estimated_mbps: fmtMbps, ca_dl_maximum_mbps: fmtMbps,
    band_pref_lte: fmtBands, band_pref_nr5g: fmtBands,
    lan_dns_mode: fmtDnsMode,
    wan_data_rx: fmtBytes, wan_data_tx: fmtBytes,
    sim_active_slot: fmtSimSlot,
    device_uptime_s: fmtUptime
  };

  function renderState(state) {
    var nodes = document.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = node.getAttribute('data-field');
      if (key === '_polled_at') continue; // handled by the live ticker
      var raw = state[key];
      var fmt = FORMATTERS[key];
      var out = fmt ? fmt(raw) : raw;
      node.textContent = (out === null || out === undefined || out === '') ? '—' : out;
    }
  }

  /* ── LTE/5G NR Band & State tooltips (Cellular page) ─────────────────
     EARFCN/PCID/Cell ID/TAC used to be their own rows; folded into the
     Band value's title attribute instead (native tooltip, same pattern
     already used for the CA table's carrier-name badges) to keep the
     card short while still making the detail available on hover/tap.
     State's title explains what each QENG servingcell state actually
     means, since "NOCONN"/"LIMSRV" aren't self-explanatory. This can't
     go through the generic renderState()/FORMATTERS path since that
     only ever sets textContent, never an element attribute. */
  var CELL_STATE_TOOLTIPS = {
    SEARCH: 'Searching for a cell to camp on',
    LIMSRV: 'Limited service — camped on a cell but not fully registered (e.g. emergency calls only)',
    NOCONN: 'Registered and idle — camped on this cell with no active data connection',
    CONNECT: 'RRC connected — actively transferring data'
  };

  function renderCellTooltips(state) {
    var lteBandEl = document.querySelector('[data-field="cell_lte_band"]');
    if (!lteBandEl) return; // not on this page

    lteBandEl.title = 'EARFCN ' + (state.cell_lte_earfcn || '—') +
      ' · PCID ' + (state.cell_lte_pcid || '—') +
      ' · Cell ID ' + (state.cell_lte_id || '—') +
      ' · TAC ' + (state.cell_lte_tac || '—');

    var nrBandEl = document.querySelector('[data-field="cell_nr_band"]');
    if (nrBandEl) {
      nrBandEl.title = 'ARFCN ' + (state.cell_nr_arfcn || '—') +
        ' · PCID ' + (state.cell_nr_pcid || '—') +
        ' · Cell ID ' + (state.cell_nr_id || '—') +
        ' · TAC ' + (state.cell_nr_tac || '—');
    }

    var lteStateEl = document.querySelector('[data-field="cell_lte_state"]');
    if (lteStateEl) lteStateEl.title = CELL_STATE_TOOLTIPS[state.cell_lte_state] || '';

    var nrStateEl = document.querySelector('[data-field="cell_nr_state"]');
    if (nrStateEl) nrStateEl.title = CELL_STATE_TOOLTIPS[state.cell_nr_state] || '';
  }

  /* ── Registration/RSRP/RSRQ/SINR ring status dots (Cellular page) ────
     Pattern 3 (Ring/Halo Dot) from the status-indicator style guide,
     next to Registration and each signal metric's value. Static, no
     animation — unlike the pulsing-dot pass this replaced, there's no
     "offline" CSS modifier class here: an absent reading is just
     another color (gray) taking the exact same code path as any real
     zone/registration color, set straight onto the element rather than
     toggled via a class.

     Signal dot colors come from this site's own existing zone
     thresholds (RSRP_ZONES/RSRQ_ZONES/SINR_ZONES, the same ones
     sigBarCell() draws the CA table's bars from). Registration's colors
     are a deliberate choice within the guide's fixed green/amber/red/
     gray vocabulary (confirmed with the user before implementing):
     green=Registered (home, fully normal), amber=Searching or Roaming
     (still connected/working but an exception state worth a glance —
     roaming specifically isn't full home service and can carry cost),
     red=Denied, gray=Not registered/Unknown. */
  var REG_DOT_COLORS = {
    0: '#5c5c5e', // Not registered -> gray
    1: '#34c777', // Registered -> green
    2: '#e0a63e', // Searching -> amber
    3: '#e05a4e', // Denied -> red
    4: '#5c5c5e', // Unknown -> gray
    5: '#e0a63e'  // Roaming -> amber
  };

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* Re-triggers the CSS ring-flash animation (see .om-ring-dot.om-dot-
     flash in style.css) even though the class may already be present
     from the last poll cycle — simply re-adding an already-present
     class doesn't restart a finished CSS animation, so this removes it,
     forces a reflow (reading offsetWidth flushes pending style changes,
     which is what actually makes the browser treat the next class add
     as a fresh animation start rather than a no-op), then re-adds it. */
  function flashRingDot(el) {
    el.classList.remove('om-dot-flash');
    void el.offsetWidth;
    el.classList.add('om-dot-flash');
  }

  function setRingDotColor(el, color, flash) {
    el.style.color = color;
    el.style.boxShadow = '0 0 0 3px ' + hexToRgba(color, 0.25);
    if (flash) flashRingDot(el);
  }

  /* Signal dots flash on refresh (a live-changing measurement, worth a
     "this just updated" cue); Registration's dot stays a plain static
     halo per feedback — it changes rarely, so flashing it every poll
     cycle would either be a near-constant blink (if it kept animating
     regardless of an actual change) or a confusing one-off spike users
     would read as something being wrong. */
  function applyRingDot(field, zones, state) {
    var el = document.querySelector('[data-ring="' + field + '"]');
    if (!el) return;
    var val = state[field];
    setRingDotColor(el, typeof val === 'number' ? sigZoneColor(val, zones) : '#5c5c5e', true);
  }

  function applyRegRingDot(field, state) {
    var el = document.querySelector('[data-ring="' + field + '"]');
    if (!el) return;
    setRingDotColor(el, REG_DOT_COLORS[state[field]] || '#5c5c5e', false);
  }

  function renderStatusDots(state) {
    if (!document.querySelector('[data-ring="signal_lte_rsrp"]')) return; // not on this page
    applyRegRingDot('reg_lte', state);
    applyRegRingDot('reg_nr', state);
    applyRingDot('signal_lte_rsrp', RSRP_ZONES, state);
    applyRingDot('signal_lte_rsrq', RSRQ_ZONES, state);
    applyRingDot('signal_lte_sinr', SINR_ZONES, state);
    applyRingDot('signal_nr_rsrp', RSRP_ZONES, state);
    applyRingDot('signal_nr_rsrq', RSRQ_ZONES, state);
    applyRingDot('signal_nr_sinr', SINR_ZONES, state);
  }

  /* ── Polling: fetches fast, renders only on genuine new data ─────────
     state.sh just cats the poller's already-written JSON file — no AT
     command involved — so fetching it faster than POLL_INTERVAL doesn't
     touch the AT broker/poller pipeline at all and is cheap. Earlier
     design rescheduled each fetch exactly POLL_INTERVAL after the last
     one; since that gives the fetch loop and the poller's write loop
     the same period, the two free-running timers phase-lock at
     whatever arbitrary offset existed when the page loaded (confirmed
     live: different tabs settled at different fixed "Xs ago" floors,
     e.g. 6s vs 8s, neither near 0, and neither ever changing). Fetching
     well inside one poll cycle instead bounds how stale a "genuinely
     new" detection can be to roughly FAST_POLL_MS, regardless of
     backend cadence or any client/server clock relationship — this
     doesn't rely on clock sync at all, only on comparing this
     response's _polled_at to the last one seen. Renders (and the
     ticker reset below) are gated on that comparison so redundant
     fetches that land inside the same still-unwritten cycle don't
     re-render identical data or reset the ticker early. */
  var FAST_POLL_MS = 1000;
  var refreshTimer = null;
  var lastSeenPolledAt = null;

  function scheduleRefresh(delayMs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshState, delayMs);
  }

  function refreshState() {
    fetch('/cgi-bin/state.sh')
      .then(function (r) { return r.json(); })
      .then(function (state) {
        var statusEl = document.getElementById('om-conn-status');
        if (statusEl) {
          statusEl.textContent = state._error ? state._message : 'Connected';
          statusEl.classList.toggle('bad', !!state._error);
        }
        var dotEl = document.getElementById('om-footer-dot');
        if (dotEl) setRingDotColor(dotEl, state._error ? '#e05a4e' : '#34c777', false);
        if (!state._error && state._polled_at !== lastSeenPolledAt) {
          lastSeenPolledAt = state._polled_at;
          renderState(state);
          renderSimSlots(state);
          renderCarrierAggregation(state);
          renderNetPrefs(state);
          renderNetworkType(state);
          renderSignalCard(state);
          renderTopbarSignal(state);
          renderCellTooltips(state);
          renderStatusDots(state);
          markRefreshedNow();
        }
        scheduleRefresh(FAST_POLL_MS);
      })
      .catch(function () {
        var statusEl = document.getElementById('om-conn-status');
        if (statusEl) {
          statusEl.textContent = 'Unreachable';
          statusEl.classList.add('bad');
        }
        var dotEl = document.getElementById('om-footer-dot');
        if (dotEl) setRingDotColor(dotEl, '#e05a4e', false);
        scheduleRefresh(FAST_POLL_MS);
      });
  }

  /* ── Live "updated Xs ago" timer ────────────────────────────────────
     Anchored to this browser's own clock at the moment new data was
     detected (not the poller's _polled_at, a server timestamp for a
     cycle that started up to _poll_duration_s before its data was
     actually written) — set once per genuine refresh by refreshState()
     above via markRefreshedNow(), so the display reliably resets to
     "just now" right when new data lands and then counts up on its own
     independent 1s tick, rather than only changing when a fetch
     happens to land. */
  var lastRefreshedAt = null;

  function markRefreshedNow() { lastRefreshedAt = Date.now() / 1000; }

  function tickAge() {
    var nodes = document.querySelectorAll('[data-field="_polled_at"]');
    if (!nodes.length) return;
    var text = '—';
    if (lastRefreshedAt) {
      var secs = Math.max(0, Math.round(Date.now() / 1000 - lastRefreshedAt));
      text = secs < 90 ? secs + 's ago' : Math.round(secs / 60) + 'm ago';
    }
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }

  /* ── Update (System page) ──────────────────────────────────────────
     Confirms with the user, then kicks off installer.sh via
     cgi-bin/update.sh and polls its status until the reinstalled httpd
     comes back up (or the poll simply starts failing while services
     restart, which is expected and not treated as a hard error). */
  var UPDATE_POLL_MS = 5000;
  var updatePollTimer = null;

  function setUpdateStatus(text) {
    var el = document.getElementById('om-update-status');
    if (el) el.textContent = text;
  }

  function pollUpdateStatus() {
    fetch('/cgi-bin/update.sh?action=status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.running) {
          setUpdateStatus('Updating… this can take a few minutes.');
        } else {
          clearInterval(updatePollTimer);
          updatePollTimer = null;
          setUpdateStatus('Update finished. Reloading…');
          setTimeout(function () { window.location.reload(); }, 1500);
        }
      })
      .catch(function () {
        // Expected while services restart and httpd is briefly down.
        setUpdateStatus('Updating… (server restarting)');
      });
  }

  function startUpdate() {
    var warned = window.confirm(
      'This downloads and installs the latest OpenModem from GitHub, ' +
      'replacing the current install. It can take several minutes and ' +
      'will restart all services — you may briefly lose connection to ' +
      'this page. Continue?'
    );
    if (!warned) return;

    setUpdateStatus('Starting update…');
    fetch('/cgi-bin/update.sh?action=start&confirm=1')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          setUpdateStatus('Could not start update: ' + data.error);
          return;
        }
        setUpdateStatus('Update started…');
        updatePollTimer = setInterval(pollUpdateStatus, UPDATE_POLL_MS);
      })
      .catch(function (err) {
        setUpdateStatus('Could not start update: ' + err);
      });
  }

  function initUpdateButton() {
    var btn = document.getElementById('om-update-btn');
    if (btn) btn.addEventListener('click', startUpdate);
  }

  /* ── AT Terminal (System page) ───────────────────────────────────
     Styled after QuecControl's system.html terminal: mac-window chrome,
     colored output lines, preset command chips, command history via
     arrow keys. One deliberate difference: QuecControl force-uppercases
     the entire command before sending it, which would mangle a
     case-sensitive quoted parameter (e.g. AT+QNWPREFCFG="lte_band" —
     that "lte_band" string must stay lowercase). This only uppercases
     what's needed to recognize the AT prefix, and prepends "AT" if the
     user typed just the suffix — it doesn't touch the rest of the
     command. */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function termAppendHtml(html) {
    var log = document.getElementById('om-term-log');
    if (!log) return;
    var div = document.createElement('div');
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function termTimestamp() {
    return '<span class="om-t-muted">[' + new Date().toLocaleTimeString() + ']</span> ';
  }

  function termAppendPrompt(cmd) {
    termAppendHtml(termTimestamp() + '<span class="om-t-prompt">&gt; ' + escapeHtml(cmd) + '</span>');
  }

  function termAppendResponse(text) {
    var lines = text.trim().split(/\r\n|\r|\n/);
    lines.forEach(function (line) {
      if (!line) return;
      var cls = 'om-t-info';
      if (line.trim() === 'OK') cls = 'om-t-ok';
      else if (/ERROR/.test(line)) cls = 'om-t-error';
      termAppendHtml('<span class="' + cls + '">' + escapeHtml(line) + '</span>');
    });
  }

  function sendAtCommand(cmd) {
    if (!cmd) return Promise.resolve();
    termAppendPrompt(cmd);
    return fetch('/cgi-bin/at_cmd.sh?cmd=' + encodeURIComponent(cmd))
      .then(function (r) { return r.text(); })
      .then(function (text) {
        termAppendResponse(text);
        return text;
      })
      .catch(function (err) {
        termAppendHtml('<span class="om-t-error">Error: ' + escapeHtml(String(err)) + '</span>');
      });
  }

  var TERM_PRESETS = [
    'ATI', 'AT+QGMR', 'AT+GSN', 'AT+QTEMP', 'AT+CSQ', 'AT+QRSRP', 'AT+QRSRQ',
    'AT+QSINR', 'AT+CEREG?', 'AT+C5GREG?', 'AT+CFUN?', 'AT+COPS?', 'AT+QSPN'
  ];

  function buildTermPresets() {
    var row = document.getElementById('om-term-presets');
    var input = document.getElementById('om-term-input');
    if (!row || !input) return;
    TERM_PRESETS.forEach(function (cmd) {
      var chip = document.createElement('span');
      chip.className = 'om-term-preset';
      chip.textContent = cmd;
      chip.addEventListener('click', function () {
        input.value = cmd;
        input.focus();
      });
      row.appendChild(chip);
    });
  }

  var termHistory = [];
  var termHistIdx = -1;

  function initAtTerminal() {
    var input = document.getElementById('om-term-input');
    var btn = document.getElementById('om-term-send');
    var clearBtn = document.getElementById('om-term-clear');
    var exportBtn = document.getElementById('om-term-export');
    if (!input || !btn) return;

    buildTermPresets();

    var submit = function () {
      var raw = input.value.trim();
      if (!raw) return;
      var cmd = /^AT/i.test(raw) ? raw : 'AT' + raw;
      input.value = '';
      termHistIdx = -1;
      termHistory.push(cmd);
      if (termHistory.length > 50) termHistory.shift();
      sendAtCommand(cmd);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { submit(); return; }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (termHistIdx < termHistory.length - 1) {
          termHistIdx++;
          input.value = termHistory[termHistory.length - 1 - termHistIdx] || '';
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (termHistIdx > 0) {
          termHistIdx--;
          input.value = termHistory[termHistory.length - 1 - termHistIdx] || '';
        } else {
          termHistIdx = -1;
          input.value = '';
        }
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        document.getElementById('om-term-log').innerHTML = '';
      });
    }
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var text = document.getElementById('om-term-log').innerText;
        var blob = new Blob([text], { type: 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'openmodem_at_log_' + Date.now() + '.txt';
        a.click();
      });
    }
  }

  /* ── Power actions (System page) ───────────────────────────────────
     Fixed commands, each behind its own confirm() — same pattern as
     Update. Reboot gets a longer, more explicit warning since the
     connection genuinely drops for a while afterward. */
  var POWER_ACTIONS = {
    reboot: {
      cmd: 'AT+CFUN=1,1',
      confirm: 'This reboots the modem (AT+CFUN=1,1). The connection will drop for about 30 seconds. Continue?'
    },
    radio_off: {
      cmd: 'AT+CFUN=0',
      confirm: 'This turns the radio off (AT+CFUN=0). The modem stays powered but loses all cellular connectivity until turned back on. Continue?'
    },
    radio_on: {
      cmd: 'AT+CFUN=1',
      confirm: 'This restores full radio function (AT+CFUN=1). Continue?'
    }
  };

  function initPowerButtons() {
    var buttons = document.querySelectorAll('[data-power-action]');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        var action = POWER_ACTIONS[btn.getAttribute('data-power-action')];
        if (!action) return;
        btn.addEventListener('click', function () {
          if (!window.confirm(action.confirm)) return;
          btn.disabled = true;
          sendAtCommand(action.cmd).finally(function () { btn.disabled = false; });
        });
      })(buttons[i]);
    }
  }

  /* ── Shared "Apply changes" bar (settings pages) ────────────────────
     One settings-apply button per page, shown only while something
     differs from the last-loaded/last-applied baseline, rather than a
     button per card. This module only owns show/hide + the click
     binding; each page tracks its own baseline(s) and owns the
     confirm()/fetch/status-text logic, since "what changed" and "how to
     apply it" differ per page. LAN binds it straight from
     initLanConfig(). Cellular is the one page with two independent
     settings sections (Band Lock, Network Mode/Roaming) sharing it, so
     it routes through its own combined checkCellularDirty()/
     cellularApply()/initCellularApplyBar() instead of binding either
     section's logic directly — see that trio's header comment. Only one
     of initLanConfig()/initCellularApplyBar() ever finds its elements
     on a given page, so binding #om-apply-btn from both is safe. */
  function applyBarToggle(dirty) {
    var bar = document.getElementById('om-apply-bar');
    if (bar) bar.style.display = dirty ? '' : 'none';
  }

  function bindApplyButton(handler) {
    var btn = document.getElementById('om-apply-btn');
    if (btn) btn.addEventListener('click', handler);
  }

  /* ── Band lock (Cellular page) ─────────────────────────────────────
     One checkbox per band, matching QuecControl's bandlock.html rather
     than a free-text comma list. Band universes are the modem's own
     reported capability (captured live from AT+QNWPREFCFG when nothing
     is locked, i.e. every band it's willing to list is enabled) rather
     than a hardcoded reference list.

     Checkbox state is initialized once on page load from
     band_lock.sh?action=get — deliberately NOT re-synced on every
     state.sh poll tick (that runs every POLL_INTERVAL, ~10s by default),
     which would silently discard whatever the user is mid-edit on. */
  var LTE_BANDS = [1, 2, 3, 4, 5, 7, 8, 12, 13, 14, 17, 18, 19, 20, 25, 26, 28, 29, 30, 32, 34, 38, 39, 40, 41, 42, 43, 46, 48, 66, 71];
  var NR_BANDS = [1, 2, 3, 5, 7, 8, 12, 13, 14, 18, 20, 25, 26, 28, 29, 30, 38, 40, 41, 48, 66, 70, 71, 75, 76, 77, 78, 79];

  function renderBandGrid(containerId, bands, labelPrefix) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = bands.map(function (b) {
      return '<label class="om-band-item"><input type="checkbox" value="' + b + '"> ' +
        labelPrefix + b + '</label>';
    }).join('');
  }

  function setBandGridChecked(containerId, selected) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var checkboxes = container.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
      checkboxes[i].checked = selected.indexOf(Number(checkboxes[i].value)) !== -1;
    }
  }

  function setBandGridAll(containerId, checked) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var checkboxes = container.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) checkboxes[i].checked = checked;
  }

  function getBandGridSelected(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return [];
    var checked = container.querySelectorAll('input[type="checkbox"]:checked');
    var out = [];
    for (var i = 0; i < checked.length; i++) out.push(checked[i].value);
    return out;
  }

  var bandLockBaseline = null;

  function bandLockSnapshot() {
    return { lte: getBandGridSelected('om-bandlock-lte-grid'), nr: getBandGridSelected('om-bandlock-nr-grid') };
  }

  function loadCurrentBandLock() {
    fetch('/cgi-bin/band_lock.sh?action=get')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        // null means the modem reported a hex bitmask (= "all bands");
        // treat that the same as everything being selected.
        setBandGridChecked('om-bandlock-lte-grid', data.lte_bands || LTE_BANDS);
        setBandGridChecked('om-bandlock-nr-grid', data.nr_bands || NR_BANDS);
        bandLockBaseline = bandLockSnapshot();
        checkCellularDirty();
      })
      .catch(function () { /* leave grids at their default (unchecked) state */ });
  }

  /* ── Collapsible card sections ────────────────────────────────────────
     Generic toggle: clicking the header expands/collapses the body,
     collapsed by default (matches QuecControl's Band Management
     section). Content underneath still loads/populates eagerly
     regardless of collapsed state — this only ever toggles visibility,
     there's no lazy-load gate. */
  function initCollapsible(toggleId, bodyId) {
    var toggle = document.getElementById(toggleId);
    var body = document.getElementById(bodyId);
    if (!toggle || !body) return;
    toggle.addEventListener('click', function () {
      var open = body.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function initBandLock() {
    var grid = document.getElementById('om-bandlock-lte-grid');
    if (!grid) return;

    initCollapsible('om-bandlock-toggle', 'om-bandlock-body');
    renderBandGrid('om-bandlock-lte-grid', LTE_BANDS, 'B');
    renderBandGrid('om-bandlock-nr-grid', NR_BANDS, 'n');
    grid.addEventListener('change', checkCellularDirty);
    document.getElementById('om-bandlock-nr-grid').addEventListener('change', checkCellularDirty);
    loadCurrentBandLock();

    var lteAll = document.getElementById('om-bandlock-lte-all');
    var lteNone = document.getElementById('om-bandlock-lte-none');
    var nrAll = document.getElementById('om-bandlock-nr-all');
    var nrNone = document.getElementById('om-bandlock-nr-none');
    if (lteAll) lteAll.addEventListener('click', function () { setBandGridAll('om-bandlock-lte-grid', true); checkCellularDirty(); });
    if (lteNone) lteNone.addEventListener('click', function () { setBandGridAll('om-bandlock-lte-grid', false); checkCellularDirty(); });
    if (nrAll) nrAll.addEventListener('click', function () { setBandGridAll('om-bandlock-nr-grid', true); checkCellularDirty(); });
    if (nrNone) nrNone.addEventListener('click', function () { setBandGridAll('om-bandlock-nr-grid', false); checkCellularDirty(); });
  }

  /* ── Generic modal overlay ───────────────────────────────────────────
     One overlay element per page (see #om-scan-modal in cellular.html);
     app.js only ever toggles its .open class and swaps its body's
     innerHTML between phases, rather than mounting/unmounting DOM. */
  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  /* ── Carrier scan (Cellular page) ──────────────────────────────────
     "Carrier Scan" is a row whose value is a gold link that opens a
     modal, matching QuecControl's own info-row "View Available
     Networks" treatment (see cellular.html) — rather than a card
     button + inline results, since a real scan takes up to ~2 minutes
     and briefly interrupts data service while the modem searches, so
     the modal walks through confirm -> scanning -> results as three
     phases of the same dialog instead of a window.confirm() gate in
     front of an always-visible card. Results table styling (4-column
     Operator/PLMN/Status/Tech, dedupe-by-PLMN+AcT, sort-by-name,
     Current colored amber not green) also matches QuecControl's
     carrierscan.html for the same reason. */
  var STATUS_LABELS = { 0: 'Unknown', 1: 'Available', 2: 'Current', 3: 'Forbidden' };
  var SCAN_STATUS_CLASS = { 1: 'om-scan-status-available', 2: 'om-scan-status-current', 3: 'om-scan-status-forbidden' };

  // 3GPP TS 27.007 Table — AcT value -> compact label, same table
  // QuecControl's carrierscan.html uses.
  var SCAN_ACT_LABELS = {
    0: 'GSM', 1: 'GSM Compact', 2: 'UTRAN', 3: 'GSM/EGPRS',
    4: 'UTRAN W/HSDPA', 5: 'UTRAN W/HSUPA', 6: 'UTRAN W/HSDPA+HSUPA',
    7: 'E-UTRAN (LTE)', 8: 'EC-GSM-IoT', 9: 'E-UTRAN NB-S1',
    10: 'E-UTRAN NB-S1 w/ NB-IoT', 11: 'NR (5G)', 12: 'E-UTRAN+NR (5G NSA)'
  };

  function scanActLabel(v) {
    var n = parseInt(v, 10);
    return SCAN_ACT_LABELS[n] !== undefined ? SCAN_ACT_LABELS[n] : 'Unknown (' + v + ')';
  }

  function scanStatusHtml(v) {
    var n = parseInt(v, 10);
    var cls = SCAN_STATUS_CLASS[n];
    var label = STATUS_LABELS[n] || String(v);
    return cls ? '<span class="' + cls + '">' + label + '</span>' : escapeHtml(label);
  }

  // Current (2) first, then Available (1), then Forbidden (3), then
  // anything else — same priority QuecControl sorts/dedupes by.
  function scanStatusSortOrder(v) {
    switch (parseInt(v, 10)) {
      case 2: return 0;
      case 1: return 1;
      case 3: return 2;
      default: return 3;
    }
  }

  function scanConfirmHtml() {
    return '<p>Scanning for carriers (AT+COPS=?) searches all available ' +
      'networks and will disrupt data connectivity for up to 2 minutes ' +
      'while the modem searches. Continue?</p>' +
      '<div class="om-modal-actions">' +
      '<button type="button" class="om-secondary" data-scan-action="cancel">Cancel</button>' +
      '<button type="button" data-scan-action="start">Scan for Carriers</button>' +
      '</div>';
  }

  function scanCloseHtml() {
    return '<div class="om-modal-actions">' +
      '<button type="button" class="om-secondary" data-scan-action="close">Close</button>' +
      '</div>';
  }

  function scanResultsHtml(operators) {
    if (!operators || !operators.length) {
      return '<p class="om-note">No operators found.</p>';
    }

    // Dedupe by PLMN+AcT, keeping whichever entry has the best status —
    // the modem can report the same network more than once per scan.
    var seen = {};
    operators.forEach(function (op) {
      var key = (op.plmn || '') + ':' + (op.act || '');
      if (!seen[key] || scanStatusSortOrder(op.status) < scanStatusSortOrder(seen[key].status)) {
        seen[key] = op;
      }
    });
    var deduped = Object.keys(seen).map(function (k) { return seen[k]; });

    deduped.sort(function (a, b) {
      var nameA = (a.name || '').toLowerCase();
      var nameB = (b.name || '').toLowerCase();
      if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      return scanStatusSortOrder(a.status) - scanStatusSortOrder(b.status);
    });

    var rows = deduped.map(function (op) {
      return '<tr><td>' + escapeHtml(op.name || '—') + '</td>' +
        '<td>' + escapeHtml(op.plmn || '—') + '</td>' +
        '<td>' + scanStatusHtml(op.status) + '</td>' +
        '<td>' + escapeHtml(scanActLabel(op.act)) + '</td></tr>';
    }).join('');

    return '<div class="om-table-wrap"><table class="om-table">' +
      '<thead><tr><th>Operator</th><th>PLMN</th><th>Status</th><th>Tech</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function runCarrierScan() {
    var body = document.getElementById('om-scan-modal-body');
    body.innerHTML = '<div class="om-scan-progress"><span class="om-spinner"></span>' +
      '<span>Scanning for networks… this can take up to 2 minutes.</span></div>';

    fetch('/cgi-bin/carrier_scan.sh')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          body.innerHTML = '<p class="om-note">Scan failed: ' + escapeHtml(data.error) + '</p>' + scanCloseHtml();
          return;
        }
        body.innerHTML = scanResultsHtml(data.operators) + scanCloseHtml();
      })
      .catch(function (err) {
        body.innerHTML = '<p class="om-note">Scan failed: ' + escapeHtml(String(err)) + '</p>' + scanCloseHtml();
      });
  }

  function initCarrierScan() {
    var btn = document.getElementById('om-scan-btn');
    var modal = document.getElementById('om-scan-modal');
    var body = document.getElementById('om-scan-modal-body');
    if (!btn || !modal || !body) return;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      body.innerHTML = scanConfirmHtml();
      openModal('om-scan-modal');
    });

    // Delegated: the body's actual buttons get replaced wholesale on
    // every phase transition, so one listener bound at init (matched by
    // data-scan-action) covers cancel/start/close across all of them.
    body.addEventListener('click', function (e) {
      var action = e.target.getAttribute && e.target.getAttribute('data-scan-action');
      if (action === 'start') runCarrierScan();
      else if (action === 'cancel' || action === 'close') closeModal('om-scan-modal');
    });

    var closeBtn = document.getElementById('om-scan-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeModal('om-scan-modal'); });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal('om-scan-modal');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal('om-scan-modal');
    });
  }

  /* ── Network Mode / Data Roaming (Cellular page) ─────────────────────
     Selects, routed through the shared Apply bar alongside Band Lock
     (see checkCellularDirty()/cellularApply() below) rather than
     applying per-selection — same reasoning as Band Lock/LAN: the
     current value loads once from the first state.sh poll that
     actually carries it (these fields are already polled every cycle,
     so no separate GET endpoint is needed) and is then left alone —
     a background poll resyncing the select mid-edit would silently
     discard whatever the user just picked. */
  var netPrefsBaseline = null;

  function netPrefsSnapshot() {
    var modeEl = document.getElementById('om-netmode-select');
    var roamEl = document.getElementById('om-roaming-select');
    return {
      mode: modeEl ? modeEl.value : 'AUTO',
      roaming: roamEl ? roamEl.value : '0'
    };
  }

  function renderNetPrefs(state) {
    var modeEl = document.getElementById('om-netmode-select');
    if (!modeEl || netPrefsBaseline) return; // not on this page, or already loaded
    if (state.net_mode_pref === null || state.net_mode_pref === undefined) return; // wait for real data

    modeEl.value = state.net_mode_pref;
    document.getElementById('om-roaming-select').value = state.net_data_roaming === true ? '1' : '0';
    netPrefsBaseline = netPrefsSnapshot();
    checkCellularDirty();
  }

  /* ── Network Type (Cellular page) ────────────────────────────────────
     "LTE" / "5G NSA" / "5G SA" — there's no single poller field for
     this since the LTE/5G NR split (cell_lte_active/cell_nr_active/
     cell_nr_type), so it's derived here rather than through the
     generic FORMATTERS path (which only ever transforms one field's
     own value, not several combined). NR takes priority when active:
     NSA still carries an LTE anchor underneath it (cell_lte_active is
     also true in that case), but "5G NSA" is the more meaningful thing
     to show the user than "LTE". */
  // "LTE" / "5G NSA" / "5G SA" — no single poller field carries this
  // since the LTE/5G NR split (cell_lte_active/cell_nr_active/
  // cell_nr_type), so it's derived here. NR takes priority when
  // active: NSA still carries an LTE anchor underneath it
  // (cell_lte_active is also true in that case), but "5G NSA" is the
  // more meaningful thing to show than "LTE". Shared by the Cellular
  // page's Network card and the topbar signal indicator below, rather
  // than each recomputing it.
  function networkTypeText(state) {
    if (state.cell_nr_active) {
      return state.cell_nr_type === 'NR5G-SA' ? '5G SA' : state.cell_nr_type === 'NR5G-NSA' ? '5G NSA' : '5G';
    }
    if (state.cell_lte_active) return 'LTE';
    return '—';
  }

  function renderNetworkType(state) {
    var el = document.getElementById('om-network-type');
    if (!el) return; // not on this page
    el.textContent = networkTypeText(state);
  }

  /* ── Signal Strength (Dashboard) ─────────────────────────────────────
     Final pick after comparing five styles: phone-style bars + a
     colored tier word underneath, no dBm sub-caption. Driven by the
     currently active RAT's RSRP (NR takes priority when active, same
     logic as networkTypeText() above) through the site's own
     RSRP_ZONES/sigZoneColor/sigZoneLabel/sigZoneIndex — unchanged
     thresholds, this is presentation only. */
  function currentRsrp(state) {
    if (state.cell_nr_active && typeof state.signal_nr_rsrp === 'number') return state.signal_nr_rsrp;
    return state.signal_lte_rsrp;
  }

  // One height per RSRP_ZONES entry — keep this array's length in sync
  // if that ever gains/loses a tier. Shared by the Dashboard card and
  // the (smaller-scale) topbar indicator, which passes its own height
  // set instead.
  var SIG_BAR_HEIGHTS = [8, 14, 20, 26, 32];

  function sigBarsHtml(val, has, color, heights, barClass) {
    var litBars = has ? (RSRP_ZONES.length - sigZoneIndex(val, RSRP_ZONES)) : 0;
    return heights.map(function (h, i) {
      return '<div class="' + barClass + '" style="height:' + h + 'px;background:' + (i < litBars ? color : 'var(--border)') + '"></div>';
    }).join('');
  }

  function renderSignalCard(state) {
    var barsEl = document.getElementById('om-sig-combo-bars');
    var wordEl = document.getElementById('om-sig-combo-word');
    if (!barsEl) return; // not on this page

    var val = currentRsrp(state);
    var has = typeof val === 'number';
    var color = has ? sigZoneColor(val, RSRP_ZONES) : '#5c5c5e';
    var label = has ? sigZoneLabel(val, RSRP_ZONES) : 'No Signal';

    barsEl.innerHTML = sigBarsHtml(val, has, color, SIG_BAR_HEIGHTS, 'om-sig-bar');
    if (wordEl) wordEl.innerHTML = '<div class="om-sig-word-label" style="color:' + color + '">' + label + '</div>';
  }

  /* ── Topbar signal indicator (every page) ────────────────────────────
     Bars + carrier + network type, always visible regardless of which
     page you're on — same reasoning as moving connection status into
     the shared footer: this is global state, not page-specific.
     Smaller bar heights than the Dashboard card (topbar is ~56px
     tall), same tier-boundary logic via sigBarsHtml(). */
  var TOPBAR_SIG_BAR_HEIGHTS = [5, 8, 11, 14, 17];

  function renderTopbarSignal(state) {
    var el = document.getElementById('om-topbar-signal');
    if (!el) return; // shouldn't happen, every page carries this

    var val = currentRsrp(state);
    var has = typeof val === 'number';
    var color = has ? sigZoneColor(val, RSRP_ZONES) : '#5c5c5e';
    var barsHtml = sigBarsHtml(val, has, color, TOPBAR_SIG_BAR_HEIGHTS, 'om-topbar-sigbar');

    el.innerHTML = '<span class="om-topbar-sigbars">' + barsHtml + '</span>' +
      '<span class="om-topbar-signal-text">' + escapeHtml(state.carrier_name || '—') + ' · ' + escapeHtml(networkTypeText(state)) + '</span>';
  }

  function initNetPrefs() {
    var modeEl = document.getElementById('om-netmode-select');
    var roamEl = document.getElementById('om-roaming-select');
    if (!modeEl || !roamEl) return; // not on this page
    modeEl.addEventListener('change', checkCellularDirty);
    roamEl.addEventListener('change', checkCellularDirty);
  }

  /* ── Cellular's shared Apply bar (Band Lock + Network Mode/Roaming) ──
     Both sections live on this one page and now both route through the
     single #om-apply-bar/#om-apply-btn, so unlike every other page's
     apply flow (exactly one settings section, see bindApplyButton's own
     header comment) this page needs one combined dirty check and one
     combined apply — mirrors LAN's own multi-field lanApply() (mode/
     DNS/IP each independently dirty-checked, only the changed ones
     fire) generalized across two independent sections instead of three
     fields in one. */
  function checkCellularDirty() {
    var bandDirty = !!bandLockBaseline && JSON.stringify(bandLockSnapshot()) !== JSON.stringify(bandLockBaseline);
    var netDirty = !!netPrefsBaseline && JSON.stringify(netPrefsSnapshot()) !== JSON.stringify(netPrefsBaseline);
    applyBarToggle(bandDirty || netDirty);
  }

  function cellularApply() {
    var statusEl = document.getElementById('om-apply-status');
    var btn = document.getElementById('om-apply-btn');

    var bandDirty = !!bandLockBaseline && JSON.stringify(bandLockSnapshot()) !== JSON.stringify(bandLockBaseline);
    var net = netPrefsBaseline ? netPrefsSnapshot() : null;
    var modeDirty = !!net && net.mode !== netPrefsBaseline.mode;
    var roamDirty = !!net && net.roaming !== netPrefsBaseline.roaming;
    if (!bandDirty && !modeDirty && !roamDirty) return;

    var lte = getBandGridSelected('om-bandlock-lte-grid');
    var nr = getBandGridSelected('om-bandlock-nr-grid');
    if (bandDirty && !lte.length && !nr.length) {
      statusEl.textContent = 'Select at least one band.';
      return;
    }

    var disruptive = [];
    if (bandDirty) disruptive.push('the band lock');
    if (modeDirty || roamDirty) disruptive.push('network mode/roaming');
    if (!window.confirm('Apply changes to ' + disruptive.join(' and ') + '? The connection may briefly reconnect. Continue?')) return;

    btn.disabled = true;
    statusEl.textContent = 'Applying…';

    var steps = [];
    if (bandDirty) {
      var qs = [];
      if (lte.length) qs.push('lte_bands=' + encodeURIComponent(lte.join(',')));
      if (nr.length) qs.push('nr_bands=' + encodeURIComponent(nr.join(',')));
      steps.push({ label: 'Band lock', url: '/cgi-bin/band_lock.sh?action=set&' + qs.join('&') });
    }
    if (modeDirty) {
      steps.push({ label: 'Network mode', url: '/cgi-bin/network_action.sh?action=set_mode&mode=' + encodeURIComponent(net.mode) });
    }
    if (roamDirty) {
      steps.push({ label: 'Data roaming', url: '/cgi-bin/network_action.sh?action=set_roaming&value=' + net.roaming });
    }

    // Sequential, not parallel — same reasoning as LAN's lanApply(): the
    // AT broker only serializes one in-flight request at a time anyway,
    // and a mode/band change can briefly interrupt the next request.
    var results = [];
    var chain = Promise.resolve();
    steps.forEach(function (step) {
      chain = chain.then(function () {
        return fetch(step.url)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            results.push(step.label + ': ' + (data.success ? 'OK' : 'Failed — ' + data.error));
          })
          .catch(function (err) {
            results.push(step.label + ': Failed — ' + err);
          });
      });
    });

    chain.then(function () {
      statusEl.textContent = results.join('  ');
      btn.disabled = false;
      if (bandDirty) bandLockBaseline = bandLockSnapshot();
      if (net) netPrefsBaseline = net;
      checkCellularDirty();
    });
  }

  function initCellularApplyBar() {
    if (!document.getElementById('om-bandlock-lte-grid') && !document.getElementById('om-netmode-select')) return; // not on this page
    bindApplyButton(cellularApply);
  }

  /* ── Carrier center-frequency calculation (Cellular page) ────────────
     Ported from QuecControl's LTE_BAND_TABLE / nrArfcnToMhz so the CA
     bandwidth bar can label segments with the carrier's actual DL
     frequency range, not just a proportional color block. LTE: exact
     per-band DL-low/step/EARFCN-offset (3GPP TS 36.101 Table 5.7.3-1).
     NR: exact piecewise-linear ARFCN formula (3GPP TS 38.104 Table
     5.4.2.1-1) — no lookup table needed.

     Each LTE_BAND_TABLE entry's 4th/5th elements (UL-DL center offset,
     FDD flag) and NR_FDD_BANDS/NR_UL_OFFSET below position a UL
     segment alongside each carrier's DL one, also ported from
     QuecControl — but unlike QuecControl, that UL segment is only
     drawn when at_poller.sh actually reports real ul_bw_mhz for that
     carrier (from AT+QENG="servingcell" for the PCC, AT+QCAINFO's own
     UL fields for each SCC — confirmed live: some SCCs have no uplink
     grant configured at all in a 3+ carrier session), and its width is
     that real value, not assumed equal to the DL bandwidth. The offset
     table only supplies *position* (there is no real per-carrier UL
     EARFCN available for the PCC to compute an exact one from), so a
     carrier can show a real, correctly-sized UL segment at an
     approximate (duplex-formula) frequency position. */
  var LTE_BAND_TABLE = {
    //         DLlowMHz step earfcnOff ulOffsetMHz isFdd
    1:  [2110, 0.1,    0,  -190, true],
    2:  [1930, 0.1,  600,   -80, true],
    3:  [1805, 0.1, 1200,   -95, true],
    4:  [2110, 0.1, 1950,  -400, true],
    5:  [ 869, 0.1, 2400,   -45, true],
    7:  [2620, 0.1, 2750,  -120, true],
    8:  [ 925, 0.1, 3450,   -45, true],
    12: [ 729, 0.1, 5010,   -30, true],
    13: [ 746, 0.1, 5180,    31, true],
    14: [ 758, 0.1, 5280,    31, true],
    17: [ 734, 0.1, 5730,   -30, true],
    18: [ 860, 0.1, 5850,   -45, true],
    19: [ 875, 0.1, 6000,   -45, true],
    20: [ 791, 0.1, 6150,    41, true],
    25: [1930, 0.1, 8040,   -80, true],
    26: [ 859, 0.1, 8690,   -45, true],
    28: [ 758, 0.1, 9210,   -55, true],
    29: [ 717, 0.1, 9660,     0, false],
    30: [2350, 0.1, 9770,   -45, true],
    38: [2570, 0.1,36000,     0, false],
    39: [1880, 0.1,36200,     0, false],
    40: [2300, 0.1,36350,     0, false],
    41: [2496, 0.1,36950,     0, false],
    42: [3400, 0.1,37550,     0, false],
    43: [3600, 0.1,37750,     0, false],
    46: [5150, 0.1,46790,     0, false],
    48: [3550, 0.1,55240,     0, false],
    65: [2110, 0.1,65536,  -190, true],
    66: [2110, 0.1,66436,  -400, true],
    71: [ 617, 0.1,68586,   -46, true]
  };

  var NR_FDD_BANDS = [1,2,3,5,7,8,12,13,14,18,20,25,26,28,30,65,66,70,71,74];
  var NR_UL_OFFSET = {
    1:-190, 2:-80, 3:-95, 5:-45, 7:-120, 8:-45, 12:-30, 13:31,
    14:31, 18:-45, 20:41, 25:-80, 26:-45, 28:-55, 66:-400, 71:-46
  };

  function nrArfcnToMhz(arfcn) {
    var a = parseInt(arfcn, 10);
    if (isNaN(a)) return null;
    if (a <= 600000) return 0.005 * a;
    if (a <= 2016666) return 3000 + 0.015 * (a - 600000);
    return 24250.08 + 0.060 * (a - 2016667);
  }

  function bandNumberFromLabel(band) {
    var m = /(\d+)\s*$/.exec(band || '');
    return m ? parseInt(m[1], 10) : null;
  }

  function fmtCarrierBand(band) {
    if (!band) return '—';
    var num = bandNumberFromLabel(band);
    if (num === null) return band;
    return /NR5G/i.test(band) ? ('NR5G n' + num) : ('LTE B' + num);
  }

  function carrierCenterFreqMhz(c) {
    var earfcn = parseInt(c.earfcn, 10);
    if (/NR5G/i.test(c.band || '')) {
      return (!isNaN(earfcn) && earfcn > 0) ? nrArfcnToMhz(earfcn) : null;
    }
    var bandNum = bandNumberFromLabel(c.band);
    var bt = bandNum !== null ? LTE_BAND_TABLE[bandNum] : null;
    if (!bt) return null;
    return (!isNaN(earfcn) && earfcn > 0) ? (bt[0] + (earfcn - bt[2]) * bt[1]) : bt[0];
  }

  /* UL segment *position* only (duplex-offset formula — see
     LTE_BAND_TABLE's header comment on why this is approximate rather
     than measured); the bar's actual UL segment *width* uses
     ca_bands[].ul_bw_mhz, at_poller.sh's real polled value, not
     anything derived here. Returns null for TDD bands (DL==UL, no
     separate segment needed) or any band/earfcn this table cannot
     resolve. */
  function carrierUlCenterFreqMhz(c) {
    var dlCenter = carrierCenterFreqMhz(c);
    if (dlCenter === null) return null;
    var bandNum = bandNumberFromLabel(c.band);
    if (bandNum === null) return null;
    if (/NR5G/i.test(c.band || '')) {
      if (NR_FDD_BANDS.indexOf(bandNum) < 0 || NR_UL_OFFSET[bandNum] === undefined) return null;
      return dlCenter + NR_UL_OFFSET[bandNum];
    }
    var bt = LTE_BAND_TABLE[bandNum];
    if (!bt || !bt[4]) return null;
    return dlCenter + bt[3];
  }

  /* ── Carrier Aggregation (Cellular page) ─────────────────────────────
     ca_bands carries the richer per-carrier shape at_poller.sh's
     collect_carrier_aggregation/compute_ca_throughput now writes:
     bw_mhz and dl_estimated_mbps/dl_maximum_mbps are computed
     server-side, so this is purely rendering — no throughput math here.
     Carrier color is assigned by array position (PCC first, then each
     SCC in modem-reported order) and reused for the bar segment, its
     frequency label, and the table row's type badge.

     The bandwidth bar is sorted left-to-right by ascending center
     frequency (matching QuecControl), but the table below stays in the
     modem's own reported order (PCC first, then each SCC) — same split
     QuecControl itself uses. */
  var CA_SEG_CLASSES = ['om-ca-seg-0', 'om-ca-seg-1', 'om-ca-seg-2', 'om-ca-seg-3'];

  /* Table always shows at least this many rows, padded with empty
     placeholder rows when fewer carriers are active — keeps the card's
     height (and everything below it on the page) from jumping around
     as carrier aggregation adds/drops component carriers between polls.
     More rows are added freely above this floor; it's a minimum, not a
     cap. */
  var MIN_CA_ROWS = 5;
  var CA_EMPTY_ROW = '<tr class="om-ca-row-empty"><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>';

  function padCaRows(rows) {
    var out = rows.slice();
    while (out.length < MIN_CA_ROWS) out.push(CA_EMPTY_ROW);
    return out;
  }

  function fmtBwCell(bwMhz) {
    return bwMhz ? bwMhz + ' MHz' : '—';
  }

  /* mimo_layers is at_poller.sh's real per-carrier reading from
     AT+QNWCFG="lte_mimo_info"/"nr5g_mimo_info" (null when polling that
     carrier failed — see compute_ca_throughput's header comment), shown
     as "NxN" since the field reports active DL spatial layers and this
     hardware's live behavior (confirmed by chaining a real download
     during testing) is symmetric — 0/1/2/4 layers observed, rendered as
     0x0/1x1/2x2/4x4. Its own column now, previously folded into BW's
     cell text. */
  function fmtMimoCell(mimoLayers) {
    return (typeof mimoLayers === 'number' && mimoLayers >= 0) ? mimoLayers + 'x' + mimoLayers : '—';
  }

  function renderCarrierAggregation(state) {
    var bar = document.getElementById('om-ca-bwbar');
    var freqRow = document.getElementById('om-ca-bwbar-freq');
    var tbody = document.getElementById('om-ca-tbody');
    if (!bar || !freqRow || !tbody) return; // not on this page

    var carriers = state.ca_bands;
    if (!Array.isArray(carriers) || !carriers.length) {
      bar.innerHTML = '<div class="om-ca-bwbar-empty"></div>';
      freqRow.innerHTML = '';
      tbody.innerHTML = padCaRows(['<tr><td colspan="5" class="om-note">No carrier aggregation active.</td></tr>']).join('');
      return;
    }

    var withFreq = carriers.map(function (c, i) {
      var bw = typeof c.bw_mhz === 'number' ? c.bw_mhz : 0;
      var center = carrierCenterFreqMhz(c);
      return {
        c: c, i: i, bw: bw,
        low: center !== null ? Math.round(center - bw / 2) : null,
        high: center !== null ? Math.round(center + bw / 2) : null,
        center: center
      };
    });

    // Each carrier contributes a DL segment always, plus a UL segment
    // only when at_poller.sh reported real ul_bw_mhz for it (PCC from
    // QENG, SCC from QCAINFO's own UL fields — null there means that
    // carrier genuinely has no uplink grant right now, not missing
    // data, so no UL segment is the correct rendering, not a fallback).
    var segments = [];
    withFreq.forEach(function (s) {
      var cls = CA_SEG_CLASSES[s.i % CA_SEG_CLASSES.length];
      segments.push({
        cls: cls, isUl: false, bw: s.bw, low: s.low, high: s.high,
        sortKey: s.center === null ? Infinity : s.center
      });

      var ulBw = typeof s.c.ul_bw_mhz === 'number' ? s.c.ul_bw_mhz : 0;
      var ulCenter = ulBw > 0 ? carrierUlCenterFreqMhz(s.c) : null;
      if (ulBw > 0 && ulCenter !== null) {
        segments.push({
          cls: cls, isUl: true, bw: ulBw,
          low: Math.round(ulCenter - ulBw / 2), high: Math.round(ulCenter + ulBw / 2),
          sortKey: ulCenter
        });
      }
    });
    segments.sort(function (a, b) { return a.sortKey - b.sortKey; });

    var totalVisualBw = segments.reduce(function (sum, seg) { return sum + seg.bw; }, 0);

    function segWidthPct(seg) {
      return totalVisualBw > 0 ? Math.max((seg.bw / totalVisualBw) * 100, 2) : 100 / segments.length;
    }

    bar.innerHTML = segments.map(function (seg) {
      var ulCls = seg.isUl ? ' om-ca-seg-ul' : '';
      var title = (seg.isUl ? 'UL' : 'DL') + ' ' + seg.bw + ' MHz' +
        (seg.low !== null ? ' (' + seg.low + '–' + seg.high + ' MHz)' : '');
      return '<div class="om-ca-seg ' + seg.cls + ulCls + '" style="width:' + segWidthPct(seg).toFixed(1) + '%" title="' + escapeHtml(title) + '"></div>';
    }).join('');

    freqRow.innerHTML = segments.map(function (seg) {
      var label = (seg.low !== null && seg.high !== null) ? (seg.low + '–' + seg.high) : '—';
      return '<div class="om-ca-bwbar-freq-seg" style="width:' + segWidthPct(seg).toFixed(1) + '%">' + (seg.isUl ? 'UL ' : 'DL ') + label + '</div>';
    }).join('');

    var caRows = withFreq.map(function (s, idx) {
      var c = s.c;
      var cls = CA_SEG_CLASSES[s.i % CA_SEG_CLASSES.length];
      var nameCls = 'om-ca-name-' + (s.i % CA_SEG_CLASSES.length);
      var idTitle = (c.type || '') + ' · EARFCN ' + (c.earfcn || '—') + ' · PCI ' + (c.pci || '—');
      // A small top-border divider whenever type changes from the row
      // above (PCC -> SCC in the modem's normal reported order, but
      // driven by the actual data rather than assuming exactly one
      // leading PCC row) groups the carriers without needing the
      // PCC/SCC text label this replaced.
      var groupCls = (idx > 0 && withFreq[idx - 1].c.type !== c.type) ? ' om-ca-row-group-start' : '';
      return '<tr class="' + groupCls.trim() + '">' +
        '<td><span class="om-ca-carrier-name ' + nameCls + '" title="' + escapeHtml(idTitle) + '">' + escapeHtml(fmtCarrierBand(c.band)) + '</span></td>' +
        '<td>' + fmtBwCell(s.bw) + '</td>' +
        '<td>' + fmtMimoCell(c.mimo_layers) + '</td>' +
        '<td>' + sigBarCell(c.rsrp, RSRP_ZONES, RSRP_MIN, RSRP_MAX, 'dBm') + '</td>' +
        '<td>' + sigBarCell(c.sinr, SINR_ZONES, SINR_MIN, SINR_MAX, 'dB') + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = padCaRows(caRows).join('');
  }

  /* ── LAN config (LAN page) ──────────────────────────────────────────
     Form inputs (router IP, DHCP range, mode, DNS) are populated once
     from state.sh on page load and never re-synced by the poll ticker —
     same reasoning as Band Lock: a background refresh mid-edit would
     silently discard whatever the user is typing. */
  function setToggleActive(groupId, attr, value) {
    var group = document.getElementById(groupId);
    if (!group) return;
    var buttons = group.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute(attr) === value);
    }
  }

  function getToggleActive(groupId, attr) {
    var group = document.getElementById(groupId);
    if (!group) return null;
    var active = group.querySelector('button.active');
    return active ? active.getAttribute(attr) : null;
  }

  function initToggleGroup(groupId, attr, onChange) {
    var group = document.getElementById(groupId);
    if (!group) return;
    var buttons = group.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          setToggleActive(groupId, attr, btn.getAttribute(attr));
          if (onChange) onChange(btn.getAttribute(attr));
        });
      })(buttons[i]);
    }
  }

  var IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
  function isValidIPv4(v) {
    if (!IPV4_RE.test(v)) return false;
    return v.split('.').every(function (o) { return Number(o) <= 255; });
  }

  function toggleMacRow() {
    var mode = getToggleActive('om-lan-mode-toggle', 'data-mode');
    var row = document.getElementById('om-lan-mac-row');
    if (row) row.style.display = mode === 'passthrough' ? '' : 'none';
  }

  // In IP Passthrough the DHCP pool/gateway config this card edits is
  // moot — the LAN client gets the raw WAN IP directly, not a lease from
  // this pool — so hide the card rather than leave a control that does
  // nothing visible.
  function toggleIpCard() {
    var mode = getToggleActive('om-lan-mode-toggle', 'data-mode');
    var card = document.getElementById('om-lan-ip-card');
    if (card) card.style.display = mode === 'passthrough' ? 'none' : '';
  }

  var lanBaseline = null;

  function lanSnapshot() {
    var mac = document.getElementById('om-lan-mac');
    var routerIp = document.getElementById('om-lan-router-ip');
    var dhcpStart = document.getElementById('om-lan-dhcp-start');
    var dhcpEnd = document.getElementById('om-lan-dhcp-end');
    return {
      mode: getToggleActive('om-lan-mode-toggle', 'data-mode') || 'nat',
      mac: mac ? mac.value.trim() : '',
      routerIp: routerIp ? routerIp.value.trim() : '',
      dhcpStart: dhcpStart ? dhcpStart.value.trim() : '',
      dhcpEnd: dhcpEnd ? dhcpEnd.value.trim() : '',
      dns: getToggleActive('om-lan-dns-toggle', 'data-dns') || 'carrier'
    };
  }

  function checkLanDirty() {
    if (!lanBaseline) return;
    applyBarToggle(JSON.stringify(lanSnapshot()) !== JSON.stringify(lanBaseline));
  }

  function loadLanConfig() {
    fetch('/cgi-bin/state.sh')
      .then(function (r) { return r.json(); })
      .then(function (state) {
        var routerIp = document.getElementById('om-lan-router-ip');
        var dhcpStart = document.getElementById('om-lan-dhcp-start');
        var dhcpEnd = document.getElementById('om-lan-dhcp-end');
        if (routerIp && state.lan_router_ip) routerIp.value = state.lan_router_ip;
        if (dhcpStart && state.lan_dhcp_start) dhcpStart.value = state.lan_dhcp_start;
        if (dhcpEnd && state.lan_dhcp_end) dhcpEnd.value = state.lan_dhcp_end;

        setToggleActive('om-lan-mode-toggle', 'data-mode', state.lan_mode === 'IP Passthrough' ? 'passthrough' : 'nat');
        toggleMacRow();
        toggleIpCard();
        var macEl = document.getElementById('om-lan-mac');
        if (macEl && state.lan_mpdn_mac) macEl.value = state.lan_mpdn_mac;

        setToggleActive('om-lan-dns-toggle', 'data-dns', state.lan_dns_mode === 'local' ? 'local' : 'carrier');

        lanBaseline = lanSnapshot();
        applyBarToggle(false);
      })
      .catch(function () { /* leave defaults in place */ });
  }

  function onModeToggleChange() {
    toggleMacRow();
    toggleIpCard();
    checkLanDirty();
  }

  // Only the sections that actually differ from the loaded baseline get
  // their AT command fired — e.g. touching the DNS toggle alone doesn't
  // also re-push the (unchanged) DHCP pool. IP changes are gated on the
  // card's visibility, since the pool it edits is meaningless mid-
  // passthrough and shouldn't fire just because the mode toggle hid it
  // without the user ever having touched the IP fields.
  function lanApply() {
    var statusEl = document.getElementById('om-apply-status');
    var btn = document.getElementById('om-apply-btn');
    var current = lanSnapshot();

    var modeDirty = current.mode !== lanBaseline.mode || current.mac !== lanBaseline.mac;
    var dnsDirty = current.dns !== lanBaseline.dns;
    var ipCard = document.getElementById('om-lan-ip-card');
    var ipVisible = ipCard && ipCard.style.display !== 'none';
    var ipDirty = ipVisible && (
      current.routerIp !== lanBaseline.routerIp ||
      current.dhcpStart !== lanBaseline.dhcpStart ||
      current.dhcpEnd !== lanBaseline.dhcpEnd
    );

    if (!modeDirty && !dnsDirty && !ipDirty) return;

    if (ipDirty && (!isValidIPv4(current.routerIp) || !isValidIPv4(current.dhcpStart) || !isValidIPv4(current.dhcpEnd))) {
      statusEl.textContent = 'Enter valid IP addresses.';
      return;
    }

    var disruptive = [];
    if (modeDirty) disruptive.push('the network mode');
    if (ipDirty) disruptive.push('the LAN IP/DHCP range');
    if (disruptive.length) {
      var msg = 'Apply changes to ' + disruptive.join(' and ') + '? This may briefly disconnect the current session';
      if (ipDirty) msg += ' — reconnect at ' + current.routerIp + ' if the router IP changed';
      if (!window.confirm(msg + '. Continue?')) return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Applying…';

    var steps = [];
    if (modeDirty) {
      var qs = 'action=set_mode&mode=' + current.mode;
      if (current.mode === 'passthrough') qs += '&mac=' + encodeURIComponent(current.mac || 'FF:FF:FF:FF:FF:FF');
      steps.push({ label: 'Mode', url: '/cgi-bin/lan_action.sh?' + qs });
    }
    if (dnsDirty) {
      steps.push({ label: 'DNS', url: '/cgi-bin/lan_action.sh?action=set_dns&dns_mode=' + current.dns });
    }
    if (ipDirty) {
      steps.push({
        label: 'IP', url: '/cgi-bin/lan_action.sh?action=set_lanip&router_ip=' + encodeURIComponent(current.routerIp) +
          '&dhcp_start=' + encodeURIComponent(current.dhcpStart) + '&dhcp_end=' + encodeURIComponent(current.dhcpEnd)
      });
    }

    // Sequential, not parallel — set_mode can drop/reset the WAN
    // connection, and the AT broker only serializes one in-flight
    // request at a time anyway.
    var results = [];
    var chain = Promise.resolve();
    steps.forEach(function (step) {
      chain = chain.then(function () {
        return fetch(step.url)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            results.push(step.label + ': ' + (data.success ? 'OK' : 'Failed — ' + data.error));
          })
          .catch(function (err) {
            results.push(step.label + ': Failed — ' + err);
          });
      });
    });

    chain.then(function () {
      statusEl.textContent = results.join('  ');
      btn.disabled = false;
      loadLanConfig();
    });
  }

  function initLanConfig() {
    if (!document.getElementById('om-lan-mode-toggle')) return; // not on this page

    loadLanConfig();
    initToggleGroup('om-lan-mode-toggle', 'data-mode', onModeToggleChange);
    initToggleGroup('om-lan-dns-toggle', 'data-dns', checkLanDirty);

    ['om-lan-router-ip', 'om-lan-dhcp-start', 'om-lan-dhcp-end', 'om-lan-mac'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', checkLanDirty);
    });

    bindApplyButton(lanApply);
  }

  /* ── WAN config (WAN page) ───────────────────────────────────────────
     TTL is the only tracked "setting" here (shares the same apply-bar
     pattern as Band Lock/LAN); the data-usage counter reset is a
     one-shot action like Carrier Scan, not a saved setting, so it keeps
     its own button and doesn't touch the apply bar. */
  var wanTtlBaseline = null;

  function loadWanTtl() {
    fetch('/cgi-bin/wan_action.sh?action=get_ttl')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        var el = document.getElementById('om-wan-ttl');
        if (el) el.value = data.ttl;
        wanTtlBaseline = String(data.ttl);
        applyBarToggle(false);
      })
      .catch(function () { /* leave field at its default */ });
  }

  function checkWanDirty() {
    if (wanTtlBaseline === null) return;
    var el = document.getElementById('om-wan-ttl');
    applyBarToggle(!!el && el.value.trim() !== wanTtlBaseline);
  }

  function wanApply() {
    var statusEl = document.getElementById('om-apply-status');
    var btn = document.getElementById('om-apply-btn');
    var el = document.getElementById('om-wan-ttl');
    var raw = el.value.trim();
    var n = parseInt(raw, 10);
    if (raw === '' || isNaN(n) || n < 0 || n > 255) {
      statusEl.textContent = 'TTL must be 0 (disabled) or 1-255.';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Applying…';
    fetch('/cgi-bin/wan_action.sh?action=set_ttl&value=' + n)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        statusEl.textContent = data.success ? data.message : ('Failed: ' + data.error);
        if (data.success) {
          wanTtlBaseline = String(n);
          applyBarToggle(false);
        }
      })
      .catch(function (err) { statusEl.textContent = 'Failed: ' + err; })
      .finally(function () { btn.disabled = false; });
  }

  function initWanConfig() {
    var ttlEl = document.getElementById('om-wan-ttl');
    if (!ttlEl) return; // not on this page

    loadWanTtl();
    ttlEl.addEventListener('input', checkWanDirty);
    bindApplyButton(wanApply);

    var resetBtn = document.getElementById('om-wan-reset-counter');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (!window.confirm('Reset the WAN data usage counter to zero?')) return;
        var statusEl = document.getElementById('om-wan-reset-status');
        resetBtn.disabled = true;
        statusEl.textContent = 'Resetting…';
        fetch('/cgi-bin/wan_action.sh?action=reset_counter')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            statusEl.textContent = data.success ? data.message : ('Failed: ' + data.error);
          })
          .catch(function (err) { statusEl.textContent = 'Failed: ' + err; })
          .finally(function () { resetBtn.disabled = false; });
      });
    }
  }

  /* ── Internet card (WAN page) ────────────────────────────────────────
     ipinfo.io is queried by the modem itself (www/cgi-bin/
     internet_info.sh, curl over the modem's own WAN connection) and
     fetched once on page load — not the browser, and not polled on an
     interval. Every field here comes from that one ipinfo.io response,
     not the modem's own wan_ip/wan_ipv6 (Status card already shows
     those) — ipinfo.io only ever returns a single "ip" for whichever
     protocol the request actually used, so it's routed into the IPv4 or
     IPv6 row by its shape rather than assumed, leaving the other row
     blank rather than guessed. org comes back as "AS7018 AT&T
     Services, Inc." — split on the first space into ASN + ISP rather
     than shown as one blob, since the card has separate rows for each. */
  function fetchWanInternet() {
    var statusEl = document.getElementById('om-wan-inet-status');
    fetch('/cgi-bin/internet_info.sh')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);

        var org = data.org || '';
        var m = org.match(/^(AS\d+)\s*(.*)$/);
        document.getElementById('om-wan-inet-isp').textContent = m ? (m[2] || '—') : (org || '—');
        document.getElementById('om-wan-inet-asn').textContent = m ? m[1] : '—';

        document.getElementById('om-wan-inet-hostname').textContent = data.hostname || '—';

        var ip = data.ip || '';
        document.getElementById('om-wan-inet-ipv4').textContent = (ip && ip.indexOf(':') === -1) ? ip : '—';
        document.getElementById('om-wan-inet-ipv6').textContent = (ip && ip.indexOf(':') !== -1) ? ip : '—';

        var geo = [data.city, data.region, data.country].filter(function (v) { return v; });
        document.getElementById('om-wan-inet-geo').textContent = geo.length ? geo.join(', ') : '—';

        if (statusEl) statusEl.textContent = '';
      })
      .catch(function (err) {
        if (statusEl) statusEl.textContent = 'Unable to fetch public IP info: ' + err;
      });
  }

  function initWanInternet() {
    if (!document.getElementById('om-wan-inet-isp')) return; // not on this page
    fetchWanInternet();
  }

  /* ── SIM slot cards (SIM page) ───────────────────────────────────────
     This module has 2 SIM slots but only one is active/queryable at a
     time (AT+QUIMSLOT selects which) — sim_status/sim_iccid/sim_imsi/
     sim_phone always describe whichever slot sim_active_slot names,
     never both, since reading the inactive slot would require an
     actual disruptive switch (see sim_action.sh). Called from
     refreshState() on every poll tick (not gated behind an initX()
     page guard) so both cards and the toggle's highlighted button stay
     truthful to the modem's real state — there's no "pending edit" to
     protect here the way LAN/Band Lock's forms have, since clicking a
     slot button fires the switch immediately rather than staging one. */
  function renderSimSlots(state) {
    if (!document.getElementById('om-sim1-status')) return; // not on this page

    var active = state.sim_active_slot;
    [1, 2].forEach(function (n) {
      var isActive = active === n;
      var vals = isActive
        ? { status: state.sim_status, iccid: state.sim_iccid, imsi: state.sim_imsi, phone: state.sim_phone }
        : { status: null, iccid: null, imsi: null, phone: null };
      ['status', 'iccid', 'imsi', 'phone'].forEach(function (key) {
        var el = document.getElementById('om-sim' + n + '-' + key);
        if (el) el.textContent = (vals[key] === null || vals[key] === undefined || vals[key] === '') ? '—' : vals[key];
      });
      var noteEl = document.getElementById('om-sim' + n + '-note');
      if (noteEl) noteEl.textContent = isActive ? '' : 'Not currently active — switch to this SIM to view its details.';
    });

    setToggleActive('om-sim-slot-toggle', 'data-slot', active === 1 || active === 2 ? String(active) : null);
  }

  function applySimSlot(slot) {
    var statusEl = document.getElementById('om-sim-slot-status');
    if (!window.confirm('Switch to SIM' + slot + '? This briefly disconnects the modem (including this web UI) while it reinitializes.')) return;

    statusEl.textContent = 'Switching…';
    fetch('/cgi-bin/sim_action.sh?action=set_slot&slot=' + slot)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        statusEl.textContent = data.success ? data.message : ('Failed: ' + data.error);
      })
      .catch(function (err) { statusEl.textContent = 'Failed: ' + err; });
  }

  function initSimSlotToggle() {
    var group = document.getElementById('om-sim-slot-toggle');
    if (!group) return; // not on this page
    var buttons = group.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { applySimSlot(btn.getAttribute('data-slot')); });
      })(buttons[i]);
    }
  }

  window.OM = { init: initShell };

  document.addEventListener('DOMContentLoaded', function () {
    refreshState();
    setInterval(tickAge, 1000);
    initUpdateButton();
    initAtTerminal();
    initPowerButtons();
    initBandLock();
    initCarrierScan();
    initNetPrefs();
    initCellularApplyBar();
    initLanConfig();
    initWanConfig();
    initWanInternet();
    initSimSlotToggle();
  });
})();
