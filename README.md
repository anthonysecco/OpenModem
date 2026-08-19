# OpenModem

A local web front end for the Quectel RM520N-GL modem. Runs directly on the
modem's onboard Linux, served over the modem's local network/USB interface,
with no cloud dependency and no build step.

Architecture takes inspiration from [QuecControl](https://github.com/anthonysecco/QuecControl),
an existing project for the same modem, but is a standalone replacement, not
a fork — deliberately different in scope and simplicity. See `SCOPE.md` for
what's in/out and why.

- **No additional software installed on the modem.** The backend stays on
  whatever BusyBox already provides on-device (`ash`, `httpd`, coreutils
  applets) — no Go/Python/Node runtime, no cross-compiled binaries.
- **Narrower feature scope.** QuecControl covers cellular/SIM/WAN/LAN/GPS
  broadly, including features that assume a working internet connection.
  OpenModem intentionally narrows this — see `SCOPE.md`.
- **Simpler polling.** One poll interval instead of tiered fast/medium/slow
  polling, and fewer things polled overall.

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
happens by editing files here and deploying them to the modem (see
`installer.sh` and `CLAUDE.md` once a deploy workflow exists), since the
target environment (BusyBox shell, no Node/Python runtime) can't run a local
dev server equivalent to the modem's.
