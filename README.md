# OpenModem

A local web front end for the Quectel RM520N-GL modem. Runs directly on the
modem's onboard Linux, served over the modem's local network/USB interface.

Architecture takes inspiration from [QuecControl](https://github.com/anthonysecco/QuecControl),
an existing project for the same modem, but is a standalone replacement, not
a fork — deliberately different in scope and simplicity. See `SCOPE.md` for
what's in/out and why, and `DEPENDENCIES.md` for the small set of external
web services the backend calls out to (connectivity checks, IP
geolocation) and how often.

- **No additional software installed on the modem.** The backend stays on
  whatever BusyBox already provides on-device (`ash`, `httpd`, coreutils
  applets) — no Go/Python/Node runtime, no cross-compiled binaries.
- **Narrower feature scope.** QuecControl covers cellular/SIM/WAN/LAN/GPS
  broadly, including features that assume a working internet connection.
  OpenModem intentionally narrows this — see `SCOPE.md`.
- **Simpler polling.** One poll interval instead of tiered fast/medium/slow
  polling, and fewer things polled overall.

## Installation

Requirements: the RM520N-GL's onboard Application Processor must already be
ADB-unlocked (see `iamromulan/quectel-rgmii-configuration-notes` for the
unlock process on a fresh module) and reachable — either `adb shell` over
USB, or a root shell already on the device by some other means.

From a root shell on the modem itself:

```sh
curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/main/installer.sh | sh
```

This removes any existing QuecControl, SimpleAdmin, SimpleFirewall, or
OpenModem install first (only one admin UI runs on the device at a time),
then deploys under `/usrdata/openmodem` and starts the broker, poller,
httpd, firewall/TTL, and connectivity-poller services. The installer prints
the web UI's address when it finishes — by default `http://192.168.225.1:8080`
(bridge0's default IP; the actual bridge IP depends on how the modem is
connected, e.g. `192.168.226.1` when tethered directly over USB/RNDIS to a
single host — check the printed address rather than assuming it).

The web UI is protected by HTTP Basic Auth out of the box, **default
credentials `admin` / `admin`** — the UI shows a banner nagging you to
change this (System page → Change Password) until you do. See
`SCOPE.md`'s "Web UI authentication" entry for how this is implemented.

To pin an install to an exact commit instead of whatever's currently on
`main` (`main` is cached for a few minutes by GitHub's raw-content CDN, so a
push isn't instantly live), see `CLAUDE.md`'s Development section for the
`OPENMODEM_INSTALL_REF` env var.

### Updating

Re-running the installer command above is how updates happen — it skips
straight through if the installed commit already matches `main`, otherwise
it installs the new version, health-checks it, and automatically rolls back
to the previous install if anything comes up unhealthy. The same flow is
also available from the System page's "Check for Update" button, which
triggers it remotely and polls until the reinstalled web UI comes back.

### Uninstalling

```sh
curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/main/uninstall.sh | sh
```

Stops and removes every OpenModem service, its firewall/TTL rules, and
everything under `/usrdata/openmodem` (including `openmodem.conf`, so the
Basic Auth password and any other saved settings are wiped too), leaving
the device as it was before OpenModem was ever installed. Does not touch
QuecControl/SimpleAdmin/SimpleFirewall (`installer.sh` already removes
those on install) or Tailscale (unrelated, never touched).

## Pages

Six pages, sharing one layout (top bar, sidebar nav on desktop / bottom tab
bar on mobile, card-grid content):

- **Dashboard** (`/`) — at-a-glance overview: combined signal strength and
  a plain-language status card, LTE/5G registration and roaming, the
  connectivity checks (ping + HTTP 204) and IP geolocation, and 5-minute
  trend charts for signal, expected downlink, upload/download throughput,
  latency, and jitter.
- **Cellular** (`/cellular.html`) — registration, serving-cell detail, and
  signal (RSRP/RSRQ/SINR) split into separate LTE and 5G NR cards; network
  mode (Auto/LTE-only/5G-only/LTE+5G) and data-roaming toggles; a Carrier
  Scan action (`AT+COPS=?`, up to ~2 minutes) listing available operators;
  Carrier Aggregation (active component carriers, combined bandwidth,
  expected/maximum downlink, a per-carrier bandwidth bar and table); and a
  collapsible Band Lock card (per-band LTE/NR checkboxes, All/None
  quick-select).
- **SIM** (`/sim.html`) — status/ICCID/IMSI/phone number for each of the
  module's two SIM slots (only the currently-active slot ever shows live
  data — reading the other requires an actual, disruptive slot switch) and
  a toggle to switch the active slot.
- **WAN** (`/wan.html`) — connection status, APN, and IP addresses;
  public-IP/ISP/ASN/geolocation from an external lookup (the one
  intentionally internet-dependent card in the project, see `SCOPE.md`);
  cumulative data usage with a reset action and live throughput rate;
  TTL/hop-limit spoofing (hides tethered devices from carrier
  detection) with common-carrier reference values; a Path MTU test; and
  5-minute receive/send bandwidth charts.
- **LAN** (`/lan.html`) — DHCP pool and router IP, DNS proxy mode, NAT vs.
  IP Passthrough mode (with a target-MAC field for passthrough), editable
  IP/DHCP range, and a Connected Clients table (hostname, IP, MAC, lease
  expiry) read from the on-device DHCP server's own lease file.
- **System** (`/system.html`) — device info (model, IMEI, firmware,
  temperature, uptime), power actions (reboot, radio on/off), the
  update/version card described above, a Change Password card for the web
  UI's Basic Auth, and a full AT command terminal for anything not
  exposed as a dedicated control.

## Layout

- **`bin/`** — POSIX shell daemons that own the AT command channel
  (`/dev/smd11`) and expose it to the rest of the system through a FIFO,
  since the device is a raw character device (not a tty) that only one
  process can safely read/write at a time.
- **`config/`** — shell-sourced `.conf` files read by the daemons and CGI
  scripts at startup.
- **`www/`** — static HTML/CSS/JS front end, no framework, no build step.
  `www/cgi-bin/` holds the backend: POSIX shell CGI scripts invoked by
  the modem's embedded web server (busybox httpd) that talk to the broker
  and return JSON.
- **`installer.sh`** — deploys the project onto the modem's filesystem
  (typically under `/usrdata/`) and installs systemd (or init.d) services
  for the broker, poller, and httpd.
- **`uninstall.sh`** — reverses `installer.sh`: stops/removes the
  services, the firewall/TTL rules it applied, and everything under
  `/usrdata/openmodem`, leaving the device as it was before OpenModem
  was installed.

## Development

The modem is connected to this host over USB for development. Development
happens by editing files here and deploying them to the modem via
`installer.sh`'s normal install/update flow (see `CLAUDE.md`) — there's no
local dev server equivalent to the modem's own runtime (BusyBox shell, no
Node/Python), so changes are always verified against the real device.

## Future enhancements

Not built yet, but with groundwork already in place:

- **Home Assistant integration.** `www/cgi-bin/ha_state.sh` already exists
  on the backend — one merged endpoint (modem state + connectivity state)
  with registration/access-tech codes translated into HA-friendly enum
  strings, and server-side WAN throughput-rate computation so a client
  doesn't have to reimplement it. What's missing is the actual HA side: a
  HACS custom component (or a documented set of RESTful/MQTT sensor
  configs) that polls this endpoint and exposes OpenModem's state as HA
  entities — signal/registration/WAN sensors, and possibly device actions
  like reboot or radio on/off as HA services. Since the whole site now
  sits behind HTTP Basic Auth (see above), any integration built against
  `ha_state.sh` needs to send credentials with each request — a plain
  unauthenticated RESTful sensor config will get a 401. See
  `DEPENDENCIES.md`'s "Not a dependency: Home Assistant" note for why
  `ha_state.sh` isn't counted as an outbound dependency (it's an inbound
  consumer polling OpenModem, not the reverse).

See `SCOPE.md`'s "Future enhancement candidates" for other parked ideas
(connectivity watchdog/auto-recovery, webhook notifications, config
backup/restore).
