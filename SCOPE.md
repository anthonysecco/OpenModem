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
- **WAN status/actions** — richer WAN status (IP type, IPv6 address,
  cumulative data usage from `AT+QGDCNT?`, with a reset action) plus TTL
  spoofing, adapted from QuecControl's `wan_action.sh`. TTL spoofing is
  **not** OpenModem's own iptables rule — this device already has a
  separate pre-existing package, SimpleFirewall
  (`/usrdata/simplefirewall/`), with its own `ttl-override.service`
  independently managing the same mechanism (a POSTROUTING mangle
  TTL/HL rule on `rmnet+`). Two independent managers of that rule fight
  silently (the TTL target doesn't stop rule processing, so whichever
  rule sits later in the chain wins on every packet, regardless of which
  UI last touched it — confirmed by testing: flushing SimpleFirewall's
  live rule and reapplying a different value would have left both
  stacked). `www/cgi-bin/wan_action.sh` is deliberately a front-end for
  SimpleFirewall's existing mechanism instead: it reads/writes
  `/usrdata/simplefirewall/ttlvalue` and drives its `ttl-override`
  script (`stop` while the file still holds the *old* value, write the
  new value, `start`) rather than managing iptables directly. This makes
  the feature dependent on SimpleFirewall being present on the device.
  **`installer.sh`'s cleanup list does not cover SimpleFirewall** — it
  only removes QuecControl/SimpleAdmin/OpenModem — so a fresh device
  without it pre-installed would have no working TTL spoofing backend;
  revisit whether `installer.sh` should also manage SimpleFirewall (or
  whether OpenModem should have its own independent iptables path as a
  fallback) if this ships to devices where it isn't already present.
  Interface up/down (`AT+CGACT=0,1` / `1,1`) is still unimplemented.
- **LAN config** — local network configuration (QuecControl's
  `lan_action.sh`). Implemented: DHCP pool/gateway IP (`AT+QMAP="LANIP"`),
  DNS proxy mode (`AT+QMAP="DHCPV4DNS"`), and NAT vs. IP Passthrough
  (`AT+QMAP="MPDN_rule"`) — see `at_poller.sh`'s `collect_lan()` and
  `www/cgi-bin/lan_action.sh`. The DHCP/IP card hides itself in the UI
  when IP Passthrough is active, since that pool config is moot in that
  mode (the LAN client gets the raw WAN IP directly, not a pool lease).
  Data interface selection (USB/PCIe, `AT+QCFG="data_interface"`) was
  deliberately left out — narrower than QuecControl's full LAN page,
  revisit if actually needed. VLAN tagging (`AT+QMAP="VLAN"`) was
  implemented, tested against real hardware for the read side, then
  dropped entirely — not needed for this deployment's single-device LAN.

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
  lease file directly, not more AT polling. (This is distinct from LAN
  *config* — DHCP pool/DNS mode/NAT-passthrough — which `at_poller.sh`
  does collect via `AT+QMAP`, see below.)
