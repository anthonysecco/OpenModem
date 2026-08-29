# External Service Dependencies

Third-party web services OpenModem's backend calls out to, what each is
used for, and how often. This is the complete list — every `http://`/
`https://` reference in `bin/` and `www/cgi-bin/` is accounted for below.
Everything else the UI polls (`state.sh`, `net_state.sh`, the action
scripts) is local, served by the modem's own `httpd`, and isn't a
dependency in this sense.

All of these calls are made **by the modem itself** (`curl`/raw sockets
from `bin/net_poller.sh` or a `www/cgi-bin/*.sh` script running server-
side), over the modem's own WAN connection — never directly from the
browser. If any of them are unreachable, the affected field/card degrades
to `—`/"Unable to fetch…" rather than breaking the page.

## Summary

| Service | Endpoint | Called by | Interval/trigger | Purpose |
|---|---|---|---|---|
| Google (gstatic) | `http://connectivitycheck.gstatic.com/generate_204` | `bin/net_poller.sh` (`check204_loop`) | Adaptive: 60s while healthy, 10s→20s→40s→60s backoff on failure | Dashboard/topbar "Connectivity Check" |
| Cloudflare | ICMP ping to `1.1.1.1` | `bin/net_poller.sh` (`icmp_loop`) | Every 5s, 6-sample rolling average | "Ping Check" pill; Latency/Jitter trend charts |
| Cloudflare | `https://1.1.1.1/cdn-cgi/trace` | `bin/net_poller.sh` (`geo_loop`) | Every 300s (5 min) | Dashboard "Cloudflare PoP" field |
| ipinfo.io | `https://ipinfo.io/json` | `bin/net_poller.sh` (`geo_loop`) | Every 300s (5 min) | Dashboard "IP Geo" field |
| ipinfo.io | `https://ipinfo.io/json` | `www/cgi-bin/internet_info.sh` | On-demand — once per WAN page load, not on a timer | WAN page's Internet card (ISP/ASN/hostname/IP/location) |
| Cloudflare | ICMP ping (DF bit, sizes 1200–MTU) to `1.1.1.1` (same `NET_ICMP_TARGET`) | `www/cgi-bin/mtu_test.sh` | On-demand only — WAN page's "Test MTU" button | WAN page's Path MTU section (configured vs. verified MTU) |
| GitHub (raw.githubusercontent.com) | `https://raw.githubusercontent.com/anthonysecco/OpenModem/<ref>/…` | `installer.sh` (fetched by hand or via `www/cgi-bin/update.sh`) | On-demand only — manual `curl \| sh`, or the System page's Update button | Install/update: downloads `installer.sh` + every file under `bin/`, `config/`, `www/` |
| GitHub (api.github.com) | `https://api.github.com/repos/anthonysecco/OpenModem/commits/main` | `www/cgi-bin/version_check.sh` | On-demand — once per System page load, not on a timer | System page's "Update Available" row |

## Detail

### Google — HTTP 204 connectivity check

`bin/net_poller.sh`'s `check204_loop` requests
`http://connectivitycheck.gstatic.com/generate_204` and expects a bare
HTTP 204 back — the same check Android itself uses to decide "is there
real internet, not just a captive portal." Interval is adaptive, not
fixed (config keys in `config/openmodem.conf`):

- `NET_CHECK204_HEALTHY_INTERVAL=60` — while checks are succeeding, one
  every 60s.
- `NET_CHECK204_RETRY_INTERVAL=10` — the first failure drops the
  interval to 10s, then doubles on each further consecutive failure
  (10→20→40→60s), capping at the healthy interval rather than backing
  off indefinitely.
- `NET_CHECK204_RECOVER_SUCCESSES=2` — two consecutive successes are
  required before declaring recovery and returning to the 60s cadence.

Drives the "Connectivity Check" indicator shown in both the topbar and
the Dashboard's Connectivity card.

### Cloudflare — ICMP ping

`bin/net_poller.sh`'s `icmp_loop` pings `1.1.1.1` (`NET_ICMP_TARGET`)
every `NET_ICMP_INTERVAL=5` seconds and keeps a rolling average over the
last `NET_ICMP_WINDOW=6` samples (30 seconds of history). This is the
only one of these dependencies on a fixed, non-adaptive interval — it's
also the one everything else in `net_poller.sh` is timed relative to
(`icmp_loop` is the sole writer of the merged `net_state.json` the front
end actually polls; the other two loops write scratch files it merges
in each cycle). Drives the "Ping Check" pill and the Latency/Jitter
trend charts on the Dashboard.

