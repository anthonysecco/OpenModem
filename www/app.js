(function () {
  'use strict';

  function refresh() {
    fetch('/cgi-bin/state.sh')
      .then(function (r) { return r.json(); })
      .then(function (state) {
        document.getElementById('status').textContent = JSON.stringify(state);
      })
      .catch(function (err) {
        document.getElementById('status').textContent = 'Error: ' + err;
      });
  }

  refresh();
  setInterval(refresh, 5000);
})();