- `at_poller.sh`'s `collect_lan()` reads are confirmed live against this
  hardware, with one correction from what QuecControl's docs suggested:
  `AT+QMAP="LANIP",?` returns `ERROR` on this modem — the actual query is
  the bare form, `AT+QMAP="LANIP"` (same as `MPDN_rule`/`DHCPV4DNS`),
  returning `+QMAP: "LANIP",<start>,<end>,<gateway>` with no quotes
  around the IPs. `MPDN_rule` and `DHCPV4DNS` parsed correctly on the
  first try (`lan_mode`/`lan_dns_mode` came back `"NAT"`/`"carrier"`,
  matching this device's actual config).
- `lan_action.sh`'s `set_mode` (NAT ↔ IP Passthrough) is confirmed
  working end-to-end on real hardware: switching to passthrough handed
  the exact WAN IP (as reported by `wan_ip`) straight to a LAN client
  once it renegotiated DHCP (a plain lease *renew* wasn't enough — needed
  a full link down/up to trigger a fresh DHCP DISCOVER), and switching
  back to NAT correctly restored a private lease. `set_lanip` and
  `set_dns` are written the same way but haven't themselves been
  exercised yet — verify before relying on them, particularly
  `set_lanip` mid-passthrough (the DHCP pool it edits is meaningless in
  that mode, which is why the UI now hides that card while passthrough
  is active).
- VLAN tagging (`AT+QMAP="VLAN"`, both the poller's `collect_lan()` read
  and `lan_action.sh`'s `vlan_add`/`vlan_remove`) was implemented and its
  *read* side confirmed live (`+QMAP: "VLAN",0`, no other fields, with no
  non-default VLANs configured — default-only case parsed correctly), but
  was then dropped from the feature set entirely before the *write* side
  (`vlan_add`/`vlan_remove`, and the response shape with a real
  non-default VLAN present) was ever exercised. No longer present in
  `at_poller.sh`, `lan_action.sh`, or the LAN page.
- `at_poller.sh`'s WAN additions are confirmed live: `AT+CGDCONT?`'s
  2nd field is IP type (`"IPV4V6"`, matching this SIM's actual config);
  `AT+QGDCNT?` is `<tx_bytes>,<rx_bytes>` and `AT+QGDCNT=0` genuinely
  zeroes it (tested: 323207,333916 → 0,0). `AT+CGPADDR`'s 3rd field is
  IPv6 as **16 dot-separated decimal octets**
  (`38.0.3.128.135.82.175.111.0.0.0.72.21.29.30.1`), not colon-hex —
  QuecControl's own poller assumes colon notation, which doesn't match
  this hardware; `ipv6_from_octets()` converts pairs of octets to hex
  groups, verified to produce `2600:380:8752:af6f:0:48:151d:1e01`,
  matching the actual `/64` prefix a LAN client received via SLAAC.
- TTL spoofing (`wan_action.sh`'s `get_ttl`/`set_ttl`) is confirmed
  working end-to-end via direct `adb shell` testing of the stop→write→
  start sequence against SimpleFirewall's real `ttl-override` script:
  swapping 88→65 produced exactly one active rule at each step, no
  stacking. Not yet exercised through the actual CGI endpoint/UI.
  Discovering the pre-existing SimpleFirewall rule mid-testing (and
  briefly flushing it, then restoring it) is what surfaced the
  installer.sh gap noted under "WAN status/actions" above.

## Open questions

- Whether `installer.sh` should manage SimpleFirewall (stop/disable its
  service so OpenModem is the one write path, matching the "only one
  admin tool at a time" policy already applied to QuecControl/
  SimpleAdmin) or whether TTL spoofing should fall back to its own
  independent iptables rule when SimpleFirewall isn't present — see
  "WAN status/actions" above. Interface up/down for WAN is still
  unimplemented.
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
  plus a checkbox per band (see "Visual redesign" below) that's
  pre-filled from a one-time `action=get` call on page load.
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

## Visual redesign

Four changes, all modeled on QuecControl's actual markup/CSS (fetched
and read directly from its GitHub repo, not guessed at):

- **AT Terminal** now looks like QuecControl's: a dark mac-style
  terminal window (traffic-light dots, monospace title bar) regardless
  of the page's own light/dark theme, colored output lines (`OK` green,
  lines containing `ERROR` red, everything else a neutral info color,
  each line timestamped), a row of clickable preset command chips, and
  command history via the input's Up/Down arrows. One deliberate
  departure from QuecControl: it force-uppercases the *entire* typed
  command before sending, which would corrupt a case-sensitive quoted
  parameter (`AT+QNWPREFCFG="lte_band"` — that string has to stay
  lowercase). Ours only prepends `AT` if missing; it doesn't touch case.
- **Nav icons** replaced the plain colored-square placeholders with
  inline SVG, Material-Design-outline style (24×24, stroke-based). These
  are hand-built with plain shapes (rects, circles, lines) rather than
  pasted-in Material Icons path data from memory — a misremembered path
  string renders as visible garbage or nothing at all, while a
  slightly-off rect/circle coordinate is at worst a shape that's a
  little off. Validated as well-formed SVG XML and checked that every
  coordinate stays inside the 24×24 viewBox (no icon accidentally
  invisible from an out-of-range number) — see the commit for how, no
  real browser was available to eyeball them directly.
- **Band lock is checkboxes now**, not a comma-separated text field —
  one checkbox per band, matching QuecControl's `bandlock.html`. The
  band universe (which checkboxes exist at all) is the modem's own
  reported capability, captured live from `AT+QNWPREFCFG` when nothing
  is locked (i.e. every band it's willing to list is "enabled") rather
  than a hardcoded reference list that might not match this exact
  firmware. All/None quick-select buttons per band type, matching
  QuecControl. Checkbox state is initialized *once* on page load via
  `band_lock.sh?action=get` — deliberately not re-synced on every
  `state.sh` poll tick, which runs every `POLL_INTERVAL` (~10s) and
  would otherwise silently discard whatever the user is mid-edit on.
- **Carrier aggregation shows PCC/SCC** — `at_poller.sh`'s
  `collect_carrier_aggregation` now captures each `+QCAINFO` line's
  first quoted field (`"PCC"` or `"SCC"`), not just the band. `ca_bands`
  is now `[{"type":"PCC","band":"LTE BAND 2"}, ...]` instead of a flat
  array of band strings — a real shape change to that JSON field, not
  additive. Confirmed live: a 3-component-carrier session rendered as
  `PCC: LTE BAND 2, SCC: LTE BAND 66, SCC: LTE BAND 66`.
- Carrier scan's confirm-before-scanning dialog (data will be disrupted
  for up to 2 minutes) already existed from the previous round; wording
  tightened slightly, no functional change.
