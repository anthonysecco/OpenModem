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
  // ca_bands is [{type:"PCC"|"SCC", band:"LTE BAND N"}, ...] — PCC first
  // (it's always listed first by the modem), then each SCC.
  function fmtCaBands(v) {
    if (!Array.isArray(v) || !v.length) return null;
    return v.map(function (c) { return c.type + ': ' + c.band; }).join(', ');
  }

  var FORMATTERS = {
    reg_lte: fmtReg, reg_nr: fmtReg, reg_creg: fmtReg,
    signal_lte_rsrp: fmtDbm, signal_lte_rsrq: fmtDbm, signal_lte_sinr: fmtDbm,
    signal_nr_rsrp: fmtDbm, signal_nr_rsrq: fmtDbm, signal_nr_sinr: fmtDbm,
    wan_active: fmtBool,
    ca_bands: fmtCaBands,
    band_pref_lte: fmtBands, band_pref_nr5g: fmtBands
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

  function loadCurrentBandLock() {
    fetch('/cgi-bin/band_lock.sh?action=get')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        // null means the modem reported a hex bitmask (= "all bands");
        // treat that the same as everything being selected.
        setBandGridChecked('om-bandlock-lte-grid', data.lte_bands || LTE_BANDS);
        setBandGridChecked('om-bandlock-nr-grid', data.nr_bands || NR_BANDS);
      })
      .catch(function () { /* leave grids at their default (unchecked) state */ });
  }

  function initBandLock() {
    var btn = document.getElementById('om-bandlock-apply');
    if (!btn) return;
    var statusEl = document.getElementById('om-bandlock-status');

    renderBandGrid('om-bandlock-lte-grid', LTE_BANDS, 'B');
    renderBandGrid('om-bandlock-nr-grid', NR_BANDS, 'n');
    loadCurrentBandLock();

    var lteAll = document.getElementById('om-bandlock-lte-all');
    var lteNone = document.getElementById('om-bandlock-lte-none');
    var nrAll = document.getElementById('om-bandlock-nr-all');
    var nrNone = document.getElementById('om-bandlock-nr-none');
    if (lteAll) lteAll.addEventListener('click', function () { setBandGridAll('om-bandlock-lte-grid', true); });
    if (lteNone) lteNone.addEventListener('click', function () { setBandGridAll('om-bandlock-lte-grid', false); });
    if (nrAll) nrAll.addEventListener('click', function () { setBandGridAll('om-bandlock-nr-grid', true); });
    if (nrNone) nrNone.addEventListener('click', function () { setBandGridAll('om-bandlock-nr-grid', false); });

    btn.addEventListener('click', function () {
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
        })
        .catch(function (err) {
          statusEl.textContent = 'Failed: ' + err;
        })
        .finally(function () { btn.disabled = false; });
    });
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

  window.OM = { init: initShell };

  document.addEventListener('DOMContentLoaded', function () {
    refreshState();
    setInterval(tickAge, 1000);
    initUpdateButton();
    initAtTerminal();
    initPowerButtons();
    initBandLock();
    initCarrierScan();
  });
})();
