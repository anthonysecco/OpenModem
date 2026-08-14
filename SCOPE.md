# Scope

What OpenModem does and does not do, and why, as a deliberate departure from
QuecControl (a standalone replacement, not a fork — feature parity is not a
goal).

## Constraints

- No additional software installed on the modem. Backend uses only what
  BusyBox already provides (`ash`, `httpd`, coreutils applets).
- A single poll interval (`POLL_INTERVAL=10` seconds by default, see
  `config/openmodem.conf`), not QuecControl's tiered fast/medium/slow
  polling.

## In scope

- **Dashboard / overview** — home page summarizing modem state at a glance.
- **Cellular status** — signal, registration, serving cell, carrier, carrier
  aggregation. Includes band lock and carrier scan as dedicated features
  (not just raw AT access), matching QuecControl's `band_lock.sh` /
  `carrier_scan.sh`.
- **SIM info** — SIM status/details.
- **System** — device info, raw AT command terminal, reboot/power actions.
- **WAN actions** — interface up/down, TTL spoofing (QuecControl's
  `wan_action.sh`).
- **LAN config** — local network configuration (QuecControl's
  `lan_action.sh`).

## Out of scope

- **Scout (ping/latency tests)** — QuecControl's `ping.sh`/`force_poll.sh`.
  Actively tests internet connectivity; dropped because OpenModem is
  narrowing away from features that assume a working internet connection.
- **GPS location** — QuecControl's `api_gps.sh`. Dropped.

## UI/UX

- Must render well on both mobile and desktop — responsive, not a
  desktop-only admin panel.
- Layout follows the modern router/modem admin pattern (GL.iNet-style):
  fixed top bar with device identity + connection status, sidebar nav on
  desktop that collapses to a bottom tab bar on mobile, card-grid content
  area for status tiles per page.
- Implemented in `www/style.css` / `www/app.js` as a shared shell (`.om-topbar`,
  `.om-sidebar`, `.om-tabbar`, `.om-main`, `.om-cards`/`.om-card`) reused by
  every page — no per-page layout reinvention, no framework, no build step.

## Install / update

- `installer.sh` follows QuecControl's own installer shape almost exactly:
  `curl -fsSL .../installer.sh | sh`, stop/remove whatever's already
  running, lay down fresh files under `/usrdata/openmodem`, generate
  `openmodem-broker`/`openmodem-poller`/`openmodem-httpd` systemd units,
  start them.
- Before installing, it removes any prior **QuecControl**, **SimpleAdmin**,
  or **OpenModem** install (services, systemd units, `/usrdata/*`,
  `/tmp/*` runtime state) so only one admin UI runs on the device at a
  time. All names are confirmed against a real device (see "Verified
  against real hardware" below) — SimpleAdmin (from
  `iamromulan/quectel-rgmii-toolkit`) runs `simpleadmin_httpd.service` +
  `simpleadmin_generate_status.service` out of `/usrdata/simpleadmin`,
  plus a separate `socat-at-bridge` toolkit (`socat-smd11*`/`socat-smd7*`
  units out of `/usrdata/socat-at-bridge`) that bridges `/dev/smd11` to
  pty pairs for it — that has to be removed too, not just SimpleAdmin
  itself, since it and our own `at_broker.sh` would otherwise both try to
  own `/dev/smd11` at once. Tailscale and simplefirewall (also part of
  that toolkit) are deliberately left alone — nothing here conflicts with
  them and removing them wasn't asked for.
- **Update** is just "run the installer again": the System page's Update
  button calls `www/cgi-bin/update.sh?action=start&confirm=1`, which
  requires client-side confirmation first (a `window.confirm()` warning
  that it can take several minutes and will restart all services) and
  server-side confirmation (`confirm=1`) as a second guard against an
  accidental/unauthenticated trigger. It then runs the installer
  detached in the background and the frontend polls
  `update.sh?action=status` until the reinstalled httpd comes back.
  `openmodem.conf` is preserved across updates (installer skips
  re-downloading it if one already exists).

## Verified against real hardware

Confirmed on an actual RM520N-GL (2026-08-14), not assumed:

- The module runs its own embedded Linux on-board (`sdxlemur`, Qualcomm
  SDX65, `LE.UM.6.3.6.r1-02600-SDX65.0`, armv7l) — this is what
  `installer.sh` targets, not the host it's tethered to. Get a root shell
  on it via `adb shell` over the same USB connection used for AT/data
  (it was already unlocked on this device via the ADBKEY process
  documented by `iamromulan/quectel-rgmii-configuration-notes`; a fresh
  module needs that unlock done once first).
