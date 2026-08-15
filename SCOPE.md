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
- **SIM info** — dual-SIM aware. This module has 2 slots
  (`AT+QUIMSLOT=?` confirmed live: `+QUIMSLOT: (1,2)`), but only one is
  active/queryable at a time — reading the other's ICCID/IMSI would
  require an actual `AT+QUIMSLOT=N` switch, which is genuinely
  disruptive (confirmed live: triggers a full USB re-enumeration on the
  AT/diag interface, not just a SIM reinit — `adb` briefly lost the
  device entirely mid-test). So the SIM page shows two cards (SIM1/
  SIM2, each with Status/ICCID/IMSI/Phone Number), but only the
  currently-active slot's card is ever populated with live data — the
  inactive one shows a "not currently active" note rather than stale or
  fabricated values. A third card shows which slot is active and a
  toggle to switch, via `www/cgi-bin/sim_action.sh`'s `set_slot` (an
  immediate confirm-then-act button, not a batched/staged setting —
  there's nothing to protect against a background poll clobbering,
  unlike LAN's forms). Phone number comes from `AT+CNUM` (confirmed
  live, real number returned) — not every carrier/SIM provisions this,
  so it degrades to "—" like everything else here rather than being
  hidden. On this specific test device, slot 2 has no physical SIM
  (`+CME ERROR: 10`, confirmed while testing the switch) — the code
  handles that as a normal case, not an error state.
