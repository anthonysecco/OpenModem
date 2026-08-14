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
     attributes to the markup they want populated. */
  var REG_LABELS = {
    0: 'Not registered', 1: 'Registered (home)', 2: 'Searching',
    3: 'Denied', 4: 'Unknown', 5: 'Registered (roaming)'
  };

  function fmtDbm(v) { return (v === null || v === undefined) ? null : v + ' dBm'; }
  function fmtReg(v) { return REG_LABELS[v] !== undefined ? REG_LABELS[v] : null; }
  function fmtBool(v) { return v === true ? 'Active' : v === false ? 'Inactive' : null; }
  function fmtList(v) { return (Array.isArray(v) && v.length) ? v.join(', ') : (Array.isArray(v) ? null : v); }
  function fmtBands(v) { return (typeof v === 'string' && v.length) ? v.split(':').join(', ') : v; }
  function fmtAge(v) {
    if (!v) return null;
    var secs = Math.max(0, Math.round(Date.now() / 1000 - v));
    return secs < 90 ? secs + 's ago' : Math.round(secs / 60) + 'm ago';
  }

  var FORMATTERS = {
    reg_lte: fmtReg, reg_nr: fmtReg, reg_creg: fmtReg,
    signal_lte_rsrp: fmtDbm, signal_lte_rsrq: fmtDbm, signal_lte_sinr: fmtDbm,
    signal_nr_rsrp: fmtDbm, signal_nr_rsrq: fmtDbm, signal_nr_sinr: fmtDbm,
    wan_active: fmtBool,
    ca_bands: fmtList,
    band_pref_lte: fmtBands, band_pref_nr5g: fmtBands,
    _polled_at: fmtAge
  };

  function renderState(state) {
    var nodes = document.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = node.getAttribute('data-field');
      var raw = state[key];
      var fmt = FORMATTERS[key];
      var out = fmt ? fmt(raw) : raw;
      node.textContent = (out === null || out === undefined || out === '') ? '—' : out;
    }
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
        if (!state._error) renderState(state);
      })
      .catch(function () {
        if (statusEl) {
          statusEl.textContent = 'Unreachable';
          statusEl.classList.add('bad');
        }
      });
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

  window.OM = { init: initShell };

  document.addEventListener('DOMContentLoaded', function () {
    refreshState();
    setInterval(refreshState, 10000);
    initUpdateButton();
  });
})();