- `systemd 244`, `busybox 1.31.1`; `/usr/sbin/httpd` is a symlink to
  busybox (`installer.sh` uses this path rather than `/bin/busybox httpd`
  to match the device's own convention).
- `/dev/smd11` exists exactly as `config/openmodem.conf`'s `AT_DEVICE`
  default assumes.
- `/` is UBIFS (`ubi0:rootfs`), mounted read-only by default. Despite
  showing an `assert=read-only` mount option, `mount -o remount,rw /`
  genuinely works — confirmed by writing to `/lib/systemd/system` after
  remounting, then remounting back `ro`. This is the same
  remount-write-remount pattern `installer.sh` (and SimpleAdmin's own
  installer, judging by its installed state) uses.
- `/usrdata` (a separate UBI volume, `/dev/ubi2_0`) is always read-write
  and is where every third-party toolkit — SimpleAdmin, socat-at-bridge,
  Tailscale, simplefirewall, and now OpenModem — actually lives.
- `installer.sh` had a real bug, found by running it against this device:
  the `rm -f`s of prior `/lib/systemd/system/*` unit files ran before the
  `mount -o remount,rw /`, so they silently failed (`systemctl stop`/
  `disable` still worked, so nothing kept autostarting, but stale unit
  files were left behind). Fixed by remounting rw at the start of cleanup
  instead of at the start of install; re-running confirmed zero leftover
  SimpleAdmin/socat-at-bridge files.
- `at_broker.sh`'s core read technique (fixed ~100ms `cat <&3` windows
  with terminal-line detection) round-trips real AT commands correctly:
  `ATI`, `AT+CSQ`, `AT+QTEMP` all confirmed against the live modem.
  Concurrent access needed a real fix, not just the read technique: a
  per-iteration `read -r request < "$REQUEST_PIPE"` (QuecControl's
  pattern, and this script's first draft) silently drops requests from
  writers that race the window between one read closing the FIFO and the
  next iteration reopening it — confirmed with 3 concurrent writers,
  where only 2 requests ever reached the broker. Fixed by holding the
  FIFO open on a persistent read-write fd (`exec 4<>"$REQUEST_PIPE"`)
  instead; retested with up to 7 concurrent requests, all succeeded.
- Every AT response line from this modem is `\r\n`-terminated (confirmed
  with `od -c` on a raw captured response) — the `\r` is real, not a
  terminal artifact. This silently broke several `$`-anchored parsers in
  `at_poller.sh`'s first draft (`^RM[0-9A-Z-]+$` for the model, `^OK$`
  filtering QGMR's firmware line, a trailing `"$` in the QTEMP value
  parser) since `$` anchors to true end-of-line and the `\r` was still
  there — device model/IMEI/firmware/IMSI and every temperature sensor
  value came back `null`. Fields built with `cut -f1` happened to work
  anyway (position-based, doesn't care what's at the end of the line),
  which is what let signal/registration ship first and made this bug
  easy to miss. Fixed centrally in `at_poller.sh`'s `run_at()` (pipes
  every response through `tr -d '\r'` once) rather than patching each
  consumer.
- `at_poller.sh`'s field/command choices were captured against this real,
  AT&T-registered, LTE-connected modem via `at_command.sh` — see the raw
  `ATI`/`AT+CSQ`/`AT+QRSRP`/`AT+QENG="servingcell"`/`AT+QCAINFO`/etc.
  samples worked out during that session. Carrier aggregation count
  changed from 1 to 3 component carriers between two consecutive polls
  purely from real network conditions shifting, which incidentally
  exercised and confirmed the multi-line `QCAINFO` parsing path. Only
  PDP context 1 ("broadband") is surfaced for WAN state; context 3
  ("sos") is emergency-only and deliberately skipped. Untested: a
  PIN-locked SIM, no-service/no-registration state, and an inactive WAN
  context — this SIM was unlocked and online for the whole session, so
  those code paths (mostly the `null`-on-no-match defaults) are
  plausible but not verified against real modem output.
- LAN client info is NOT collected by `at_poller.sh` — on this hardware
  it comes from dnsmasq's lease file on the Application Processor (a
  `dnsmasq` process bound to `192.168.225.1:53` was observed running),
  not from any AT command. That needs its own collector reading the
  lease file directly, not more AT polling.

## Open questions

- Exact button-level actions under WAN and LAN (which of QuecControl's
  `wan_action.sh`/`lan_action.sh` actions carry over as-is vs. get
  simplified). TTL spoofing specifically is still unimplemented.
- LAN client list: confirm the dnsmasq lease file path on this firmware
  and write a collector for it (separate from `at_poller.sh`).