### Cloudflare — PoP/colo trace

Same `geo_loop` as ipinfo.io below, on the same 300s cadence — see that
section for why the interval is that slow. `https://1.1.1.1/cdn-cgi/trace`
returns a small key=value text blob including `colo=` (the Cloudflare
data center that answered), parsed out for the Dashboard's "Cloudflare
PoP" field.

### ipinfo.io — background geolocation (Dashboard)

`bin/net_poller.sh`'s `geo_loop` requests `https://ipinfo.io/json` every
`NET_GEO_INTERVAL=300` seconds (5 minutes) — deliberately much slower
than the checks above: city/region-level geolocation and Cloudflare PoP
essentially never change minute-to-minute for a stationary modem, so
polling them at the same cadence as the health checks would just be
unnecessary load on a third-party service for no user-visible benefit.
Feeds the Dashboard Connectivity card's "IP Geo" field.

### ipinfo.io — on-demand lookup (WAN page)

`www/cgi-bin/internet_info.sh` is a **separate** call to the same
`https://ipinfo.io/json` endpoint, fired once when the WAN page loads
(`app.js`'s `initWanInternet()` → `fetchWanInternet()`) and not
re-fetched on any timer afterward — reloading the WAN page is what
refreshes it. Backs the WAN page's Internet card (ISP, ASN, hostname,
public IPv4/IPv6, city/region/country). Uses an 8-second `curl` timeout
(`-m 8`); on failure the card shows "Unable to fetch public IP info"
rather than stale data.

### Cloudflare — path MTU probe (WAN page)

`www/cgi-bin/mtu_test.sh` reuses `NET_ICMP_TARGET` (`1.1.1.1` by default,
same host `net_poller.sh`'s `icmp_loop` already pings) but is a
**separate**, on-demand set of pings, not part of that background loop —
fired only when the WAN page's "Test MTU" button is clicked. Sends
`ping -M do -s <size>` (DF bit set) at a handful of sizes between 1200
bytes and the WAN interface's own configured MTU, binary-searching for
the largest one that gets a real reply, to distinguish "what the modem's
interface is configured for" from "what actually round-trips over the
carrier network." A handful of 2-second-timeout pings, a few hundred ms
to a couple seconds total — not on any recurring interval.

This is intentionally not deduplicated with `geo_loop`'s own ipinfo.io
call above — they serve two different cards on two different pages with
independent lifecycles (one is always-on background polling, the other
is page-load-triggered), and ipinfo.io's free tier has enough headroom
that a second independent call isn't worth the coupling it would take to
share one.

### GitHub — install/update source

`raw.githubusercontent.com` is not polled at all — it's only ever hit
on an explicit install or update action: the initial
`curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/main/installer.sh | sh`,
or re-triggering that same flow from the System page's Update button
(`www/cgi-bin/update.sh`). Each run downloads `installer.sh` itself plus
every file under `bin/`, `config/`, and `www/` (including `www/cgi-bin/`)
fresh from the `main` branch, or from a pinned commit if
`OPENMODEM_INSTALL_REF` is set — see `CLAUDE.md`'s Development section
for why a pinned installer URL alone doesn't pin the files it downloads.

### GitHub — update-availability check (System page)

`www/cgi-bin/version_check.sh` queries GitHub's commits API for `main`'s
current HEAD sha and compares it to `/usrdata/openmodem/VERSION`'s
locally-recorded `COMMIT_SHA` — the same lookup `installer.sh`'s own
"Checking for updates" step already does to decide whether a run is a
no-op, just read-only here and fetched once when the System page loads
rather than as part of an actual install. An unresolved lookup (rate
limit, no signal) reports `update_available:false` rather than guessing,
same as `installer.sh` never skipping on an unknown sha.

## Not a dependency: Home Assistant

`www/cgi-bin/ha_state.sh` exists so an external Home Assistant instance
can poll *this* modem's state — that's an inbound consumer of
OpenModem, not an outbound dependency of it, so it's not listed above.
