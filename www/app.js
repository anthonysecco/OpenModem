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

  function initShell(activeKey) {
    var links = buildNavLinks(activeKey);

    var sidebar = document.getElementById('om-sidebar-nav');
    if (sidebar) sidebar.innerHTML = links;

    var tabbar = document.getElementById('om-tabbar-nav');
    if (tabbar) tabbar.innerHTML = links;
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
    0: 'Not registered', 1: 'Registered (home)', 2: 'Searching',
    3: 'Denied', 4: 'Unknown', 5: 'Registered (roaming)'
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

  var FORMATTERS = {
    reg_lte: fmtReg, reg_nr: fmtReg, reg_creg: fmtReg,
    signal_lte_rsrp: fmtDbm, signal_lte_rsrq: fmtDbm, signal_lte_sinr: fmtDbm,
    signal_nr_rsrp: fmtDbm, signal_nr_rsrq: fmtDbm, signal_nr_sinr: fmtDbm,
    wan_active: fmtBool,
    ca_total_bw_mhz: fmtMhz,
    ca_dl_estimated_mbps: fmtMbps, ca_dl_maximum_mbps: fmtMbps,
    band_pref_lte: fmtBands, band_pref_nr5g: fmtBands,
    lan_dns_mode: fmtDnsMode,
    wan_data_rx: fmtBytes, wan_data_tx: fmtBytes,
    sim_active_slot: fmtSimSlot
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

  /* ── Polling: adapts to the backend's actual interval ──────────────
     Self-rescheduling setTimeout rather than a fixed setInterval, so if
     _poll_interval_s ever changes (operator edits POLL_INTERVAL in
     openmodem.conf and restarts the poller) the frontend picks up the
     new cadence on its very next fetch instead of staying out of sync. */
  var DEFAULT_POLL_MS = 10000;
  var MIN_POLL_MS = 3000;
  var refreshTimer = null;

  function scheduleRefresh(delayMs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshState, delayMs);
  }

  function refreshState() {
    var statusEl = document.getElementById('om-conn-status');
    fetch('/cgi-bin/state.sh')
      .then(function (r) { return r.json(); })
      .then(function (state) {
        if (statusEl) {
          statusEl.textContent = state._error ? state._message : 'Connected';
          statusEl.classList.toggle('bad', !!state._error);
        }
        if (!state._error) {
          renderState(state);
          renderSimSlots(state);
          renderNeighborCells(state);
          renderCarrierAggregation(state);
          setLastPolledAt(state._polled_at);
        }
        var intervalMs = (state._poll_interval_s ? state._poll_interval_s * 1000 : DEFAULT_POLL_MS);
        scheduleRefresh(Math.max(intervalMs, MIN_POLL_MS));
      })
      .catch(function () {
        if (statusEl) {
          statusEl.textContent = 'Unreachable';
          statusEl.classList.add('bad');
        }
        scheduleRefresh(DEFAULT_POLL_MS);
      });
  }

  /* ── Live "updated Xs ago" timer ────────────────────────────────────
     Ticks every second independent of the actual poll cadence, so the
     dashboard visibly counts up in real time rather than only changing
     when a fetch happens to land. */
  var lastPolledAt = null;

  function setLastPolledAt(v) { if (v) lastPolledAt = v; }

  function tickAge() {
    var nodes = document.querySelectorAll('[data-field="_polled_at"]');
    if (!nodes.length) return;
    var text = '—';
    if (lastPolledAt) {
      var secs = Math.max(0, Math.round(Date.now() / 1000 - lastPolledAt));
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
     Cellular (Band Lock) and LAN each have exactly one settings-apply
     button, shown only while something differs from the last-loaded/
     last-applied baseline, rather than a button per card. This module
     only owns show/hide + the click binding; each page tracks its own
     baseline and owns the confirm()/fetch/status-text logic, since
     "what changed" and "how to apply it" differ per page. Only one of
     initBandLock()/initLanConfig() proceeds past its own page-specific
     guard on any given page, so binding the shared #om-apply-btn from
     both is safe — only one is ever actually on the page at a time. */
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

  function checkBandLockDirty() {
    if (!bandLockBaseline) return;
    applyBarToggle(JSON.stringify(bandLockSnapshot()) !== JSON.stringify(bandLockBaseline));
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
        applyBarToggle(false);
      })
      .catch(function () { /* leave grids at their default (unchecked) state */ });
  }

  function bandLockApply() {
    var statusEl = document.getElementById('om-apply-status');
    var btn = document.getElementById('om-apply-btn');
    var lte = getBandGridSelected('om-bandlock-lte-grid');
    var nr = getBandGridSelected('om-bandlock-nr-grid');
    if (!lte.length && !nr.length) {
      statusEl.textContent = 'Select at least one band.';
      return;
    }
    if (!window.confirm('This changes the band lock. The network may briefly reconnect. Continue?')) return;

    btn.disabled = true;
    statusEl.textContent = 'Applying…';
    var qs = [];
    if (lte.length) qs.push('lte_bands=' + encodeURIComponent(lte.join(',')));
    if (nr.length) qs.push('nr_bands=' + encodeURIComponent(nr.join(',')));

    fetch('/cgi-bin/band_lock.sh?action=set&' + qs.join('&'))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        statusEl.textContent = data.success ? data.message : ('Failed: ' + data.error);
        if (data.success) {
          bandLockBaseline = bandLockSnapshot();
          applyBarToggle(false);
        }
      })
      .catch(function (err) {
        statusEl.textContent = 'Failed: ' + err;
      })
      .finally(function () { btn.disabled = false; });
  }

  function initBandLock() {
    var grid = document.getElementById('om-bandlock-lte-grid');
    if (!grid) return;

    renderBandGrid('om-bandlock-lte-grid', LTE_BANDS, 'B');
    renderBandGrid('om-bandlock-nr-grid', NR_BANDS, 'n');
    grid.addEventListener('change', checkBandLockDirty);
    document.getElementById('om-bandlock-nr-grid').addEventListener('change', checkBandLockDirty);
    loadCurrentBandLock();

    var lteAll = document.getElementById('om-bandlock-lte-all');
    var lteNone = document.getElementById('om-bandlock-lte-none');
    var nrAll = document.getElementById('om-bandlock-nr-all');
    var nrNone = document.getElementById('om-bandlock-nr-none');
    if (lteAll) lteAll.addEventListener('click', function () { setBandGridAll('om-bandlock-lte-grid', true); checkBandLockDirty(); });
    if (lteNone) lteNone.addEventListener('click', function () { setBandGridAll('om-bandlock-lte-grid', false); checkBandLockDirty(); });
    if (nrAll) nrAll.addEventListener('click', function () { setBandGridAll('om-bandlock-nr-grid', true); checkBandLockDirty(); });
    if (nrNone) nrNone.addEventListener('click', function () { setBandGridAll('om-bandlock-nr-grid', false); checkBandLockDirty(); });

    bindApplyButton(bandLockApply);
  }

  /* ── Carrier scan (Cellular page) ──────────────────────────────────
     A real scan takes up to ~2 minutes and briefly interrupts data
     service while the modem searches — confirm() warns about both. */
  var STATUS_LABELS = { 0: 'Unknown', 1: 'Available', 2: 'Current', 3: 'Forbidden' };

  function renderScanResults(operators) {
    var list = document.getElementById('om-scan-results');
    if (!list) return;
    if (!operators || !operators.length) {
      list.innerHTML = '<p class="om-note">No operators found.</p>';
      return;
    }
    list.innerHTML = operators.map(function (op) {
      return '<div class="om-row"><span class="om-row-label">' +
        escapeHtml(op.name) + ' (' + escapeHtml(op.plmn) + ')</span><span>' +
        (STATUS_LABELS[op.status] || op.status) + '</span></div>';
    }).join('');
  }

  function initCarrierScan() {
    var btn = document.getElementById('om-scan-btn');
    if (!btn) return;
    var statusEl = document.getElementById('om-scan-status');

    btn.addEventListener('click', function () {
      if (!window.confirm(
        'Are you sure? Scanning for carriers (AT+COPS=?) will disrupt ' +
        'connectivity for up to 2 minutes while the modem searches. ' +
        'Click Cancel to back out, or OK to proceed.'
      )) return;

      btn.disabled = true;
      statusEl.textContent = 'Scanning… this can take up to 2 minutes.';
      document.getElementById('om-scan-results').innerHTML = '';

      fetch('/cgi-bin/carrier_scan.sh')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) {
            statusEl.textContent = 'Scan failed: ' + data.error;
            return;
          }
          statusEl.textContent = 'Found ' + data.operators.length + ' operator(s).';
          renderScanResults(data.operators);
        })
        .catch(function (err) {
          statusEl.textContent = 'Scan failed: ' + err;
        })
        .finally(function () { btn.disabled = false; });
    });
  }

  /* ── Neighbor cells (Cellular page) ──────────────────────────────────
     AT+QENG="neighbourcell" only ever returns LTE entries on this
     hardware — "Tech" defaults to "LTE" via c.rat, kept as a real field
     read rather than a hardcoded string so a future NR neighbor source
     (a different AT command) could populate "5G NR" without a table
     rework. Rows are grouped by EARFCN (same-frequency neighbors sit
     together), each group ordered by its own strongest RSRP, and
     groups themselves ordered by their strongest RSRP too — so the
     single best neighbor overall is always the first row, and every
     group's members are internally sorted the same way.

     The AT command has no band field, only EARFCN — Band is computed
     from it here ("B2 (1900)", no tech prefix since that's its own
     column now) via a copy of QuecControl's EARFCN→band range table
     (3GPP-standard allocations, not modem-specific) plus each band's
     commonly-cited nominal/colloquial frequency, not a precise
     per-EARFCN calculation. */
  var LTE_EARFCN_BAND_RANGES = [
    [0,599,1],[600,1199,2],[1200,1949,3],[1950,2399,4],[2400,2649,5],
    [2650,2749,6],[2750,3449,7],[3450,3799,8],[3800,4149,9],[4150,4749,10],
    [4750,4999,11],[5000,5179,12],[5180,5279,13],[5280,5379,14],
    [5730,5849,17],[5850,5999,18],[6000,6149,19],[6150,6449,20],
    [6450,6599,21],[6600,7399,22],[7500,7699,23],[7700,8039,24],
    [8040,8689,25],[8690,9039,26],[9040,9209,27],[9210,9659,28],
    [9660,9769,29],[9770,9869,30],[9870,9919,31],[9920,10359,32],
    [36000,36199,33],[36200,36349,34],[36350,36949,35],[36950,37549,36],
    [37550,37749,37],[37750,38249,38],[38250,38649,39],[38650,39649,40],
    [39650,41589,41],[41590,43589,42],[43590,45589,43],[45590,46589,44],
    [46590,46789,45],[46790,54539,46],[54540,55239,47],[55240,56739,48],
    [56740,58239,49],[58240,59089,50],[59090,59139,51],[65536,66435,65],
    [66436,67335,66],[67336,67535,67],[67536,67835,68],[67836,68335,69],
    [68336,68585,70],[68586,68935,71],[68936,68985,72],[68986,69035,73],
    [69036,69465,74],[69466,70315,75],[70316,70365,76]
  ];

  var LTE_BAND_NOMINAL_MHZ = {
    1: 2100, 2: 1900, 3: 1800, 4: 1700, 5: 850, 7: 2600, 8: 900,
    12: 700, 13: 700, 14: 700, 17: 700, 18: 800, 19: 800, 20: 800,
    25: 1900, 26: 850, 28: 700, 29: 700, 30: 2300, 32: 1500, 34: 2000,
    38: 2600, 39: 1900, 40: 2300, 41: 2500, 42: 3500, 43: 3700,
    46: 5200, 48: 3600, 65: 2100, 66: 1700, 67: 700, 68: 700, 69: 2600,
    70: 2000, 71: 600
  };

  function lteEarfcnToBand(earfcn) {
    var e = parseInt(earfcn, 10);
    if (isNaN(e)) return null;
    for (var i = 0; i < LTE_EARFCN_BAND_RANGES.length; i++) {
      var r = LTE_EARFCN_BAND_RANGES[i];
      if (e >= r[0] && e <= r[1]) return r[2];
    }
    return null;
  }

  function fmtNeighborBand(earfcn) {
    var band = lteEarfcnToBand(earfcn);
    if (band === null) return '—';
    var mhz = LTE_BAND_NOMINAL_MHZ[band];
    return 'B' + band + (mhz ? ' (' + mhz + ')' : '');
  }

  function renderNeighborCells(state) {
    var tbody = document.getElementById('om-neighbor-tbody');
    if (!tbody) return; // not on this page

    var cells = state.neighbor_cells;
    if (!Array.isArray(cells) || !cells.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="om-note">No neighbor cell data available.</td></tr>';
      return;
    }

    var groups = {};
    var order = [];
    cells.forEach(function (c) {
      var key = c.earfcn || '';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(c);
    });

    var byRsrpDesc = function (a, b) { return (b.rsrp || -999) - (a.rsrp || -999); };
    var sortedGroups = order
      .map(function (key) {
        var entries = groups[key].slice().sort(byRsrpDesc);
        return { entries: entries, best: entries[0].rsrp || -999 };
      })
      .sort(function (a, b) { return b.best - a.best; });

    var rows = [];
    sortedGroups.forEach(function (g) {
      g.entries.forEach(function (c) {
        rows.push(
          '<tr>' +
          '<td>' + escapeHtml(c.earfcn || '—') + '</td>' +
          '<td>' + escapeHtml(c.pcid || '—') + '</td>' +
          '<td>' + escapeHtml(c.rat || 'LTE') + '</td>' +
          '<td>' + escapeHtml(fmtNeighborBand(c.earfcn)) + '</td>' +
          '<td>' + (typeof c.rsrp === 'number' ? c.rsrp + ' dBm' : '—') + '</td>' +
          '</tr>'
        );
      });
    });
    tbody.innerHTML = rows.join('');
  }

  /* ── Carrier Aggregation (Cellular page) ─────────────────────────────
     ca_bands carries the richer per-carrier shape at_poller.sh's
     collect_carrier_aggregation/compute_ca_throughput now writes:
     bw_mhz and dl_estimated_mbps/dl_maximum_mbps are computed
     server-side, so this is purely rendering — no throughput math here.
     Carrier color is assigned by array position (PCC first, then each
     SCC in modem-reported order) and reused for both the bandwidth bar
     segment and its legend dot. */
  var CA_SEG_CLASSES = ['om-ca-seg-0', 'om-ca-seg-1', 'om-ca-seg-2', 'om-ca-seg-3'];

  function renderCarrierAggregation(state) {
    var bar = document.getElementById('om-ca-bwbar');
    var legend = document.getElementById('om-ca-legend');
    var tbody = document.getElementById('om-ca-tbody');
    if (!bar || !legend || !tbody) return; // not on this page

    var carriers = state.ca_bands;
    if (!Array.isArray(carriers) || !carriers.length) {
      bar.innerHTML = '<div class="om-ca-bwbar-empty"></div>';
      legend.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="7" class="om-note">No carrier aggregation active.</td></tr>';
      return;
    }

    var totalBw = carriers.reduce(function (sum, c) {
      return sum + (typeof c.bw_mhz === 'number' ? c.bw_mhz : 0);
    }, 0);

    bar.innerHTML = carriers.map(function (c, i) {
      var bw = typeof c.bw_mhz === 'number' ? c.bw_mhz : 0;
      var pct = totalBw > 0 ? Math.max((bw / totalBw) * 100, 2) : 100 / carriers.length;
      var cls = CA_SEG_CLASSES[i % CA_SEG_CLASSES.length];
      return '<div class="om-ca-seg ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div>';
    }).join('');

    legend.innerHTML = carriers.map(function (c, i) {
      var cls = CA_SEG_CLASSES[i % CA_SEG_CLASSES.length];
      var bwLabel = typeof c.bw_mhz === 'number' ? c.bw_mhz + ' MHz' : '—';
      return '<span class="om-ca-legend-item"><span class="om-ca-legend-dot ' + cls + '"></span>' +
        escapeHtml(c.type || '') + ': ' + escapeHtml(c.band || '') + ' (' + bwLabel + ')</span>';
    }).join('');

    tbody.innerHTML = carriers.map(function (c) {
      var est = typeof c.dl_estimated_mbps === 'number' ? c.dl_estimated_mbps : null;
      var max = typeof c.dl_maximum_mbps === 'number' ? c.dl_maximum_mbps : null;
      var thpt = (est !== null && max !== null) ? (est + ' / ' + max + ' Mbps') : '—';
      return '<tr>' +
        '<td>' + escapeHtml(c.type || '—') + '</td>' +
        '<td>' + escapeHtml(c.band || '—') + '</td>' +
        '<td>' + escapeHtml(c.earfcn || '—') + '</td>' +
        '<td>' + escapeHtml(c.pci || '—') + '</td>' +
        '<td>' + (typeof c.rsrp === 'number' ? c.rsrp + ' dBm' : '—') + '</td>' +
        '<td>' + (typeof c.sinr === 'number' ? c.sinr + ' dB' : '—') + '</td>' +
        '<td>' + thpt + '</td>' +
        '</tr>';
    }).join('');
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
    initLanConfig();
    initWanConfig();
    initWanInternet();
    initSimSlotToggle();
  });
})();
