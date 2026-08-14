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

  function refreshState() {
    var el = document.getElementById('om-conn-status');
    if (!el) return;
    fetch('/cgi-bin/state.sh')
      .then(function (r) { return r.json(); })
      .then(function (state) {
        el.textContent = state._error ? state._message : 'Connected';
        el.classList.toggle('bad', !!state._error);
      })
      .catch(function () {
        el.textContent = 'Unreachable';
        el.classList.add('bad');
      });
  }

  window.OM = { init: initShell };

  document.addEventListener('DOMContentLoaded', function () {
    refreshState();
    setInterval(refreshState, 10000);
  });
})();
