/* app.js — shared nav/shell for all pages. No framework, no build step. */
(function () {
  'use strict';

  var REPO_URL = 'https://github.com/anthonysecco/OpenModem';

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

  /* Shared good/warning/critical/info vocabulary — same shape language
     as the nav icons above (24x24, stroke=currentColor), reused by both
     the Dashboard's Status card and the generic confirm modal below so
     "how alarming does this look" stays consistent everywhere on the
     site. Shapes differ (circle/triangle/octagon), not just color, so
     severity still reads for anyone who can't distinguish the colors. */
  var STATUS_ICONS = {
    good: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/>' +
      '<circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none"/>',
    warning: '<path d="M12 3L22 20H2L12 3Z"/><line x1="12" y1="9" x2="12" y2="13.5"/>' +
      '<circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none"/>',
    critical: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z"/><line x1="12" y1="8" x2="12" y2="13"/>' +
      '<circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/>'
  };
  var STATUS_COLORS = { good: '#34c777', info: '#2f6fed', warning: '#e0a63e', critical: '#e05a4e' };

  function statusIconSvg(level) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (STATUS_ICONS[level] || '') + '</svg>';
  }

  function buildNavLinks(activeKey) {
    return NAV.map(function (item) {
      var cls = item.key === activeKey ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '>' + iconSvg(item.key) +
        '<span class="label">' + item.label + '</span></a>';
    }).join('');
  }

  /* Footer markup (connection status + "Updated Xs ago", plus a GitHub
     repo link and the deployed commit SHA on a second line) is
     identical on every page, so it's injected here alongside the nav
     links rather than hand-duplicated across 6 HTML files — same
     reasoning as buildNavLinks() itself. Each page just carries an
     empty <footer id="om-footer"> for this to fill. refreshState()/
     tickAge() then drive #om-conn-status/[data-field="_polled_at"]
     exactly as before, just relocated from the topbar + a page-local
     <p class="om-updated"> into this one shared spot. The commit SHA
     link is a second, separate [data-field="commit_sha"] element from
     System page's Update card — loadVersionInfo() below updates every
     match on the page, not just the first, since this footer now
     duplicates that field site-wide. */
  function initShell(activeKey) {
    var links = buildNavLinks(activeKey);

    var sidebar = document.getElementById('om-sidebar-nav');
    if (sidebar) sidebar.innerHTML = links;

    var tabbar = document.getElementById('om-tabbar-nav');
    if (tabbar) tabbar.innerHTML = links;

    var footer = document.getElementById('om-footer');
    if (footer) {
      footer.innerHTML = '<span id="om-conn-status">Loading…</span> | Updated ' +
        '<span data-field="_polled_at">—</span>' +
        '<br>' +
        '<a href="' + REPO_URL + '" target="_blank" rel="noopener">OpenModem on GitHub</a>' +
        ' · <a data-field="commit_sha" href="' + REPO_URL + '" target="_blank" rel="noopener">—</a>';
    }

    // Static skeleton, built once — renderTopbarSignal (driven by
    // state.sh/refreshState, the AT-poller cycle) and
    // renderTopbarConnectivity (driven by net_state.sh/refreshNetState,
    // a separate cycle) each own a distinct child and update it in
    // place. Rebuilding the whole container's innerHTML from either
    // function, like the old single-function version did, would let
    // whichever poll cycle's tick landed last silently erase the
    // other's content — the two cycles aren't synchronized, so that's a
    // real race, not just a hypothetical one.
    var topbarSignal = document.getElementById('om-topbar-signal');
    if (topbarSignal) {
      topbarSignal.innerHTML = '<span class="om-topbar-sigbars" id="om-topbar-sigbars"></span>' +
        '<span class="om-topbar-carrier" id="om-topbar-carrier"></span>' +
        '<span class="om-topbar-sep">·</span>' +
        '<span class="om-topbar-nettype" id="om-topbar-nettype"></span>' +
        '<span class="om-topbar-sep">·</span>' +
        '<span class="om-topbar-conn-text" id="om-topbar-conn-text"></span>' +
        '<span class="om-ring-dot" id="om-topbar-conn-dot"></span>';
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

  /* Latency/jitter quality thresholds (2026-08-17) — same 5-step dark-
     green -> green -> yellow -> orange -> red gradient and color values
     as RSRP/RSRQ/SINR_ZONES above, for one consistent severity palette
     site-wide, but walked in ASCENDING order (ascZoneColor/ascZoneLabel
     below, not sigZoneColor/sigZoneLabel) since lower is better for
     latency/jitter — the opposite polarity from RSRP/RSRQ/SINR, where
     higher (less negative) is better. Centralized here (not inlined in
     renderConnectivityCard) so any other page/element that wants to
     color a latency or jitter value can reuse the exact same buckets. */
  var LATENCY_ZONES = [
    { thresh: 50, bar: '#1e8a4e', label: 'Excellent' },
    { thresh: 100, bar: '#34c777', label: 'Good' },
    { thresh: 150, bar: '#f0c64c', label: 'Fair' },
    { thresh: 300, bar: '#e0873a', label: 'Poor' },
    { thresh: Infinity, bar: '#e0473e', label: 'Critical' }
  ];
  var JITTER_ZONES = [
    { thresh: 5, bar: '#1e8a4e', label: 'Excellent' },
    { thresh: 15, bar: '#34c777', label: 'Good' },
    { thresh: 30, bar: '#f0c64c', label: 'Fair' },
    { thresh: 50, bar: '#e0873a', label: 'Poor' },
    { thresh: Infinity, bar: '#e0473e', label: 'Critical' }
  ];

  /* Estimated-download-speed thresholds, chosen for an RV/mobile-home
     use case — a single cellular link usually serving the whole
     household, not a per-device figure. Originally anchored to the
     FCC's 25 Mbps "broadband" floor as Excellent (2026-08-17); up-
     leveled by request (2026-08-17) to Excellent=200 for a modem
     capable of strong CA-aggregated 5G/LTE-A throughput well past that
     floor, with every other tier scaled by the same 8x factor (200/25)
     to preserve the original tier shape/ratios rather than picking new
     boundaries from scratch: Good (80-200) comfortably covers HD/4K
     streaming, video calls, and general browsing at once, several
     devices deep. Fair (40-80) is usable but starts to limit
     simultaneous heavy use. Poor (8-40) is basic-use-only: browsing/
     email fine, streaming needs to drop to SD or fails outright, video
     calls degrade badly. Critical (under 8) is effectively unusable for
     anything beyond text. Same descending-threshold, higher-is-better
     shape as RSRP/SINR_ZONES (val >= thresh wins), reusing
     sigZoneColor/sigZoneLabel/sigZoneIndex directly rather than
     ascZoneColor's lower-is-better direction. */
  var SPEED_ZONES = [
    { thresh: 200, bar: '#1e8a4e', label: 'Excellent' },
    { thresh: 80, bar: '#34c777', label: 'Good' },
    { thresh: 40, bar: '#f0c64c', label: 'Fair' },
    { thresh: 8, bar: '#e0873a', label: 'Poor' },
    { thresh: 0, bar: '#e0473e', label: 'Critical' }
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

  // Ascending-order counterpart of sigZoneColor/sigZoneLabel, for
  // lower-is-better metrics (LATENCY_ZONES/JITTER_ZONES) — first zone
  // whose thresh is >= val wins, zones listed best (lowest ceiling) first.
  function ascZoneColor(val, zones) {
    for (var i = 0; i < zones.length; i++) {
      if (val <= zones[i].thresh) return zones[i].bar;
    }
    return zones[zones.length - 1].bar;
  }

  function ascZoneLabel(val, zones) {
    for (var i = 0; i < zones.length; i++) {
      if (val <= zones[i].thresh) return zones[i].label || '';
    }
    return zones[zones.length - 1].label || '';
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
  function fmtTempC(v) {
    if (typeof v !== 'number') return null;
    var f = Math.round((v * 9 / 5) + 32);
    return v + '°C / ' + f + '°F';
  }
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

  /* WAN throughput (Data Usage card's Receive/Send Rate rows, and the
     Bandwidth graphs below them) — the modem only reports a running
     cumulative byte counter (wan_data_rx/tx, from AT+QGDCNT?), never an
     instantaneous rate. The rate itself (wan_rx_mbps/wan_tx_mbps) is
     computed server-side now, once per poll cycle, by at_poller.sh's
     compute_wan_rate() — mirrors the Connectivity card's latency/jitter
     move to "one source of truth" (see renderConnectivityCard's
     comment): the front end just formats/displays it rather than
     re-deriving it from two consecutive state.sh samples itself. Doing
     the computation server-side is also what makes history_wan.sh (a
     persisted 5-min ring buffer, same shape as history_signal.sh)
     possible at all — a client-only computation would have nothing to
     seed a freshly-opened tab's graph with. */
  function fmtThroughput(mbps) {
    if (typeof mbps !== 'number') return '—';
    if (mbps >= 1) return mbps.toFixed(1) + ' Mbps';
    var kbps = mbps * 1000;
    return (kbps < 10 ? kbps.toFixed(1) : Math.round(kbps)) + ' Kbps';
  }

  function renderWanThroughput(state) {
    var rxEl = document.getElementById('om-wan-rx-rate');
    var txEl = document.getElementById('om-wan-tx-rate');
    if (!rxEl && !txEl) return; // not on this page

    if (rxEl) rxEl.textContent = fmtThroughput(state.wan_rx_mbps);
    if (txEl) txEl.textContent = fmtThroughput(state.wan_tx_mbps);
  }

  var historyWanRateSamples = [];

  // True on the WAN page (Receive/Send Rate charts) and the Dashboard
  // (combined Throughput chart) — both consume the same wan_rx_mbps/
  // tx_mbps series, just rendered differently, so history collection
  // runs whenever either is present rather than being tied to one page.
  function wanChartsPresent() {
    return !!(document.getElementById('om-wan-rx-chart') || document.getElementById('om-hist-throughput-chart'));
  }

  function pushWanHistorySample(state) {
    if (!wanChartsPresent()) return; // not on this page
    pushCapped(historyWanRateSamples, { t: state._polled_at, rx_mbps: state.wan_rx_mbps, tx_mbps: state.wan_tx_mbps });
    renderWanBandwidthCharts();
    renderThroughputChart();
  }

  // Flat single-color "zone" tables (always matches, since rate >= 0)
  // rather than the severity-gradient RSRP/SPEED/LATENCY_ZONES use —
  // instantaneous throughput isn't a "good/bad" metric the way signal
  // quality or latency are, so reusing chartZoneColor's plumbing with a
  // one-entry table just gets a flat Receive/Send color out of the same
  // renderLineChart/initChartHover code the other trend charts use.
  var WAN_RX_ZONE = [{ thresh: 0, bar: '#2f6fed', label: 'Receive' }];
  var WAN_TX_ZONE = [{ thresh: 0, bar: '#8b5cf6', label: 'Send' }];
  var WAN_RATE_MIN_RANGE = 0.1; // Mbps floor so an idle link doesn't collapse the axis to a zero-width range

  // Each graph's y-axis max is the actual peak in its own visible 5-min
  // window (not a fixed ceiling like SPEED_ZONES' 250) — WAN throughput
  // has no natural upper bound to anchor a fixed scale to, and Receive/
  // Send commonly differ by an order of magnitude, so they're scaled
  // independently rather than sharing one max.
  function renderWanBandwidthCharts() {
    if (!document.getElementById('om-wan-rx-chart')) return; // not on this page

    var rxMax = WAN_RATE_MIN_RANGE, txMax = WAN_RATE_MIN_RANGE;
    historyWanRateSamples.forEach(function (r) {
      if (typeof r.rx_mbps === 'number' && r.rx_mbps > rxMax) rxMax = r.rx_mbps;
      if (typeof r.tx_mbps === 'number' && r.tx_mbps > txMax) txMax = r.tx_mbps;
    });

    var rxAxisEl = document.getElementById('om-wan-rx-chart-axis-max');
    if (rxAxisEl) rxAxisEl.textContent = fmtChartValue(rxMax);
    var txAxisEl = document.getElementById('om-wan-tx-chart-axis-max');
    if (txAxisEl) txAxisEl.textContent = fmtChartValue(txMax);

    renderLineChart('om-wan-rx-chart', historyWanRateSamples, function (r) { return r.rx_mbps; }, WAN_RX_ZONE, 0, rxMax, false);
    renderLineChart('om-wan-tx-chart', historyWanRateSamples, function (r) { return r.tx_mbps; }, WAN_TX_ZONE, 0, txMax, false);
  }

  var THROUGHPUT_SERIES = [
    { getValue: function (r) { return r.rx_mbps; }, color: WAN_RX_ZONE[0].bar, label: 'Download', latestId: 'om-hist-throughput-rx-latest' },
    { getValue: function (r) { return r.tx_mbps; }, color: WAN_TX_ZONE[0].bar, label: 'Upload', latestId: 'om-hist-throughput-tx-latest' }
  ];

  // Dashboard's combined counterpart to renderWanBandwidthCharts above —
  // same wan_rx_mbps/tx_mbps samples, but Download and Upload drawn as
  // two lines on one chart sharing a single y-axis (the max of both
  // series' peaks in the visible 5-min window), per request, rather than
  // the WAN page's two independently-scaled charts.
  function renderThroughputChart() {
    if (!document.getElementById('om-hist-throughput-chart')) return; // not on this page

    var max = WAN_RATE_MIN_RANGE;
    historyWanRateSamples.forEach(function (r) {
      if (typeof r.rx_mbps === 'number' && r.rx_mbps > max) max = r.rx_mbps;
      if (typeof r.tx_mbps === 'number' && r.tx_mbps > max) max = r.tx_mbps;
    });

    var axisEl = document.getElementById('om-hist-throughput-chart-axis-max');
    if (axisEl) axisEl.textContent = fmtChartValue(max);

    renderDualLineChart('om-hist-throughput-chart', historyWanRateSamples, THROUGHPUT_SERIES, 0, max);
  }

  /* System (Application Processor) uptime — the poller supplies raw
     seconds from /proc/uptime (collect_uptime() in at_poller.sh, not
     an AT command at all); the days/hours/minutes breakdown happens
     here, same split as fmtBytes above. Leading zero units are
     skipped entirely (a freshly-booted device reads "12m", not
     "0d 0h 12m"). Compact abbreviated form (e.g. "22d 20h 46m")
     rather than spelled-out units or a week/month/year rollup — this
     is a status-row value, not prose, and days-not-weeks is the
     conventional uptime-display unit (`uptime`, router admin UIs). */
  var UPTIME_UNITS = [
    { label: 'd', secs: 24 * 3600 },
    { label: 'h', secs: 3600 },
    { label: 'm', secs: 60 }
  ];
  function fmtUptime(v) {
    if (typeof v !== 'number' || v < 0) return null;
    var remaining = Math.floor(v);
    var parts = [];
    UPTIME_UNITS.forEach(function (u) {
      var n = Math.floor(remaining / u.secs);
      remaining -= n * u.secs;
      if (n > 0) parts.push(n + u.label);
    });
    return parts.length ? parts.join(' ') : '<1m';
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
    device_uptime_s: fmtUptime,
    device_temp_c: fmtTempC
  };

  function renderState(state) {
    var nodes = document.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = node.getAttribute('data-field');
      // _polled_at: handled by the live ticker. commit_sha/commit_date:
      // installer-recorded metadata, not part of state.sh's poller
      // JSON — handled by loadVersionInfo()'s own one-shot fetch
      // instead, so this loop must not stomp them back to "—" every
      // poll cycle just because state[key] is undefined here.
      if (key === '_polled_at' || key === 'commit_sha' || key === 'commit_date') continue;
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
    // No page-level guard here: applyRegRingDot/applyRingDot each check
    // their own element's existence and no-op if absent, so this is
    // safe to call on any page — e.g. Dashboard's Network card only has
    // the reg_lte/reg_nr dots, not the full Cellular signal-dot suite.
    applyRegRingDot('reg_lte', state);
    applyRegRingDot('reg_nr', state);
    applyRingDot('signal_lte_rsrp', RSRP_ZONES, state);
    applyRingDot('signal_lte_rsrq', RSRQ_ZONES, state);
    applyRingDot('signal_lte_sinr', SINR_ZONES, state);
    applyRingDot('signal_nr_rsrp', RSRP_ZONES, state);
    applyRingDot('signal_nr_rsrq', RSRQ_ZONES, state);
    applyRingDot('signal_nr_sinr', SINR_ZONES, state);
  }

  /* ── Connectivity card (Dashboard) ───────────────────────────────────
     Connectivity/Ping Check are binary online/offline, not a live-
     changing measurement, so those two dots stay a static halo
     (flash=false) — same reasoning as Registration's dot in
     applyRegRingDot above, and they use the site's fixed green/red/gray
     status vocabulary rather than a gradient, since there's no
     in-between tier for a binary state. Latency/Jitter are live-
     changing measurements like RSRP/RSRQ/SINR, so those two dots flash
     on refresh (flash=true) and color against LATENCY_ZONES/
     JITTER_ZONES via ascZoneColor. */
  function connStatusColor(status) {
    if (status === 'online') return '#34c777';
    if (status === 'offline') return '#e05a4e';
    return '#5c5c5e';
  }

  function connStatusText(status) {
    if (status === 'online') return 'Online';
    if (status === 'offline') return 'Offline';
    return '—';
  }

  // Latency/Jitter are no longer duplicated here as small text+dot rows —
  // they're the hero value + trend chart rendered by renderLineChart
  // (via renderHistoryCharts, driven off historyNetSamples) directly
  // inside the Connectivity card now, one source of truth instead of two
  // competing displays of the same number.
  /* US state/territory name -> USPS 2-letter code, for "IP Geo"'s
     "City, State, Country" display. ipinfo.io's free/unauthenticated
     tier (see net_poller.sh's geo_loop) returns country already as ISO
     3166-1 alpha-2 (e.g. "US") but region as a full name ("California"),
     not an ISO 3166-2 subdivision code — that field only exists on paid
     plans, not worth requiring an API key for. This table gets the
     requested abbreviation for the common case (US) without hand-rolling
     a full worldwide ISO 3166-2 database for every country's provinces;
     non-US regions just show their full name as ipinfo returns it. */
  var US_STATE_ABBR = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
    'Puerto Rico': 'PR', 'Guam': 'GU', 'American Samoa': 'AS',
    'United States Virgin Islands': 'VI', 'Northern Mariana Islands': 'MP'
  };

  function formatGeoLocation(city, region, country) {
    var parts = [];
    if (city) parts.push(city);
    if (region) parts.push((country === 'US' && US_STATE_ABBR[region]) || region);
    if (country) parts.push(country);
    return parts.length ? parts.join(', ') : '—';
  }

  function renderConnectivityCard(netState) {
    var icmpStatusTextEl = document.getElementById('om-conn-icmp-status-text');
    if (!icmpStatusTextEl) return; // not on this page

    var icmpStatus = netState.icmp_status;
    icmpStatusTextEl.textContent = connStatusText(icmpStatus);
    var icmpDotEl = document.getElementById('om-conn-icmp-dot');
    if (icmpDotEl) setRingDotColor(icmpDotEl, connStatusColor(icmpStatus), false);

    var check204Status = netState.check204_status;
    var check204TextEl = document.getElementById('om-conn-check204-text');
    if (check204TextEl) check204TextEl.textContent = connStatusText(check204Status);
    var check204DotEl = document.getElementById('om-conn-check204-dot');
    if (check204DotEl) setRingDotColor(check204DotEl, connStatusColor(check204Status), false);

    // Both change rarely (net_poller.sh's geo_loop only refreshes every
    // NET_GEO_INTERVAL, 5 min by default) — plain text, no ring dot,
    // since there's no online/offline or quality tier to color here.
    var cfPopEl = document.getElementById('om-conn-cf-pop');
    if (cfPopEl) cfPopEl.textContent = netState.cf_pop || '—';

    var geoEl = document.getElementById('om-conn-geo-location');
    if (geoEl) geoEl.textContent = formatGeoLocation(netState.geo_city, netState.geo_region, netState.geo_country);
  }

  /* ── 5-minute trend history (Dashboard) ──────────────────────────────
     Mirrors the server's own ring-buffer design: a fixed-size in-memory
     window (HISTORY_WINDOW_SAMPLES, matching config's own default so a
     tab left open way past 5 minutes doesn't grow unbounded either),
     seeded once from history_signal.sh/history_net.sh on page load (so a
     freshly-opened tab immediately sees the preceding 5 minutes the
     server already accumulated, per the whole point of this feature —
     see net_poller.sh/at_poller.sh's append_*_history()), then
     live-appended to as refreshState()/refreshNetState() see genuinely
     new poll data — no separate polling loop needed, this just piggybacks
     on those two's existing gated new-data blocks. Record shapes match
     the server's JSON exactly (lte_rsrp/nr_rsrp/dl_est_mbps,
     latency_ms/jitter_ms) rather than remapping at push time, so seeded
     and live-appended records read identically in renderLineChart's
     accessor callbacks below. */
  var HISTORY_WINDOW_SAMPLES = 60;
  var historySignalSamples = [];
  var historyNetSamples = [];

  function pushCapped(arr, sample) {
    arr.push(sample);
    while (arr.length > HISTORY_WINDOW_SAMPLES) arr.shift();
  }

  // Whichever RAT's RSRP was actually reported for that sample — NR is
  // only ever non-null when an NR leg was actually active at poll time
  // (see at_poller.sh's collect_signal), so "NR present" is already a
  // reliable proxy for "NR was the active RAT then", same rule
  // currentRsrp() uses for the live topbar/Signal Strength card.
  function historyRsrp(rec) {
    return (typeof rec.nr_rsrp === 'number') ? rec.nr_rsrp : rec.lte_rsrp;
  }

  /* ── Smoothed line chart (RSRP Trend) ────────────────────────────────
     Inline SVG, no charting library — consistent with the rest of the
     site's no-build-step/no-new-dependency constraint. "Smoothing" is a
     Catmull-Rom-to-cubic-Bezier conversion (catmullRomSegments): each
     segment's control points are derived from its own neighbors, so
     consecutive segments share a continuous tangent at their shared
     endpoint — this is what lets each segment be drawn as its own
     separately-colored <path> (to keep the RSRP_ZONES color bucketing
     per the site's established convention) without visible kinks where
     one segment's color hands off to the next. The soft area fill
     beneath, by contrast, is intentionally a single color (the latest
     sample's zone) rather than multi-colored — a multi-colored fill
     read as noisy in practice; the multi-colored *line* is what carries
     the bucketing, the fill is just a modern-chart backdrop.
     viewBox is a fixed logical coordinate system (CHART_VIEW_W x
     CHART_VIEW_H); actual on-screen size is controlled by CSS
     (.om-chart-svg: width:100%, fixed height) — non-uniform scaling of
     a line chart (x = time, y = value, independently scaled) is
     standard/expected here, not a distortion to avoid. */
  var CHART_VIEW_W = 300;
  var CHART_VIEW_H = 90;
  var CHART_PAD = 6;
  var chartPoints = {};  // containerId -> last-rendered [{x,y,v,t}, ...], for hover lookups
  var chartHover = {};   // containerId -> {idx} currently-shown point

  // Adaptive precision for chart hover tooltips/axis labels: below 10 in
  // magnitude a bare rounded integer loses too much (WAN Mbps idling
  // under 1, sub-10ms latency/jitter on a good connection), so those get
  // one decimal place; at or above 10 (every RSRP/RSRQ/SINR reading, and
  // most Speed/Latency/Jitter samples), a rounded integer is precise
  // enough and matches the existing on-screen convention. Math.abs, not
  // a bare >= 10, so this doesn't add a spurious ".0" to RSRP's negative
  // dBm values (always well past -10 in magnitude).
  function fmtChartValue(v) {
    return Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(1);
  }

  function chartX(i, n) {
    if (n <= 1) return CHART_PAD;
    return CHART_PAD + (i / (n - 1)) * (CHART_VIEW_W - CHART_PAD * 2);
  }

  function chartY(val, min, max) {
    var pct = Math.max(0, Math.min(1, (val - min) / (max - min)));
    return CHART_PAD + (1 - pct) * (CHART_VIEW_H - CHART_PAD * 2);
  }

  // One cubic-Bezier segment per adjacent point pair; p0/p3 are the
  // neighbors used only to compute this segment's own control points
  // (clamped to the first/last point at the ends), uniform Catmull-Rom.
  function catmullRomSegments(points) {
    var segs = [];
    var n = points.length;
    for (var i = 0; i < n - 1; i++) {
      var p0 = points[i === 0 ? 0 : i - 1];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2 < n ? i + 2 : n - 1];
      var cp1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      var cp2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      segs.push([p1, cp1, cp2, p2]);
    }
    return segs;
  }

  function segPathD(seg) {
    return 'M ' + seg[0][0] + ' ' + seg[0][1] +
      ' C ' + seg[1][0] + ' ' + seg[1][1] + ', ' + seg[2][0] + ' ' + seg[2][1] + ', ' + seg[3][0] + ' ' + seg[3][1];
  }

  // ascending=true for lower-is-better metrics (Latency/Jitter, via
  // ascZoneColor), false/omitted for higher-is-better (RSRP, Speed, via
  // sigZoneColor).
  function chartZoneColor(val, zones, ascending) {
    return ascending ? ascZoneColor(val, zones) : sigZoneColor(val, zones);
  }

  function renderLineChart(containerId, samples, getValue, zones, min, max, ascending) {
    var svg = document.getElementById(containerId);
    if (!svg) return;
    var svgns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 ' + CHART_VIEW_W + ' ' + CHART_VIEW_H);
    svg.setAttribute('preserveAspectRatio', 'none');

    var pts = [];
    samples.forEach(function (rec, i) {
      var v = getValue(rec);
      if (typeof v !== 'number') return;
      pts.push({ x: chartX(i, samples.length), y: chartY(v, min, max), v: v, t: rec.t });
    });
    chartPoints[containerId] = pts;

    // Latest value, shown as the hero number above this chart (see
    // .om-hero-value) — a big glanceable figure first, chart underneath
    // for trend context. Updated even with fewer than 2 points (the
    // line itself needs at least 2 to draw a path, but a single sample
    // is still a real "latest" value).
    var latestEl = document.getElementById(containerId + '-latest');
    if (latestEl) {
      if (pts.length > 0) {
        var last = pts[pts.length - 1];
        latestEl.textContent = Math.round(last.v);
        latestEl.style.color = chartZoneColor(last.v, zones, ascending);
      } else {
        latestEl.textContent = '—';
        latestEl.style.color = '';
      }
    }

    if (pts.length < 2) return; // not enough data yet — leave the chart blank

    var coords = pts.map(function (p) { return [p.x, p.y]; });
    var segs = catmullRomSegments(coords);
    var lastColor = chartZoneColor(pts[pts.length - 1].v, zones, ascending);
    var gradId = containerId + '-grad';

    var defs = document.createElementNS(svgns, 'defs');
    var grad = document.createElementNS(svgns, 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    var stop1 = document.createElementNS(svgns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', lastColor);
    stop1.setAttribute('stop-opacity', '0.25');
    var stop2 = document.createElementNS(svgns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', lastColor);
    stop2.setAttribute('stop-opacity', '0');
    grad.appendChild(stop1); grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    var floorY = CHART_VIEW_H - CHART_PAD;
    var areaD = 'M ' + coords[0][0] + ' ' + floorY + ' L ' + coords[0][0] + ' ' + coords[0][1];
    segs.forEach(function (s) {
      areaD += ' C ' + s[1][0] + ' ' + s[1][1] + ', ' + s[2][0] + ' ' + s[2][1] + ', ' + s[3][0] + ' ' + s[3][1];
    });
    areaD += ' L ' + coords[coords.length - 1][0] + ' ' + floorY + ' Z';
    var area = document.createElementNS(svgns, 'path');
    area.setAttribute('d', areaD);
    area.setAttribute('fill', 'url(#' + gradId + ')');
    area.setAttribute('stroke', 'none');
    svg.appendChild(area);

    segs.forEach(function (s, i) {
      var color = chartZoneColor((pts[i].v + pts[i + 1].v) / 2, zones, ascending);
      var path = document.createElementNS(svgns, 'path');
      path.setAttribute('d', segPathD(s));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    });
  }

  function chartPointsFor(samples, getValue, min, max) {
    var pts = [];
    samples.forEach(function (rec, i) {
      var v = getValue(rec);
      if (typeof v !== 'number') return;
      pts.push({ x: chartX(i, samples.length), y: chartY(v, min, max), v: v, t: rec.t });
    });
    return pts;
  }

  /* Multi-series counterpart to renderLineChart above, for the Dashboard
     Throughput chart (Download + Upload sharing one y-axis instead of
     RSRP/Speed/Latency/Jitter's single line each). No zone-based per-
     segment coloring and no area fill here — WAN throughput has no
     good/bad severity tiers the way signal or latency do (renderLineChart's
     own WAN_RX_ZONE/WAN_TX_ZONE are already flat single-color tables, see
     their definition above), and two overlapping fills would just muddy
     the two lines this chart exists to keep visually distinct. series is
     [{getValue, color, label, latestId}, ...]; chartPoints[containerId]
     stores one points array per series (in series order) rather than a
     single flat array, which is what nearestDualChartIndex/showDualChartHover
     below expect. */
  function renderDualLineChart(containerId, samples, series, min, max) {
    var svg = document.getElementById(containerId);
    if (!svg) return;
    var svgns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 ' + CHART_VIEW_W + ' ' + CHART_VIEW_H);
    svg.setAttribute('preserveAspectRatio', 'none');

    var seriesPts = series.map(function (s) { return chartPointsFor(samples, s.getValue, min, max); });
    chartPoints[containerId] = seriesPts;

    series.forEach(function (s, si) {
      var pts = seriesPts[si];
      var latestEl = s.latestId ? document.getElementById(s.latestId) : null;
      if (latestEl) latestEl.textContent = pts.length ? fmtThroughput(pts[pts.length - 1].v) : '—';
      if (pts.length < 2) return;

      var coords = pts.map(function (p) { return [p.x, p.y]; });
      var segs = catmullRomSegments(coords);
      segs.forEach(function (seg) {
        var path = document.createElementNS(svgns, 'path');
        path.setAttribute('d', segPathD(seg));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', s.color);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);
      });
    });
  }

  /* Hover/touch: shows the nearest point's value immediately (not
     delayed) — pointerdown+pointermove (not separate mouse/touch
     handlers) covers both desktop hover and mobile touch with one code
     path. chartHover just tracks which point index is currently shown,
     so moving to a different point re-renders the marker/tooltip there
     instead of redrawing on every pixel of movement within the same
     point's nearest-neighbor range. */
  function clearChartHover(containerId) {
    chartHover[containerId] = null;
    var svg = document.getElementById(containerId);
    var marker = svg && svg.querySelector('.om-chart-hover-marker');
    if (marker) marker.parentNode.removeChild(marker);
    var tip = document.getElementById(containerId + '-tooltip');
    if (tip) tip.style.display = 'none';
  }

  function nearestChartIndex(containerId, clientX, svgEl) {
    var pts = chartPoints[containerId];
    if (!pts || !pts.length) return -1;
    var rect = svgEl.getBoundingClientRect();
    if (!rect.width) return -1;
    var relX = ((clientX - rect.left) / rect.width) * CHART_VIEW_W;
    var best = 0, bestDist = Infinity;
    pts.forEach(function (p, i) {
      var d = Math.abs(p.x - relX);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function showChartHover(containerId, unit, zones, ascending, idx, svgEl, wrapEl) {
    var pts = chartPoints[containerId];
    if (!pts || !pts[idx]) return;
    var p = pts[idx];
    var svgns = 'http://www.w3.org/2000/svg';

    var marker = svgEl.querySelector('.om-chart-hover-marker');
    if (marker) marker.parentNode.removeChild(marker);
    var circle = document.createElementNS(svgns, 'circle');
    circle.setAttribute('class', 'om-chart-hover-marker');
    circle.setAttribute('cx', p.x);
    circle.setAttribute('cy', p.y);
    circle.setAttribute('r', '3.5');
    circle.setAttribute('fill', chartZoneColor(p.v, zones, ascending));
    circle.setAttribute('stroke', 'var(--surface)');
    circle.setAttribute('stroke-width', '1.5');
    svgEl.appendChild(circle);

    var tip = document.getElementById(containerId + '-tooltip');
    if (!tip) return;
    tip.textContent = fmtChartValue(p.v) + ' ' + unit;
    tip.style.display = 'block';
    var wrapRect = wrapEl.getBoundingClientRect();
    var svgRect = svgEl.getBoundingClientRect();
    var xPx = (p.x / CHART_VIEW_W) * svgRect.width + (svgRect.left - wrapRect.left);
    var yPx = (p.y / CHART_VIEW_H) * svgRect.height + (svgRect.top - wrapRect.top);
    tip.style.left = xPx + 'px';
    tip.style.top = yPx + 'px';
  }

  function handleChartHoverMove(containerId, unit, zones, ascending, clientX, svgEl, wrapEl) {
    var idx = nearestChartIndex(containerId, clientX, svgEl);
    if (idx < 0) return;
    var st = chartHover[containerId];
    if (st && st.idx === idx) return; // already showing this point
    chartHover[containerId] = { idx: idx };
    showChartHover(containerId, unit, zones, ascending, idx, svgEl, wrapEl);
  }

  function initChartHover(containerId, unit, zones, ascending) {
    var svg = document.getElementById(containerId);
    if (!svg) return; // not on this page
    var wrapEl = svg.closest('.om-chart-wrap');
    if (!wrapEl) return;
    svg.addEventListener('pointermove', function (e) { handleChartHoverMove(containerId, unit, zones, ascending, e.clientX, svg, wrapEl); });
    svg.addEventListener('pointerdown', function (e) { handleChartHoverMove(containerId, unit, zones, ascending, e.clientX, svg, wrapEl); });
    svg.addEventListener('pointerleave', function () { clearChartHover(containerId); });
    svg.addEventListener('pointerup', function () { clearChartHover(containerId); });
  }

  /* Dual-series counterpart to the hover functions above, for
     renderDualLineChart charts (chartPoints[containerId] is an array of
     per-series points arrays there, not one flat array) — nearest index
     is found off whichever series has points (both share the same x per
     sample index, since chartX only depends on i/n), then every series
     gets its own marker dot and the tooltip lists all of them together
     rather than one value. */
  function clearDualChartHover(containerId) {
    chartHover[containerId] = null;
    var svg = document.getElementById(containerId);
    if (svg) {
      var markers = svg.querySelectorAll('.om-chart-hover-marker');
      for (var i = 0; i < markers.length; i++) markers[i].parentNode.removeChild(markers[i]);
    }
    var tip = document.getElementById(containerId + '-tooltip');
    if (tip) tip.style.display = 'none';
  }

  function nearestDualChartIndex(containerId, clientX, svgEl) {
    var seriesPts = chartPoints[containerId];
    if (!seriesPts) return -1;
    var pts = null;
    for (var s = 0; s < seriesPts.length; s++) {
      if (seriesPts[s] && seriesPts[s].length) { pts = seriesPts[s]; break; }
    }
    if (!pts) return -1;
    var rect = svgEl.getBoundingClientRect();
    if (!rect.width) return -1;
    var relX = ((clientX - rect.left) / rect.width) * CHART_VIEW_W;
    var best = 0, bestDist = Infinity;
    pts.forEach(function (p, i) {
      var d = Math.abs(p.x - relX);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function showDualChartHover(containerId, series, idx, svgEl, wrapEl) {
    var seriesPts = chartPoints[containerId];
    if (!seriesPts) return;
    var svgns = 'http://www.w3.org/2000/svg';
    var existing = svgEl.querySelectorAll('.om-chart-hover-marker');
    for (var i = 0; i < existing.length; i++) existing[i].parentNode.removeChild(existing[i]);

    var parts = [];
    var anyPoint = null;
    series.forEach(function (s, si) {
      var pts = seriesPts[si];
      var p = pts && pts[idx];
      if (!p) return;
      anyPoint = p;
      var circle = document.createElementNS(svgns, 'circle');
      circle.setAttribute('class', 'om-chart-hover-marker');
      circle.setAttribute('cx', p.x);
      circle.setAttribute('cy', p.y);
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', s.color);
      circle.setAttribute('stroke', 'var(--surface)');
      circle.setAttribute('stroke-width', '1.5');
      svgEl.appendChild(circle);
      parts.push(s.label + ' ' + fmtThroughput(p.v));
    });
    if (!anyPoint) return;

    var tip = document.getElementById(containerId + '-tooltip');
    if (!tip) return;
    tip.textContent = parts.join(' · ');
    tip.style.display = 'block';
    var wrapRect = wrapEl.getBoundingClientRect();
    var svgRect = svgEl.getBoundingClientRect();
    var xPx = (anyPoint.x / CHART_VIEW_W) * svgRect.width + (svgRect.left - wrapRect.left);
    var yPx = (anyPoint.y / CHART_VIEW_H) * svgRect.height + (svgRect.top - wrapRect.top);
    tip.style.left = xPx + 'px';
    tip.style.top = yPx + 'px';
  }

  function handleDualChartHoverMove(containerId, series, clientX, svgEl, wrapEl) {
    var idx = nearestDualChartIndex(containerId, clientX, svgEl);
    if (idx < 0) return;
    var st = chartHover[containerId];
    if (st && st.idx === idx) return; // already showing this point
    chartHover[containerId] = { idx: idx };
    showDualChartHover(containerId, series, idx, svgEl, wrapEl);
  }

  function initDualChartHover(containerId, series) {
    var svg = document.getElementById(containerId);
    if (!svg) return; // not on this page
    var wrapEl = svg.closest('.om-chart-wrap');
    if (!wrapEl) return;
    svg.addEventListener('pointermove', function (e) { handleDualChartHoverMove(containerId, series, e.clientX, svg, wrapEl); });
    svg.addEventListener('pointerdown', function (e) { handleDualChartHoverMove(containerId, series, e.clientX, svg, wrapEl); });
    svg.addEventListener('pointerleave', function () { clearDualChartHover(containerId); });
    svg.addEventListener('pointerup', function () { clearDualChartHover(containerId); });
  }

  function renderHistoryCharts() {
    renderLineChart('om-hist-rsrp-chart', historySignalSamples, historyRsrp, RSRP_ZONES, RSRP_MIN, RSRP_MAX, false);
    renderLineChart('om-hist-speed-chart', historySignalSamples, function (r) { return r.dl_est_mbps; }, SPEED_ZONES, 0, 250, false);
    renderLineChart('om-hist-latency-chart', historyNetSamples, function (r) { return r.latency_ms; }, LATENCY_ZONES, 0, 250, true);
    renderLineChart('om-hist-jitter-chart', historyNetSamples, function (r) { return r.jitter_ms; }, JITTER_ZONES, 0, 50, true);
  }

  // One-time seed from the server's already-accumulated ring buffer — the
  // whole point of the server-side history files, so a freshly-opened
  // tab sees the preceding 5 minutes immediately rather than building up
  // from empty as live samples trickle in. Always assigns when the fetch
  // resolves, even if a live sample (from refreshState()/refreshNetState())
  // already landed first: state.sh is a much smaller/faster fetch than
  // history_signal.sh/history_net.sh, so in practice the first live poll
  // reliably wins that race — a "only seed if still empty" guard (the
  // previous version of this function) meant the seed almost never
  // actually ran, which is exactly the "only shows data since the page
  // loaded" bug this replaces. Safe to just overwrite: the server's
  // history file already reflects every poll cycle a live push would
  // have added anyway, so this never discards anything the array
  // wouldn't already have picked up from the source of truth.
  function seedHistoryOnce() {
    if (!document.getElementById('om-hist-rsrp-chart')) return; // not on this page

    fetch('/cgi-bin/history_signal.sh')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (Array.isArray(data)) {
          historySignalSamples = data.slice(-HISTORY_WINDOW_SAMPLES);
        }
        renderHistoryCharts();
      })
      .catch(function () {});

    fetch('/cgi-bin/history_net.sh')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (Array.isArray(data)) {
          historyNetSamples = data.slice(-HISTORY_WINDOW_SAMPLES);
        }
        renderHistoryCharts();
      })
      .catch(function () {});
  }

  function fmtCommitDate(v) {
    if (typeof v !== 'string' || !v || v === 'unknown') return '—';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  /* Same one-shot-on-load pattern as seedHistoryOnce above: installer.sh
     writes VERSION fresh on every install/update (see its "Resolving
     deployed commit info" step) and version.sh serves it as-is, so this
     only ever needs to be fetched once per page load, not on
     refreshState()'s poll cycle — see renderState()'s commit_sha/
     commit_date skip for why mixing it into that loop would be wrong.
     querySelectorAll, not querySelector: [data-field="commit_sha"] now
     matches twice on the System page (the shared footer's link, plus
     the Update card's own span) and once (footer only) everywhere
     else — a single querySelector would silently leave whichever one
     it didn't pick showing "—" forever. The footer's copy is an <a>;
     give it an href to the exact commit on GitHub, which a plain
     <span> (System page's card) doesn't have and shouldn't get. */
  function loadVersionInfo() {
    var shaEls = document.querySelectorAll('[data-field="commit_sha"]');
    var dateEls = document.querySelectorAll('[data-field="commit_date"]');
    if (!shaEls.length && !dateEls.length) return; // not on this page

    fetch('/cgi-bin/version.sh')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var sha = data.commit_sha;
        if (typeof sha === 'string' && sha !== 'unknown' && sha.length >= 7) {
          for (var i = 0; i < shaEls.length; i++) {
            var el = shaEls[i];
            el.textContent = sha.slice(0, 7);
            el.title = sha;
            if (el.tagName === 'A') el.href = REPO_URL + '/commit/' + sha;
          }
        }
        for (var j = 0; j < dateEls.length; j++) {
          dateEls[j].textContent = fmtCommitDate(data.commit_date);
        }
      })
      .catch(function () {});
  }

  // Same seed-on-load as seedHistoryOnce above, for the WAN page's
  // Bandwidth graphs and the Dashboard's Throughput graph (both consume
  // historyWanRateSamples, see wanChartsPresent above) — kept as its own
  // function rather than folded into seedHistoryOnce since that one is
  // gated on the Dashboard's om-hist-rsrp-chart existing, which is never
  // true on the WAN page.
  function seedWanHistoryOnce() {
    if (!wanChartsPresent()) return; // not on this page

    fetch('/cgi-bin/history_wan.sh')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (Array.isArray(data)) {
          historyWanRateSamples = data.slice(-HISTORY_WINDOW_SAMPLES);
        }
        renderWanBandwidthCharts();
        renderThroughputChart();
      })
      .catch(function () {});
  }

  function pushSignalHistorySample(state) {
    if (!document.getElementById('om-hist-rsrp-chart')) return; // not on this page
    pushCapped(historySignalSamples, {
      t: state._polled_at,
      lte_rsrp: state.signal_lte_rsrp,
      nr_rsrp: state.signal_nr_rsrp,
      dl_est_mbps: state.ca_dl_estimated_mbps
    });
    renderHistoryCharts();
  }

  function pushNetHistorySample(netState) {
    if (!document.getElementById('om-hist-latency-chart')) return; // not on this page
    pushCapped(historyNetSamples, { t: netState._polled_at, latency_ms: netState.icmp_avg_rtt_ms, jitter_ms: netState.icmp_jitter_ms });
    renderHistoryCharts();
  }

  /* ── Connectivity polling: separate endpoint, separate cadence ───────
     net_poller.sh writes net_state.json on its own schedule (as fast as
     every NET_ICMP_INTERVAL seconds, decoupled from POLL_INTERVAL) — see
     that script's header for why it's a standalone daemon. Mirrors
     refreshState()'s own fetch-faster-than-backend / gate-on-_polled_at
     pattern (same phase-lock pitfall applies here as there — see that
     function's comment) rather than reusing refreshState's timer
     directly, since the two endpoints update independently. Guarded on
     the card actually being present so pages without it don't poll at
     all, not just skip rendering. */
  var NET_FAST_POLL_MS = 2000;
  var netRefreshTimer = null;
  var lastSeenNetPolledAt = null;

  // Latest successful net_state.sh payload, cached (not just diffed)
  // so renderStatusHealth() below can read ping/connectivity-check
  // status regardless of which poll loop (this one, or refreshState's
  // own state.sh loop) most recently changed. Updated on every
  // successful fetch, not gated on _polled_at like the render calls
  // below — a stale-but-present netState is still useful input for the
  // health card even on a poll cycle with no new data to render.
  var lastNetState = null;

  function scheduleNetRefresh(delayMs) {
    if (netRefreshTimer) clearTimeout(netRefreshTimer);
    netRefreshTimer = setTimeout(refreshNetState, delayMs);
  }

  // Runs on every page now (guarded on the topbar's own container,
  // present everywhere), not just the Dashboard — the topbar's
  // Connectivity Check indicator (renderTopbarConnectivity) needs this
  // data globally. renderConnectivityCard/pushNetHistorySample keep
  // their own internal "not on this page" guards for their
  // Dashboard-only elements, so this broader guard doesn't change their
  // behavior on other pages.
  function refreshNetState() {
    if (!document.getElementById('om-topbar-signal')) return; // shouldn't happen, every page carries this
    fetch('/cgi-bin/net_state.sh')
      .then(function (r) { return r.json(); })
      .then(function (netState) {
        if (!netState._error) lastNetState = netState;
        if (!netState._error && netState._polled_at !== lastSeenNetPolledAt) {
          lastSeenNetPolledAt = netState._polled_at;
          renderConnectivityCard(netState);
          pushNetHistorySample(netState);
          renderTopbarConnectivity(netState);
          // Ping/connectivity-check status factor into the Status card
          // too, so it reacts to this poll loop as well as state.sh's —
          // re-render with whatever AT state is currently cached rather
          // than waiting for the next state.sh cycle.
          safeRender(renderStatusHealth, lastAtState);
        }
        scheduleNetRefresh(NET_FAST_POLL_MS);
      })
      .catch(function () {
        scheduleNetRefresh(NET_FAST_POLL_MS);
      });
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

  // Latest successful state.sh payload, cached so refreshNetState()'s
  // loop can re-render the Status card (which needs both AT state and
  // net state) when connectivity data changes, without waiting for
  // this loop's own next cycle — same reasoning as lastNetState above.
  var lastAtState = null;

  function scheduleRefresh(delayMs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshState, delayMs);
  }

  /* refreshState() used to call each render*(state) function directly
     in one chain — a throw from any single one (an unexpected/partial
     field shape) stopped every call after it that cycle AND fell into
     the fetch-layer .catch() below, mislabeling a rendering bug as
     "Unreachable" even though the modem answered fine. Wrapping each
     call isolates it: one bad card logs and skips itself, the other
     nine still update, and the "Unreachable" state stays reserved for
     actual fetch/parse failures. Fixed 2026-08-19. */
  function safeRender(fn, state) {
    try {
      fn(state);
    } catch (e) {
      console.error('[OpenModem] ' + (fn.name || 'render') + ' failed:', e);
    }
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
        if (!state._error) lastAtState = state;
        if (!state._error && state._polled_at !== lastSeenPolledAt) {
          lastSeenPolledAt = state._polled_at;
          safeRender(renderState, state);
          safeRender(renderSimSlots, state);
          safeRender(renderCarrierAggregation, state);
          safeRender(renderNetPrefs, state);
          safeRender(renderNetworkType, state);
          safeRender(renderNetworkRoaming, state);
          safeRender(renderSignalCard, state);
          safeRender(renderStatusHealth, state);
          safeRender(renderTopbarSignal, state);
          safeRender(renderCellTooltips, state);
          safeRender(renderStatusDots, state);
          safeRender(renderWanThroughput, state);
          safeRender(pushSignalHistorySample, state);
          safeRender(pushWanHistorySample, state);
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
  // installer.sh has its own server-side crash resilience (see git
  // history — "Make installer.sh and update.sh resilient to
  // failed/crashed updates"), but this poll loop only had a running
  // branch and a finished branch: if the running-marker were ever left
  // set with nothing left actually running, the user was stuck on
  // "Updating…" forever with no cancel or give-up message. Client-side
  // safety net, not a replacement for the server-side fix. 2026-08-19.
  var UPDATE_POLL_MAX_MS = 8 * 60 * 1000;
  var updatePollTimer = null;
  var updatePollStartedAt = null;

  function setUpdateStatus(text) {
    var el = document.getElementById('om-update-status');
    if (el) el.textContent = text;
  }

  function pollUpdateStatus() {
    fetch('/cgi-bin/update.sh?action=status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.running) {
          if (Date.now() - updatePollStartedAt > UPDATE_POLL_MAX_MS) {
            clearInterval(updatePollTimer);
            updatePollTimer = null;
            setUpdateStatus('Update is taking much longer than expected — it may have hung. Check the modem directly, or reload this page once it responds again.');
            return;
          }
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
    confirmDialog({
      severity: 'high',
      title: 'Update OpenModem',
      message: 'This downloads and installs the latest OpenModem from GitHub, ' +
        'replacing the current install. It can take several minutes and ' +
        'will restart all services — you may briefly lose connection to ' +
        'this page.',
      confirmLabel: 'Install Update',
      onConfirm: function () {
        setUpdateStatus('Starting update…');
        fetch('/cgi-bin/update.sh?action=start&confirm=1')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.error) {
              setUpdateStatus('Could not start update: ' + data.error);
              return;
            }
            setUpdateStatus('Update started…');
            updatePollStartedAt = Date.now();
            updatePollTimer = setInterval(pollUpdateStatus, UPDATE_POLL_MS);
          })
          .catch(function (err) {
            setUpdateStatus('Could not start update: ' + err);
          });
      }
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
      severity: 'high',
      confirm: 'This reboots the modem (AT+CFUN=1,1). The connection will drop for about 30 seconds.'
    },
    radio_off: {
      cmd: 'AT+CFUN=0',
      severity: 'high',
      confirm: 'This turns the radio off (AT+CFUN=0). The modem stays powered but loses all cellular connectivity until turned back on — there is no auto-recovery, you have to come back and press Radio On.'
    },
    radio_on: {
      cmd: 'AT+CFUN=1',
      severity: 'medium',
      confirm: 'This restores full radio function (AT+CFUN=1).'
    }
  };

  function initPowerButtons() {
    var buttons = document.querySelectorAll('[data-power-action]');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        var action = POWER_ACTIONS[btn.getAttribute('data-power-action')];
        if (!action) return;
        btn.addEventListener('click', function () {
          confirmDialog({
            severity: action.severity,
            title: btn.textContent,
            message: action.confirm,
            confirmLabel: btn.textContent,
            onConfirm: function () {
              btn.disabled = true;
              sendAtCommand(action.cmd).finally(function () { btn.disabled = false; });
            }
          });
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

  /* ── Generic confirm modal ───────────────────────────────────────────
     Replaces window.confirm() for every destructive/disruptive action
     on the site (Update, Reboot/Radio Off/Radio On, Apply bars, Reset
     Counter, SIM slot switch). A plain browser confirm() looks and
     behaves identically no matter what it's confirming — a user who's
     clicked through ten harmless ones learns to click through the
     eleventh (a reboot) just as fast, without reading it. This modal
     instead scales its icon/color/shape with severity: low = info
     (blue circle), medium = warning (amber triangle), high = critical
     (red octagon) — same shape vocabulary as the Status card, so
     "this looks scarier" tracks "this actually is more disruptive"
     even for a colorblind reader. One shared overlay, built lazily on
     first use and reused for every call (same reasoning as the Carrier
     Scan modal being one overlay reused across its confirm/scanning/
     results phases), rather than a modal per page/action. */
  var CONFIRM_SEVERITY_ICON = { low: 'info', medium: 'warning', high: 'critical' };

  function ensureConfirmModal() {
    if (document.getElementById('om-confirm-modal')) return;
    var el = document.createElement('div');
    el.className = 'om-modal-overlay';
    el.id = 'om-confirm-modal';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="om-modal om-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="om-confirm-title">' +
        '<div class="om-modal-header">' +
          '<div class="om-confirm-header-left">' +
            '<span class="om-confirm-icon" id="om-confirm-icon"></span>' +
            '<h3 id="om-confirm-title"></h3>' +
          '</div>' +
          '<button type="button" class="om-modal-close" id="om-confirm-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="om-modal-body">' +
          '<p id="om-confirm-message"></p>' +
          '<div class="om-modal-actions">' +
            '<button type="button" class="om-secondary" id="om-confirm-cancel">Cancel</button>' +
            '<button type="button" id="om-confirm-ok"></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    function close() { closeModal('om-confirm-modal'); }
    document.getElementById('om-confirm-close').addEventListener('click', close);
    document.getElementById('om-confirm-cancel').addEventListener('click', close);
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.classList.contains('open')) close();
    });
  }

  /* opts: { severity: 'low'|'medium'|'high', title, message, confirmLabel, onConfirm } */
  function confirmDialog(opts) {
    ensureConfirmModal();
    var iconKey = CONFIRM_SEVERITY_ICON[opts.severity] || 'warning';
    var color = STATUS_COLORS[iconKey];

    document.querySelector('#om-confirm-modal .om-modal').style.setProperty('--sev-color', color);
    var iconEl = document.getElementById('om-confirm-icon');
    iconEl.innerHTML = statusIconSvg(iconKey);
    iconEl.style.color = color;
    document.getElementById('om-confirm-title').textContent = opts.title;
    document.getElementById('om-confirm-message').textContent = opts.message;

    var okBtn = document.getElementById('om-confirm-ok');
    // Fresh clone strips whatever click listener a previous confirmDialog()
    // call bound — the OK button element itself is reused across every
    // confirmation, not recreated.
    var newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.textContent = opts.confirmLabel || 'Continue';
    newOk.className = opts.severity === 'high' ? 'om-danger' : '';
    newOk.addEventListener('click', function () {
      closeModal('om-confirm-modal');
      opts.onConfirm();
    });

    openModal('om-confirm-modal');
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

  /* Live "currently roaming" status (Dashboard Network card) — derived
     from registration state (REG_LABELS' 5 = "Roaming"), NOT
     net_data_roaming (AT+QNWCFG="data_roaming"): that field is the
     roaming-*permission* setting (whether the modem is allowed to
     roam), which stays true/false regardless of whether the device is
     actually on its home network right now. Confirmed live
     2026-08-19: net_data_roaming read true while reg_lte read 1
     (Registered/home) on a connection the user confirmed was on home
     service — using net_data_roaming here was wrong. Checks all three
     registration domains since roaming can show on whichever RAT/CS
     leg is actually active. */
  function networkRoamingActive(state) {
    return state.reg_lte === 5 || state.reg_nr === 5 || state.reg_creg === 5;
  }

  function renderNetworkRoaming(state) {
    var el = document.getElementById('om-net-roaming');
    if (!el) return; // not on this page
    el.textContent = networkRoamingActive(state) ? 'Yes' : 'No';
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

    var carrierEl = document.getElementById('om-sig-carrier-name');
    if (carrierEl) carrierEl.textContent = state.carrier_name || '—';
    var nettypeEl = document.getElementById('om-sig-network-type');
    if (nettypeEl) nettypeEl.textContent = networkTypeText(state);
  }

  /* ── Status/Health card (Dashboard) ──────────────────────────────────
     Quick-glance "why don't I have a connection" answer — walks a
     fixed priority list of if/then checks and surfaces the single
     worst one, rather than listing every issue at once (a beginner
     wants one clear answer, not a checklist to interpret). Exhaustive
     by design: every field that could plausibly explain "why don't I
     have a connection" gets its own check — SIM, registration
     (denied/not registered), signal strength, a full ping+204 outage,
     each connectivity check individually, WAN active, latency, jitter,
     estimated bandwidth, and roaming — not just the handful checked in
     the first pass.

     Order is deliberate, worst/most-fundamental first: a SIM problem
     makes every reading below it meaningless, so it's checked first;
     denied/not-registered next for the same reason; a full ping+204
     outage while registered points straight at a broken data path
     (APN/carrier-side), which is more actionable than "signal is
     weak" so it's checked before signal. Latency/jitter/estimated
     bandwidth are quality-degradation checks, not outright failures,
     so they sit below the binary connectivity checks; Roaming is
     last since it's informational (cost heads-up), not a problem.

     Severity: reserved 'critical' for states that mean the modem
     fundamentally cannot reach the network at all (no/bad SIM, denied,
     not registered, total ping+204 outage). Everything else — signal,
     a single connectivity check failing, WAN inactive, latency/
     jitter/bandwidth in their zone table's worst (red) tier, roaming —
     is 'warning': the same red-bucket zones used elsewhere on the site
     (RSRP_ZONES/LATENCY_ZONES/JITTER_ZONES/SPEED_ZONES) are the
     trigger, but landing in one doesn't necessarily mean "broken", so
     it's flagged rather than escalated to critical. Reuses those same
     zone tables and currentRsrp/networkRoamingActive — this card
     doesn't introduce a second source of truth for any of them. Reads
     netState (net_state.sh's ping/204 fields) alongside state
     (state.sh's AT-derived fields) since a full picture needs both. */
  function computeHealthStatus(state, netState) {
    netState = netState || {};

    if (state.sim_status === null || state.sim_status === undefined) {
      return {
        level: 'critical',
        title: 'No SIM Detected',
        detail: 'No response from a SIM card. Check that one is inserted in the active slot.'
      };
    }
    if (state.sim_status !== 'READY') {
      return {
        level: 'critical',
        title: 'SIM Issue',
        detail: 'SIM status: ' + state.sim_status + '. Check the SIM page for details.'
      };
    }

    var lteReg = state.reg_lte, nrReg = state.reg_nr;
    var registered = lteReg === 1 || lteReg === 5 || nrReg === 1 || nrReg === 5;
    var denied = lteReg === 3 || nrReg === 3;

    if (denied) {
      return {
        level: 'critical',
        title: 'Registration Denied',
        detail: 'The network rejected registration — usually an account or SIM problem with your carrier, not a signal problem.'
      };
    }
    if (!registered) {
      return {
        level: 'critical',
        title: 'Not Registered',
        detail: 'Not registered on LTE or 5G yet. This can take a minute after boot, or may mean weak coverage here.'
      };
    }

    var icmpStatus = netState.icmp_status;
    var check204Status = netState.check204_status;
    if (icmpStatus === 'offline' && check204Status === 'offline') {
      return {
        level: 'critical',
        title: 'No Internet',
        detail: 'Registered on the network, but both connectivity checks are failing — the data connection isn\'t reaching the internet.'
      };
    }

    var rsrp = currentRsrp(state);
    if (typeof rsrp === 'number') {
      var rsrpLabel = sigZoneLabel(rsrp, RSRP_ZONES);
      if (rsrpLabel === 'Critical') {
        return {
          level: 'warning',
          title: 'Critical Signal',
          detail: 'Signal strength is critically weak (' + rsrp + ' dBm). Reposition the modem/antenna for better reception.'
        };
      }
      if (rsrpLabel === 'Poor') {
        return {
          level: 'warning',
          title: 'Weak Signal',
          detail: 'Signal strength is poor (' + rsrp + ' dBm). The connection may be slow or drop intermittently.'
        };
      }
    }

    if (icmpStatus === 'offline') {
      return {
        level: 'warning',
        title: 'Ping Offline',
        detail: 'The ping connectivity check is failing, even though the data connection is active.'
      };
    }
    if (check204Status === 'offline') {
      return {
        level: 'warning',
        title: 'Connectivity Check Failed',
        detail: 'The HTTP connectivity check is failing, even though the data connection is active.'
      };
    }

    if (state.wan_active === false) {
      return {
        level: 'warning',
        title: 'No Data Connection',
        detail: 'Registered on the network, but the data connection (WAN) isn\'t active. Check the APN on the WAN page.'
      };
    }

    var latency = netState.icmp_avg_rtt_ms;
    if (typeof latency === 'number' && ascZoneLabel(latency, LATENCY_ZONES) === 'Critical') {
      return {
        level: 'warning',
        title: 'High Latency',
        detail: 'Latency is critically high (' + latency + ' ms). Calls, video, and gaming will likely suffer.'
      };
    }

    var jitter = netState.icmp_jitter_ms;
    if (typeof jitter === 'number' && ascZoneLabel(jitter, JITTER_ZONES) === 'Critical') {
      return {
        level: 'warning',
        title: 'High Jitter',
        detail: 'Jitter is critically high (' + jitter + ' ms). Calls and video may stutter even if speed looks fine.'
      };
    }

    var estSpeed = state.ca_dl_estimated_mbps;
    if (typeof estSpeed === 'number' && sigZoneLabel(estSpeed, SPEED_ZONES) === 'Critical') {
      return {
        level: 'warning',
        title: 'Low Estimated Bandwidth',
        detail: 'Estimated downlink speed is critically low (' + estSpeed + ' Mbps) based on current carrier bandwidth.'
      };
    }

    if (networkRoamingActive(state)) {
      return {
        level: 'warning',
        title: 'Roaming',
        detail: 'Connected, but currently roaming off your home network — this may carry extra cost depending on your plan.'
      };
    }

    // No detail text here by design — "All Good" is the one state a
    // beginner doesn't need an explanation for, and every other branch
    // above already supplies one.
    return { level: 'good', title: 'All Good', detail: '' };
  }

  function renderStatusHealth(state) {
    var iconEl = document.getElementById('om-status-icon');
    var titleEl = document.getElementById('om-status-title');
    var detailEl = document.getElementById('om-status-detail');
    if (!iconEl || !state) return; // not on this page, or no AT state cached yet

    var health = computeHealthStatus(state, lastNetState);
    var color = STATUS_COLORS[health.level];

    iconEl.innerHTML = statusIconSvg(health.level);
    iconEl.style.color = color;
    titleEl.textContent = health.title;
    titleEl.style.color = color;
    detailEl.textContent = health.detail;
    detailEl.style.display = health.detail ? '' : 'none';
  }

  /* ── Topbar signal indicator (every page) ────────────────────────────
     Bars + carrier + network type, always visible regardless of which
     page you're on — same reasoning as moving connection status into
     the shared footer: this is global state, not page-specific.
     Smaller bar heights than the Dashboard card (topbar is ~56px
     tall), same tier-boundary logic via sigBarsHtml(). Updates its own
     two sub-elements (initShell built the skeleton) rather than
     rebuilding #om-topbar-signal's whole innerHTML, so it can't race
     renderTopbarConnectivity below — see initShell's comment. */
  var TOPBAR_SIG_BAR_HEIGHTS = [5, 8, 11, 14, 17];

  function renderTopbarSignal(state) {
    var barsEl = document.getElementById('om-topbar-sigbars');
    var carrierEl = document.getElementById('om-topbar-carrier');
    var nettypeEl = document.getElementById('om-topbar-nettype');
    if (!barsEl || !carrierEl || !nettypeEl) return; // shouldn't happen, every page carries this

    var val = currentRsrp(state);
    var has = typeof val === 'number';
    var color = has ? sigZoneColor(val, RSRP_ZONES) : '#5c5c5e';
    barsEl.innerHTML = sigBarsHtml(val, has, color, TOPBAR_SIG_BAR_HEIGHTS, 'om-topbar-sigbar');
    carrierEl.textContent = state.carrier_name || '—';
    nettypeEl.textContent = networkTypeText(state);
  }

  /* Connectivity Check (the HTTP 204 check, not the ICMP ping check) —
     shown to the right of the carrier/network text on every page's
     topbar, since it's global "is the internet actually reachable"
     state, same reasoning as the signal indicator beside it. Driven by
     net_state.sh/refreshNetState, a separate poll cycle from the AT
     state above it, hence its own sub-elements (see initShell). Static
     halo, not flash-on-refresh — binary online/offline, same as the
     Connectivity card's own dots, not a live-varying measurement. */
  function renderTopbarConnectivity(netState) {
    var textEl = document.getElementById('om-topbar-conn-text');
    var dotEl = document.getElementById('om-topbar-conn-dot');
    if (!textEl) return; // shouldn't happen, every page carries this

    var status = netState.check204_status;
    textEl.textContent = connStatusText(status);
    if (dotEl) setRingDotColor(dotEl, connStatusColor(status), false);
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

    confirmDialog({
      // Band lock elevated to high: unlike a mode/roaming toggle, locking
      // to the wrong bands can silently drop all signal with no obvious
      // error to point at — a bigger blast radius than "briefly reconnect".
      severity: bandDirty ? 'high' : 'medium',
      title: 'Apply Cellular Changes',
      message: 'Apply changes to ' + disruptive.join(' and ') + '? The connection may briefly reconnect.' +
        (bandDirty ? ' Locking to the wrong bands can disconnect you from your carrier entirely — use "All" in Band Lock to reset if that happens.' : ''),
      confirmLabel: 'Apply Changes',
      onConfirm: function () {
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

  /* mimo_layers is at_poller.sh's highest layer count observed for this
     exact carrier (PCI+EARFCN) within a trailing rolling window
     (MIMO_MAX_WINDOW_S, default 60min), not the instantaneous
     AT+QNWCFG="lte_mimo_info"/"nr5g_mimo_info" reading — that live
     reading bounces with every idle/loaded transition (confirmed by
     chaining a real download during testing: 0/1/2/4 layers observed
     rising and falling with load), so the server tracks a windowed-max
     cache per carrier instead (see update_mimo_max_cache's header
     comment) and this field is null until that cache has at least one
     unexpired observation for the carrier. Shown as "NxN" since the
     field reports active DL spatial layers and this hardware's behavior
     is symmetric. Its own column now, previously folded into BW's cell
     text. */
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

    function doLanApply() {
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

    if (!disruptive.length) {
      doLanApply();
      return;
    }

    var msg = 'Apply changes to ' + disruptive.join(' and ') + '? This may briefly disconnect the current session';
    if (ipDirty) msg += ' — reconnect at ' + current.routerIp + ' if the router IP changed';

    confirmDialog({
      // A wrong router IP/DHCP range can genuinely lock you out of the
      // LAN (not just "briefly reconnect"), so that case is high; a
      // plain mode change is medium.
      severity: ipDirty ? 'high' : 'medium',
      title: 'Apply LAN Changes',
      message: msg + '.',
      confirmLabel: 'Apply Changes',
      onConfirm: doLanApply
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
        confirmDialog({
          severity: 'low',
          title: 'Reset Data Counter',
          message: 'Reset the WAN data usage counter to zero? This only affects the number shown here, not your actual data connection.',
          confirmLabel: 'Reset Counter',
          onConfirm: function () {
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
          }
        });
      });
    }
  }

  /* ── Path MTU (WAN page, TTL Spoofing card) ──────────────────────────
     Button-triggered, like Reset Counter — a handful of pings (a few
     hundred ms to a couple seconds), not disruptive enough to need a
     confirm dialog. cgi-bin/mtu_test.sh reports both the WAN interface's
     configured MTU and a binary-searched "verified" MTU (largest DF-bit
     ping that actually got a reply) — see that script's header for why
     both numbers matter. */
  function initWanMtuTest() {
    var btn = document.getElementById('om-wan-mtu-test');
    if (!btn) return; // not on this page

    var configuredEl = document.getElementById('om-wan-mtu-configured');
    var effectiveEl = document.getElementById('om-wan-mtu-effective');
    var statusEl = document.getElementById('om-wan-mtu-status');

    btn.addEventListener('click', function () {
      btn.disabled = true;
      statusEl.textContent = 'Testing…';
      fetch('/cgi-bin/mtu_test.sh')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.success) {
            statusEl.textContent = 'Failed: ' + data.error;
            return;
          }
          configuredEl.textContent = data.configured_mtu + ' bytes';
          effectiveEl.textContent = (data.effective_path_mtu != null)
            ? (data.effective_path_mtu + ' bytes')
            : 'Inconclusive';
          statusEl.textContent = data.note || '';
        })
        .catch(function (err) { statusEl.textContent = 'Failed: ' + err; })
        .finally(function () { btn.disabled = false; });
    });
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

  /* Unlike every other disruptive action here (Power buttons, Apply
     bars — see the .disabled=true/.finally(...disabled=false) pattern
     throughout this file), these buttons had no re-entrancy guard even
     though the switch they trigger is explicitly documented to
     disconnect the whole web UI for several seconds — a double-tap in
     that visible gap queued two disruptive AT+QUIMSLOT reinit cycles
     back to back. Fixed 2026-08-19. */
  function setSimSlotButtonsDisabled(buttons, disabled) {
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = disabled;
  }

  function applySimSlot(slot, buttons) {
    var statusEl = document.getElementById('om-sim-slot-status');
    confirmDialog({
      severity: 'high',
      title: 'Switch SIM Slot',
      message: 'Switch to SIM' + slot + '? This briefly disconnects the modem (including this web UI) while it reinitializes.',
      confirmLabel: 'Switch to SIM' + slot,
      onConfirm: function () {
        setSimSlotButtonsDisabled(buttons, true);
        statusEl.textContent = 'Switching…';
        fetch('/cgi-bin/sim_action.sh?action=set_slot&slot=' + slot)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            statusEl.textContent = data.success ? data.message : ('Failed: ' + data.error);
          })
          .catch(function (err) { statusEl.textContent = 'Failed: ' + err; })
          .finally(function () { setSimSlotButtonsDisabled(buttons, false); });
      }
    });
  }

  function initSimSlotToggle() {
    var group = document.getElementById('om-sim-slot-toggle');
    if (!group) return; // not on this page
    var buttons = group.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { applySimSlot(btn.getAttribute('data-slot'), buttons); });
      })(buttons[i]);
    }
  }

  window.OM = { init: initShell };

  document.addEventListener('DOMContentLoaded', function () {
    refreshState();
    refreshNetState();
    seedHistoryOnce();
    seedWanHistoryOnce();
    loadVersionInfo();
    initChartHover('om-hist-rsrp-chart', 'dBm', RSRP_ZONES, false);
    initChartHover('om-hist-speed-chart', 'Mbps', SPEED_ZONES, false);
    initChartHover('om-hist-latency-chart', 'ms', LATENCY_ZONES, true);
    initChartHover('om-hist-jitter-chart', 'ms', JITTER_ZONES, true);
    initChartHover('om-wan-rx-chart', 'Mbps', WAN_RX_ZONE, false);
    initChartHover('om-wan-tx-chart', 'Mbps', WAN_TX_ZONE, false);
    initDualChartHover('om-hist-throughput-chart', THROUGHPUT_SERIES);
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
    initWanMtuTest();
    initWanInternet();
    initSimSlotToggle();
  });
})();