- Factory reset was deliberately left out of Power (QuecControl has it;
  wasn't asked for here and is hard to make safely reversible) — revisit
  if actually needed.

## Frontend wiring

`www/app.js` has a generic `data-field="key"` binding system: any
element with that attribute gets its `textContent` set from
`cgi-bin/state.sh`'s JSON, through a small per-field formatter registry
(`FORMATTERS` — dBm units, registration-status labels, active/inactive,
band-list joining, `_polled_at` → "Xs/Xm ago") where one exists,
otherwise the raw value, or "—" for null/missing. Adding a new bound
field to a page is just adding `data-field="whatever_key"` to markup —
no per-page JS needed unless it needs a new formatter. Verified against
a live `cgi-bin/state.sh` response (Python-simulated the same formatting
logic against real JSON — no real browser was available in the dev
environment to check visually), and confirmed no `data-field` name
diverges from what `at_poller.sh` actually produces.

The refresh cadence adapts to the backend rather than being hardcoded:
`at_poller.sh` exposes its own `POLL_INTERVAL` as `_poll_interval_s` in
the JSON, and `app.js` reschedules its next `state.sh` fetch using that
value (self-rescheduling `setTimeout`, not a fixed `setInterval`) — so
changing `POLL_INTERVAL` in `openmodem.conf` and restarting the poller
takes effect on the frontend's very next fetch, with no separate config
to keep in sync. The "Updated Xs ago" display is a genuinely live
counter, not a value that only changes when a fetch happens to land: a
separate 1-second `setInterval` ticks it based on the last known
`_polled_at`, independent of the (much slower) actual poll cadence.

## Actions: band lock, carrier scan, AT terminal, power

Implemented as three new `cgi-bin` scripts, all confirmed against the
real modem, adapted from QuecControl's `band_lock.sh`/`carrier_scan.sh`/
`at_cmd.sh` (same AT commands, same JSON-array-from-shell approach, our
own paths/conventions):

- **`band_lock.sh`** — `action=get` reads `AT+QNWPREFCFG` (same as
  `at_poller.sh`, kept as a separate read here so this script is
  self-contained); `action=set&lte_bands=2,4,12&nr_bands=71` applies it,
  writing NR bands to both `nr5g_band` (SA) and `nsa_nr5g_band` (NSA).
  Tested live by setting it to the modem's own current full band list
  (a no-op in effect, but exercises the real write path without
  actually restricting connectivity) — confirmed applied via a
  follow-up GET. Cellular page's Band Lock card shows the current
  value read-only (via `at_poller.sh`'s `band_pref_lte`/`band_pref_nr5g`)
  plus separate inputs to set new ones — it does not pre-fill the
  inputs from the current value.
- **`carrier_scan.sh`** — `AT+COPS=?`, up to a 130s timeout since a real
  scan can take close to 2 minutes. Tested live: returned 9 real
  operators (AT&T current, FirstNet forbidden, Verizon/T-Mobile
  available) in ~12s. Cellular page's Carrier Scan button requires
  confirmation first (states the ~2-minute duration and the data
  interruption) before calling it.
- **`at_cmd.sh`** — generic `AT+COMMAND` passthrough (blocks shell
  metacharacters, requires an `AT` prefix, per-command timeout overrides
  for `CFUN=1`/`CFUN=0`/`QPOWD`/`COPS=?`). Backs both System's AT
  Terminal (free-form input) and Power's three buttons (Reboot →
  `AT+CFUN=1,1`, Radio Off → `AT+CFUN=0`, Radio On → `AT+CFUN=1`), each
  gated behind its own `confirm()` describing what it does and, for
  Reboot, that the connection drops for ~30s. No dedicated `power.sh` —
  matches QuecControl's own approach of sending fixed AT commands
  through the generic AT endpoint rather than a separate script per
  action.

### A real bug found while testing carrier scan

The first `carrier_scan.sh` test came back `{"error":"Scan timed
out"}` after ~14s instead of waiting the requested ~130s. Root cause was
in `at_command.sh` (present since it was first written, inherited from
the same pattern in QuecControl's own `at_command.sh`): `wait_limit =
timeout + 5` is computed in seconds, but the polling loop increments its
counter once per 100ms tick, not once per second — so the loop actually
gave up after `(timeout + 5) * 100ms`, roughly a tenth of the intended
wait. This affected every `at_command.sh` caller with a nontrivial
timeout, not just carrier scan; short/fast commands (the majority of
`at_poller.sh`'s calls) mostly finish well inside even the shrunken
window, which is why it went unnoticed until a command that genuinely
needs a long timeout was tried. Fixed by scaling `wait_limit` by 10;
retested carrier scan for real afterward (9 operators, ~12s — the modem
itself finished well within the now-correct window). Also fixed a
smaller issue found in the same spot: the `usleep`-unavailable fallback
was `sleep 1` (a full second, 10x the intended per-tick granularity)
instead of QuecControl's original `sleep 0.1`.
