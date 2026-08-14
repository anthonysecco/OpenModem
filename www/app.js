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

  function buildNavLinks(activeKey) {
    return NAV.map(function (item) {
      var cls = item.key === activeKey ? ' class="active"' : '';
      return '<a href="' + item.href + '"' + cls + '><span class="icon" data-icon="' +
        item.key + '"></span><span class="label">' + item.label + '</span></a>';
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
  function fmtList(v) { return (Array.isArray(v) && v.length) ? v.join(', ') : (Array.isArray(v) ? null : v); }
  function fmtBands(v) { return (typeof v === 'string' && v.length) ? v.split(':').join(', ') : v; }

  var FORMATTERS = {
    reg_lte: fmtReg, reg_nr: fmtReg, reg_creg: fmtReg,
    signal_lte_rsrp: fmtDbm, signal_lte_rsrq: fmtDbm, signal_lte_sinr: fmtDbm,
    signal_nr_rsrp: fmtDbm, signal_nr_rsrq: fmtDbm, signal_nr_sinr: fmtDbm,
    wan_active: fmtBool,
    ca_bands: fmtList,
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

  /* ── AT Terminal (System page) ──────────────────────────────────── */
  function termAppend(cmd, response) {
    var log = document.getElementById('om-term-log');
    if (!log) return;
    var line = document.createElement('div');
    line.className = 'om-term-line';
    line.innerHTML =
      '<div class="om-term-cmd">&gt; ' + escapeHtml(cmd) + '</div>' +
      '<pre class="om-term-resp">' + escapeHtml(response) + '</pre>';
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sendAtCommand(cmd) {
    if (!cmd) return;
    return fetch('/cgi-bin/at_cmd.sh?cmd=' + encodeURIComponent(cmd))
      .then(function (r) { return r.text(); })
      .then(function (text) {
        termAppend(cmd, text.trim());
        return text;
      })
      .catch(function (err) {
        termAppend(cmd, 'ERROR: ' + err);
      });
  }

  function initAtTerminal() {
    var input = document.getElementById('om-term-input');
    var btn = document.getElementById('om-term-send');
    if (!input || !btn) return;

    var submit = function () {
      var cmd = input.value.trim();
      if (!cmd) return;
      input.value = '';
      sendAtCommand(cmd);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
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
     Current values are shown read-only via data-field (band_pref_lte/
     band_pref_nr5g, from the poller). This just adds a way to set new
     ones — it doesn't try to pre-fill the inputs with current values. */
  function initBandLock() {
    var btn = document.getElementById('om-bandlock-apply');
    if (!btn) return;
    var lteInput = document.getElementById('om-bandlock-lte');
    var nrInput = document.getElementById('om-bandlock-nr');
    var statusEl = document.getElementById('om-bandlock-status');

    btn.addEventListener('click', function () {
      var lte = lteInput.value.trim();
      var nr = nrInput.value.trim();
      if (!lte && !nr) {
        statusEl.textContent = 'Enter at least one band list.';
        return;
      }
      if (!window.confirm('This changes the band lock. The network may briefly reconnect. Continue?')) return;

      btn.disabled = true;
      statusEl.textContent = 'Applying…';
      var qs = [];
      if (lte) qs.push('lte_bands=' + encodeURIComponent(lte));
      if (nr) qs.push('nr_bands=' + encodeURIComponent(nr));

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
        'This scans for available carriers (AT+COPS=?). It can take up to ' +
        '2 minutes and will interrupt data service while it runs. Continue?'
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