- **System** — device info, raw AT command terminal, reboot/power actions.
- **WAN status/actions** — richer WAN status (IP type, IPv6 address,
  cumulative data usage from `AT+QGDCNT?`, with a reset action) plus TTL
  spoofing, adapted from QuecControl's `wan_action.sh`. TTL spoofing is
  OpenModem's own iptables/ip6tables mangle rule (`www/cgi-bin/
  wan_action.sh`'s `set_ttl`/`get_ttl`, persisted to `openmodem.conf`'s
  `TTL_VALUE` and re-applied at boot by `bin/apply_iptables.sh` via a
  new `openmodem-iptables.service`). It was originally a front-end for
  SimpleFirewall, a separate pre-existing package on the dev device with
  its own `ttl-override.service` managing the identical mechanism — but
  that introduced a hard third-party dependency (and the project's only
  bash requirement) that contradicts `CLAUDE.md`'s "no additional
  software installed on the modem" constraint, so `installer.sh` now
  removes SimpleFirewall entirely instead of depending on it (see
  "Install / update" and "Verified against real hardware" below).
  `wan_action.sh`'s `set_ttl` deletes the specific old rule by value
  before inserting the new one — deliberately never a full `-F
  POSTROUTING` flush, which would also silently wipe two unrelated
  Qualcomm baseband rules (`qcom_qos_reset_POSTROUTING`/
  `qcom_qos_filter_POSTROUTING`) sharing that chain on this hardware;
  confirmed live when an earlier flush-based cleanup step did exactly
  that. `bin/apply_iptables.sh` also now owns the web-UI port (8080)
  protection SimpleFirewall used to provide (allow from
  `bridge0`/`eth0`/`tailscale0`, drop elsewhere) — scoped to just that
  one port, not the three others (80/8088/443) SimpleFirewall blocked,
  since those belonged to other tools this project doesn't run.
  `installer.sh` also migrates any value already sitting in
  SimpleFirewall's `ttlvalue` file into `openmodem.conf`'s `TTL_VALUE`
  before removing it, so an operator's existing TTL spoofing survives
  the switch instead of silently reverting to disabled.
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
- **Explicit exception: WAN's "Internet" card** (ISP, ASN, hostname,
  IPv4, IPv6, Location via `ipinfo.io`) — internet-dependent by
  definition, which is exactly the category this section otherwise
  excludes, but added by explicit request. Originally a direct browser
  `fetch()` to ipinfo.io (matching QuecControl's `wan.html`), then moved
  server-side: `www/cgi-bin/internet_info.sh` (new) runs `curl` on the
  modem itself and passes ipinfo.io's response straight through (or a
  `{"success":false,"error":...}` shape on failure, since ipinfo.io's
  own shape has nothing to key an error off of); `app.js`'s
  `fetchWanInternet()` just hits that endpoint once on page load, no
  polling interval. `org`'s `"AS7018 AT&T Services, Inc."` shape is
  split into separate ISP/ASN fields since the card shows them as
  distinct rows. ipinfo.io's response only ever has one `ip` field, for
  whichever protocol the modem's `curl` actually used — routed into the
  IPv4 or IPv6 row by its shape (colon = v6) rather than assumed,
  leaving the other blank. Still deliberately doesn't reuse the modem's
  own `wan_ip`/`wan_ipv6` (AT-sourced, already on the Status card) for
  those two rows — this card is specifically what ipinfo.io itself
  reports, which can legitimately differ (carrier-side NAT, etc.).

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
  **SimpleFirewall**, or **OpenModem** install (services, systemd units,
  `/usrdata/*`, `/tmp/*` runtime state) so only one admin UI runs on the
  device at a time. All names are confirmed against a real device (see
  "Verified against real hardware" below) — SimpleAdmin (from
  `iamromulan/quectel-rgmii-toolkit`) runs `simpleadmin_httpd.service` +
  `simpleadmin_generate_status.service` out of `/usrdata/simpleadmin`,
  plus a separate `socat-at-bridge` toolkit (`socat-smd11*`/`socat-smd7*`
  units out of `/usrdata/socat-at-bridge`) that bridges `/dev/smd11` to
  pty pairs for it — that has to be removed too, not just SimpleAdmin
  itself, since it and our own `at_broker.sh` would otherwise both try to
  own `/dev/smd11` at once. SimpleFirewall (also part of that toolkit —
  `simplefirewall.service` + `ttl-override.service`, out of
  `/usrdata/simplefirewall`) is removed too: it independently managed
  the same iptables rules OpenModem now owns itself (TTL spoofing and
  web-UI port protection — see "WAN status/actions" above), and two
  independent managers of the same rules silently conflict. Tailscale is
  the only thing from that toolkit still deliberately left alone —
  unrelated, nothing here conflicts with it.
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
- TTL spoofing went through two designs this session. First, a
  front-end for SimpleFirewall's pre-existing `ttl-override` script —
  confirmed working via direct `adb shell` testing of its stop→write→
  start sequence (swapping 88→65 produced exactly one active rule at
  each step, no stacking) — but discovering that live SimpleFirewall
  rule mid-testing (and briefly flushing it, then restoring it) surfaced
  both the hard third-party dependency and the flush-risk to Qualcomm's
  QoS rules described under "WAN status/actions" above, so it was
  replaced with OpenModem's own iptables rule instead, and SimpleFirewall
  was removed from the device entirely rather than kept as a dependency.
  The new implementation (`wan_action.sh`'s targeted-delete `set_ttl`,
  `bin/apply_iptables.sh`'s boot-time re-application, `installer.sh`'s
  port-8080 protection + SimpleFirewall removal) has **not** itself been
  exercised through the actual CGI endpoint/UI or a real reboot yet —
  only the underlying iptables command shapes were verified in isolation
  during the SimpleFirewall-era testing above. Verify: `set_ttl` via the
  WAN page, and that `openmodem-iptables.service` actually re-applies
  `TTL_VALUE` and the port-8080 rule after a real power cycle (not just
  `systemctl start`).
- Dual-SIM tested live end-to-end via `adb shell`/`at_command.sh`
  directly (not yet through `sim_action.sh`'s actual CGI endpoint):
  `AT+QUIMSLOT=?` confirms 2-slot support; switching to slot 2
  (`AT+QUIMSLOT=2`) returned `OK` in ~0.35s, but `adb devices` then
  reported no device for several seconds and reconnected with a
  **different USB `transport_id`** — a real re-enumeration, not just a
  SIM reinit. `openmodem-broker`/`-poller`/`-httpd` were all still
  `active` afterward with no manual restart needed, and the poller's
  `state_merged.json` was fresh — full self-recovery within ~5s.
  Slot 2 had no physical SIM on this device (`AT+CPIN?` →
  `+CME ERROR: 10`, `AT+QCCID`/`AT+CIMI` → similar), confirmed while
  switching back to slot 1 to restore original state (also confirmed
  clean: `+QUIMSLOT: 1`, `CPIN: READY`, ICCID matched the pre-test
  value). `AT+CNUM` returned a real subscriber number on the first try.

## Open questions

- Interface up/down for WAN is still unimplemented.
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
