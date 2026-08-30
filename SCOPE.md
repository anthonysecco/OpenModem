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
  `carrier_scan.sh`. Band Lock is collapsed by default behind a
  QuecControl-style disclosure toggle (`app.js`'s generic
  `initCollapsible()`) rather than an always-visible card — the band
  data itself still loads eagerly on page load either way, only
  visibility is gated. Neighbor Cells (`AT+QENG="neighbourcell"`) was
  implemented, then removed by explicit request — see "Out of scope".
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
- **Web UI authentication** — the entire site (not just action endpoints)
  sits behind BusyBox httpd's own built-in Basic Auth, confirmed live
  (2026-08-29) via a disposable httpd instance on a spare port before
  wiring it into the real service: the auth config format is a plain
  `/path:user:crypt-hash` line in a `-c CONFFILE`, realm set separately
  via `-r REALM`, and `busybox httpd -m STRING` generates an MD5-crypt
  hash — all built into the exact BusyBox 1.31.1 this project already
  runs, no new software. Default credentials are `admin`/`admin`.
  `bin/apply_httpd_auth.sh` (run via `openmodem-httpd.service`'s
  `ExecStartPre`, since BusyBox httpd only reads `-c` at startup — no
  hot-reload) regenerates `/usrdata/openmodem/httpd_auth.conf` from
  `openmodem.conf`'s `WEB_AUTH_USER`/`WEB_AUTH_HASH`, lazily seeding the
  default credential into `openmodem.conf` itself the first time it runs
  on a device whose config predates this feature (same migration
  approach as SimpleFirewall's `ttlvalue` -> `TTL_VALUE`). The System
  page's Change Password card (`www/cgi-bin/auth_action.sh`) hashes a
  new password, persists it, and restarts `openmodem-httpd.service` +
  `openmodem-poller.service` — the restart is deliberately deferred a
  couple seconds inside its own detached `systemd-run` unit rather than
  fired immediately, since `auth_action.sh` runs as a CGI child inside
  `openmodem-httpd.service`'s own cgroup and an immediate
  `KillMode=control-group` restart risks killing that still-running
  script before its JSON response reaches the browser (same failure
  mode `update.sh`'s own restart already works around, documented
  there). No current-password re-entry is required to change it: the
  request already had to pass Basic Auth to reach the endpoint at all.
  A site-wide warning banner (driven by `state.sh`'s
  `web_auth_is_default`, itself a passthrough of `openmodem.conf`) links
  to that card until the password is changed away from the default.
  `WEB_AUTH_HASH` must stay single-quoted everywhere it's written into
  `openmodem.conf`: the file is dot-sourced as real shell, and an
  unquoted `$1$salt$hash` is parsed as positional-parameter expansion,
  silently corrupting the hash — confirmed live before catching it.
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
- **Connected Clients** — a full-width table (Hostname/IP/MAC/Lease
  Expires) on the LAN page listing current DHCP leases. Not AT-sourced
  like the rest of this project's data — confirmed live (2026-08-29)
  that LAN client info instead comes from dnsmasq's own lease file,
  `/var/run/data/dnsmasq.leases` (path taken from the actual running
  `--conf-file`, `/var/run/data/dnsmasq.conf.bridge0`'s
  `dhcp-leasefile=` setting, not dnsmasq's compiled-in default), on
  `bridge0` — the same interface the web UI itself is served on.
  World-readable and `httpd` runs as root, so no permission gap.
  `www/cgi-bin/lan_clients.sh` parses it directly (separate from
  `at_poller.sh`, matching the LAN-client-info note elsewhere in this
  doc) and `app.js`'s `fetchLanClients()` polls it on its own fixed
  15s interval, independent of `state.sh`'s cadence since leases have
  nothing to do with the AT poller's cycle. A hostname of `*` (dnsmasq's
  own "none given" marker) renders as `—`, same convention as every
  other missing field.
- **GPS** — a new GPS page (Control/Position/Movement cards), moved here
  from "Out of scope" 2026-08-30 after being implemented. Deliberately
  drops QuecControl's Satellites breakdown, Location (Nominatim reverse
  geocode), and Live Map (Leaflet/OSM tiles) cards — the latter two for
  the same internet-dependency exclusion this doc applies elsewhere,
  Satellites by explicit request when this was picked back up. This
  module only speaks the `AT+QGPS*` family (`AT+CGNSSINFO`, used on some
  other Quectel SKUs, confirmed returns plain `ERROR` here, re-confirmed
  2026-08-30). `www/cgi-bin/gps_action.sh`'s `enable`/`disable` run
  `AT+QGPS=1`/`AT+QGPSEND` (both confirmed live, clean disable-then-
  re-enable cycle, no side effects) and touch/remove a presence-only flag
  file (`GPS_FLAG`, `/tmp/openmodem/gps_enabled`) rather than a dedicated
  script owning any other state. `bin/at_poller.sh`'s main loop appends
  `;+QGPSLOC=2` to its per-cycle AT chain only while that flag file
  exists (checked once per cycle, not a live `AT+QGPS?` round trip) —
  always as the last block (33) so blocks 1-32's fixed `nth_block()`
  indices never shift whether or not GPS is enabled. Mode 2 returns
  decimal degrees directly, unlike QuecControl's `=0` which returns raw
  NMEA `ddmm.mmmm` needing manual conversion.
  - `enable` also sets `AT+QGPSCFG="nmeasrc",1` — a real finding from
    this session: `nmeasrc` had drifted back to `0` since earlier
    sessions confirmed the `AT+QGPSGNMEA` family working (see below),
    silently breaking every `QGPSGNMEA` sentence with `+CME ERROR:
    Function not enable` until re-set. Not otherwise used by this
    feature (the Satellites/`GSV` card that would have needed it was
    dropped), but set defensively so a GNMEA-based feature added later
    doesn't have to rediscover this.
  - **No fix ever obtained**, now across three separate live sessions on
    this hardware (two multi-minute sessions plus this one) — one saw a
    single weak satellite (PRN 31, SNR 26), another zero, this one saw 8
    satellites in `AT+QGPSGNMEA="GSV"` but all with blank SNR (detected,
    not tracked) and `AT+QGPSLOC=2` consistently returned `+CME ERROR:
    Not fixed now`. Points at the GNSS antenna (connection or sky
    visibility), not the command set, which is fully functional —
    `AT+QGPS=1`/`AT+QGPS?`/`AT+QGPSEND` and every `AT+QGPSGNMEA` sentence
    (`GGA`/`RMC`/`GSV`/`GSA`/`VTG`/`GNS`) all confirmed working once
    `nmeasrc` was set.
  - **`+QGPSLOC=2`'s success-response field order is UNCONFIRMED** on
    this hardware — `collect_gps()`'s parsing (`UTC,lat,lon,hdop,
    altitude,fix,cog,spkm,spkn,date,nsat`) follows Quectel's documented
    shape (same order QuecControl's own GPS page assumes), but only the
    no-fix error path has actually been exercised live. Verify
    field-by-field against a real fix (antenna fixed, or tested outdoors)
    before trusting `gps_lat`/`gps_lon`/etc. blindly.
  - Not yet exercised: `gps_action.sh`'s actual CGI endpoints (only the
    underlying AT commands were tested directly via `at_command.sh`), and
    the GPS page itself against a real browser/live poller cycle.

## Out of scope

- **Neighbor Cells** (`AT+QENG="neighbourcell"`) — implemented as a
  full-width table (EARFCN/PCI/Tech/Band/RSRP) and confirmed live
  against real hardware (see "Verified against real hardware" — that
  bullet is kept as historical record of the finding, same as VLAN
  tagging below it), then dropped entirely by explicit request in favor
  of narrowing the Cellular page to Carrier Aggregation/Band
  Lock/Carrier Scan. No longer present in `at_poller.sh`, `app.js`, or
  the Cellular page.
- **Scout (ping/latency tests)** — QuecControl's `ping.sh`/`force_poll.sh`.
  Actively tests internet connectivity; dropped because OpenModem is
  narrowing away from features that assume a working internet connection.
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
- **Skip-if-unchanged, verify-before-install, and automatic rollback**
  (2026-08-22): `installer.sh` now resolves the target commit via
  GitHub's API *before* downloading anything (moved up from a
  display-only lookup after the download) and exits immediately if it
  already matches the installed `VERSION` — `OPENMODEM_FORCE_INSTALL=1`
  bypasses this for repairing a corrupted install without a new commit.
  An unresolved SHA (rate-limited/network hiccup) is never treated as a
  match. Staged files are then verified (non-empty + `sh -n` on every
  script) before step 5, the actual point of no return. Step 5 also now
  backs up OpenModem's own previous install (code + systemd units, to
  `/usrdata/openmodem.bak`/`.units.bak`) instead of deleting it outright
  — deliberately scoped to OpenModem only, never QuecControl/SimpleAdmin/
  SimpleFirewall, since removing those stays a one-way migration. The
  post-start health check that already existed now gates cleanup (all
  healthy → delete the backup) vs. automatic rollback (anything
  unhealthy → stop new services, restore the backed-up code/units,
  restart, and leave the broken attempt at `INSTALL_DIR.failed` for
  inspection).
  - All four paths confirmed live end-to-end: (1) skip — re-running the
    installer against an already-installed commit exited at step 2
    without touching anything; (2) `OPENMODEM_FORCE_INSTALL=1` correctly
    bypassed the skip and reinstalled the same commit; (3) a genuine
    update (previous commit → this one) ran the full flow successfully
    and cleaned up its backup; (4) rollback — a throwaway git branch
    (never merged to main) with `apply_iptables.sh` replaced by a bare
    `exit 1` was installed via a SHA-pinned URL, deterministically
    failed the Firewall/TTL health check (`Type=oneshot` has no
    `Restart=`, so `is-active` reports failed reliably, unlike the
    pgrep-based checks which are timing-dependent), and the installer
    correctly rolled back: `VERSION` showed the prior good commit,
    all 5 services were active, the real iptables rule was reapplied,
    and the web UI responded correctly — verified from the host, not
    from the device's own shell, since curling the device's own LAN IP
    from *inside* the device doesn't traverse `bridge0`/`eth0`/
    `tailscale0`, so apply_iptables.sh's own port-8080 allowlist rule
    drops it — a firewall-scoping fact, not a rollback bug.
- **Two prior-install cleanup gaps found via `adb shell` on the real
  device** (2026-08-28), neither caught by the verification above because
  that pass only exercised OpenModem-to-OpenModem transitions, not an
  actual QuecControl/QuecManager device: (1) step 5's `/usrdata` removal
  list (`quecmanager`, `simpleadmin`, `socat-at-bridge`, `simplefirewall`)
  never included `/usrdata/queccontrol` itself — a real QuecControl
  install (`bin/`, `www/`, `config/queccontrol.conf`) was found still on
  disk despite the step's own banner claiming to remove QuecControl.
  (2) the stop/disable loop and every `rm -f` glob in step 5 only ever
  matched `*.service` — a `quecmanager-startup.timer` (systemd's separate
  `.timer` unit type, `OnBootSec=30sec` triggering
  `quecmanager-startup.service`) survived every reinstall since its
  target service was a plain `.service` name but the timer file itself
  never was. Left `enabled`, referencing a `not-found` service forever.
  Neither was actively running anything (no `queccontrol-*` systemd
  units, no init.d script, no cron entry — the queccontrol directory was
  dead files, and the timer was `inactive`/`dead` with no journal
  entries), but both are exactly the kind of leftover step 5 exists to
  remove. Fixed: added the missing `/usrdata/queccontrol` line, and
  parameterized the stop/disable loop and every glob over both `service`
  and `timer` suffixes (plus `timers.target.wants` alongside
  `multi-user.target.wants`) so any future `.timer`-based leftover from
  any of the four prior tools gets caught too.

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
- `AT+QENG="neighbourcell"` confirmed live: 3 "intra" (same-frequency)
  neighbors with real PCID/RSRQ/RSRP/RSSI/SINR, all sharing EARFCN 800
  (band 2, matching this session's own serving-cell/CA band elsewhere
  in this doc — expected, since same-frequency neighbors are on the
  serving cell's own frequency by definition), plus 6 "inter"
  (different-frequency) neighbors that all reported `-` for every field
  except EARFCN — confirmed the RSRP-must-be-numeric filter correctly
  drops exactly those 6 and keeps the 3 real ones.
- Carrier Aggregation's extended `+QCAINFO` parsing (EARFCN/bandwidth/
  PCI/RSRP/RSRQ/SINR per component carrier, ported from QuecControl —
  see "Visual redesign") confirmed live (2026-08-15): a real 3-CC
  session (PCC LTE BAND 2 @ 20MHz, 2x SCC LTE BAND 66 @ 5MHz/10MHz) came
  back with correct per-carrier PCI/RSRP/RSRQ/SINR and the decoded
  `bw_mhz` summed to the modem's actual total (35MHz). The server-side
  throughput estimate (`compute_ca_throughput`, also ported from
  QuecControl) produced `ca_dl_estimated_mbps: 70` / `ca_dl_maximum_mbps:
  210` for that session — plausible given the reported SINR/RSRQ, but
  the estimate itself has no independent ground truth (no throughput
  test was run against it).
- `compute_ca_throughput`'s efficiency constant got two real-world
  ground-truth points on 2026-08-21, and they pulled in opposite
  directions: an earlier 3-CC session (SINR ~5-11dB) measured 133-
  136Mbps real against a 94-95Mbps estimate (real exceeded estimate,
  prompting `THROUGHPUT_EFF=0.75` to replace the old double-derated
  0.525 combined factor), while a later 3-CC session same day (PCC LTE
  BAND 2 @ 20MHz SINR 9, 2x SCC LTE BAND 66 SINR 11, solid signal on all
  three carriers, `ca_dl_estimated_mbps` 189-211) measured only
  ~124-140Mbps real across single- and multi-connection (up to 8
  parallel streams, sustained ~13s) speed tests run from a LAN client
  behind the modem — real came in well *under* the estimate this time,
  and did not scale up with more parallel connections, meaning the
  ceiling was not TCP-window- or CA-scaling-limited. Research into how
  others calculate this (industry LTE/5G throughput write-ups) explains
  the split: ~25% PHY-layer overhead (reference signals, PDCCH, sync
  signals) is roughly constant and is what `THROUGHPUT_EFF=0.75` already
  models correctly, but real deployments lose a separate, much larger,
  and highly variable amount to scheduler/cell-load sharing (cited
  figures: a single user gets roughly half of max throughput at 50%
  cell utilization and roughly a quarter at 75%) — and that loss is not
  observable from this modem's RSRP/RSRQ/SINR at all, since those
  describe link quality, not how many other devices the tower is
  serving. Rather than re-tuning `THROUGHPUT_EFF` to split the
  difference between two data points that reflect different (unknowable)
  cell-load conditions, added a separate `SCHED_EFF=0.55` applied only
  to `dl_estimated_mbps` (not `dl_maximum_mbps`, which stays a best-case
  ceiling) as an explicit, deliberately conservative assumption about
  typical cell sharing — not a value future signal data could ever
  refine, since no AT command on this modem reports actual PRB
  utilization/cell load.
- Cellular's Network card (Network Mode / Data Roaming selectors, added
  when Signal/Registration/Serving Cell were split into per-RAT LTE and
  5G NR cards) needed two AT commands whose exact names weren't
  documented anywhere in this project — found live by querying
  `AT+QNWPREFCFG=?` and `AT+QNWCFG=?`'s own subcommand lists rather than
  guessing from other Quectel modules' docs (2026-08-17):
  `AT+QNWPREFCFG="mode_pref"` (colon-separated RAT list, same style as
  `lte_band`/`nr5g_band`; current value read back `AUTO`) and
  `AT+QNWCFG="data_roaming"` (plain `(0,1)` toggle; current value `0`).
  The more commonly-documented Quectel roaming command elsewhere,
  `AT+QCFG="roamservice"`, does **not** exist on this firmware — it
  returned `ERROR` and is absent from `AT+QCFG=?`'s full list, confirmed
  live before settling on `data_roaming` instead. Both commands' SET
  forms were also confirmed live (set to their own current values,
  non-disruptively) before shipping. A related real bug found in the
  same session: `at_poller.sh`'s single whole-cycle AT chain aborts at
  the first sub-command that ERRORs (already known — see CNUM's ordering
  above) — `mode_pref`/`data_roaming` were first placed *after*
  `nr5g_mimo_info` in that chain, which errors whenever there's no
  active NR component carrier (the normal case on this LTE-only test
  connection), and both fields came back silently `null` as a result.
  Fixed by reordering them before `nr5g_mimo_info` instead.
- **Systemd watchdog on the broker and poller** (2026-08-22): both units
  moved from `Type=simple` to `Type=notify`/`NotifyAccess=all` with a
  `WatchdogSec`, so a wedged-but-not-crashed process (the failure mode
  `Restart=always` alone can't catch, since there's no process exit to
  restart on) gets killed and restarted automatically. `NotifyAccess=all`
  is required, not the default `main` — `systemd-notify` runs as a forked
  child of the script, a different PID than the unit's `MainPID`, so
  `main` would silently reject its notifications. Mechanism confirmed
  live end-to-end against this device (systemd 244, `/bin/systemd-notify`
  present) via a disposable test unit before touching the real daemons:
  3 heartbeats followed by a deliberate stall triggered
  `Result: watchdog` and a clean auto-restart within `WatchdogSec`.
  - `at_broker.sh`: `read -t 5` on the FIFO fd (confirmed live this works
    fine on a FIFO, unlike `AT_DEVICE`'s raw character device, which is
    the only place CLAUDE.md's "no `read -t`" caveat actually applies) so
    idle periods heartbeat too, not just active ones. The per-request
    polling loop also heartbeats roughly once per second so a legitimately
    long wait (a 130s carrier scan) doesn't trip a watchdog tuned to catch
    a *hung* single ~100ms `cat`/`kill`/`wait` cycle — `WatchdogSec=20`.
  - `at_poller.sh`: one heartbeat per cycle, right after `run_at` (the
    one call that can legitimately block) returns — `WatchdogSec=45`,
    comfortably above the ~15s command-chain timeout plus processing.
  - Not yet exercised against a real wedge on the actual broker/poller
    (only the disposable test unit was pushed to failure); verify after
    this ships that a genuine hang — e.g. induced by killing the AT
    device mid-request — actually triggers a real-world restart, not just
    the isolated mechanism.
- **Stale AT-response-file cleanup** (2026-08-22): `at_command.sh` deletes
  its response file after a successful read, but a client that gives up
  waiting (its own `wait_limit` elapses first) leaves the broker's
  eventual write in `/tmp/at_responses/` forever — `/tmp` is tmpfs, and
  nothing previously reaped these except a full broker restart (its
  startup/shutdown both `rm -rf "$RESPONSE_DIR"`). `at_broker.sh` now
  prunes response files older than 180s every 10 requests, using the
  epoch second already embedded in `req_id`'s 2nd underscore-field
  (`at_command.sh`: `"$$_$(date +%s)_XXXXXX"`) rather than relying on
  BusyBox `find`'s `-mmin`/`stat` support, which wasn't verified present
  on this firmware.
- **A second physical card exercised a live NR5G-NSA session for the
  first time** (2026-08-28, `www` audited directly over HTTP against
  `192.168.225.1:8080` rather than `adb`/`at_command.sh`) — the original
  test card never carried an active NR component carrier. This both
  confirmed several previously-untested assumptions and surfaced a real
  bug that had been silently breaking the Serving Cell card and Network
  Type badge on this card the whole time:
  - `AT+QENG="servingcell"`'s response shape differs from the original
    test card's: instead of embedding state directly in each RAT line
    (`"servingcell","STATE","LTE","FDD",...`), this card emits a
    separate state-only header line (`"servingcell","NOCONN"`) followed
    by standalone `"LTE"`/`"NR5G-NSA"` data lines with no state/
    `"servingcell"` tag at all. `collect_serving_cell()`'s old line
    filter (`grep '^+QENG:.*"servingcell"'`) assumed every relevant line
    repeated that tag and silently dropped both real data lines on this
    shape, leaving `cell_lte_active`/`cell_nr_active` false and every
    `cell_lte_*`/`cell_nr_*` field null despite a fully healthy,
    high-throughput 3-CC LTE+NR5G-NSA session — which in turn blanked
    the Serving Cell card, showed `—` for Network Type everywhere it's
    used (Dashboard card + topbar), and dropped the PCC's UL segment
    from the CA bandwidth bar (`F_CELL_LTE_UL_BW_MHZ`, sourced from this
    same broken parse). Fixed by matching any `"+QENG:"` line and
    falling back to the header line's state when a data line doesn't
    carry its own. Also worth noting: that header line read `"NOCONN"`
    on *every* poll throughout the healthy session, so it's captured
    for display only now, never used to gate the `*_ACTIVE` flags.
  - `AT+QENG="servingcell"`'s NR5G-NSA field layout (previously ported
    from Quectel's docs, UNCONFIRMED) is now **confirmed live**:
    PCID/RSRP/RSRQ/ARFCN/bandwidth all matched that same session's own
    `+QCAINFO` NR5G row almost exactly (RSRQ within 1dB, everything else
    exact).
  - `AT+QNWCFG="nr5g_mimo_info"`'s field layout (previously assumed
    identical to `lte_mimo_info`'s, UNCONFIRMED — this device had always
    returned `ERROR` for it before) is now **confirmed live**:
    `+QNWCFG: "nr5g_mimo_info",480,647328,2,1` matches the assumed
    `PCID,freq,layers,is_pcell` order exactly, PCID/freq matching that
    same session's serving NR carrier.
  - `+QCAINFO`'s NR5G line genuinely never reports SINR at all
    (previously documented from the command's spec, now also confirmed
    live) — the CA table's NR row now fills that one gap from
    `AT+QENG`'s NR5G-NSA line instead (matched by PCID, so a session
    with more than one active NR component carrier — never observed —
    degrades gracefully to leaving the non-matching rows null rather
    than reusing one carrier's reading for another). This also fixed a
    quieter bug: `compute_ca_throughput` was already substituting a
    fallback SINR into that row's throughput math (via `AT+QSINR`'s
    aggregate reading) without ever displaying it — and that fallback
    disagreed with the real per-carrier reading by ~5dB in this session,
    enough to roughly double the spectral-efficiency lookup it fed into.
  - Unrelated bug caught by the same live session: `compute_ca_throughput`'s
    `json_field()` awk helper couldn't distinguish a bare JSON `null`
    token from literal text, so any per-carrier field that was
    genuinely null (confirmed: `ul_earfcn` on every row of this session,
    since none had a current uplink grant) re-serialized as the JSON
    *string* `"null"` instead of a real `null`. `numish()` already
    special-cased this for its own numeric-fallback logic but the
    plain string-passthrough output fields didn't share the guard.
    Fixed at the source in `json_field()` itself.

## Open questions

- Factory reset was deliberately left out of Power (QuecControl has it;
  wasn't asked for here and is hard to make safely reversible) — revisit
  if actually needed.
- NR5G's *headline* RSRP/RSRQ/SINR (the Signal card's `signal_nr_*`
  fields in `state.sh`) still come from `AT+QRSRP`/`QRSRQ`/`QSINR`,
  unlike LTE's equivalents, which were switched to `AT+QCAINFO`'s PCC
  row (see `bin/at_poller.sh`'s `collect_carrier_aggregation`) after live
  testing showed `QRSRP` diverging from `QCAINFO`/`QENG` by a consistent
  ~5-7dB on this device's LTE serving cell. A second card's first-ever
  live NR5G-NSA session (2026-08-28, see above) resolved the CA table's
  own SINR gap for the NR row (now sourced from `AT+QENG`'s confirmed
  NR5G-NSA line instead of a coarser aggregate), but deliberately left
  this broader question open: whether the *headline* NR RSRP/RSRQ/SINR
  fields should also switch from `QRSRP`/`QRSRQ`/`QSINR` to
  `QCAINFO`/`QENG` the same way LTE's did. That would need its own
  divergence check (LTE's switch was driven by a measured ~5-7dB gap
  between the two sources; NR hasn't had that comparison run yet) rather
  than assuming the same conclusion applies. `AT+QENG="servingcell"`'s
  NR5G-**SA** field layout (as opposed to NSA, which is now confirmed —
  see above) is still entirely UNCONFIRMED — no card has carried an
  active SA session yet, only NSA.

## Future enhancement candidates (2026-08-20)

Not started, not scoped in detail — parked here as candidates rather than
closed decisions.

- **Connectivity watchdog / auto-recovery.** `bin/net_poller.sh` already
  tracks consecutive `check204` failures for the dashboard pill but never
  acts on them. Idea: an escalation ladder — after N consecutive failures,
  radio-cycle (`AT+CFUN=0` then `AT+CFUN=1`); after M, a full reboot
  (`AT+CFUN=1,1`). Reuses data already being collected; the main design
  question is where the thresholds/backoff live (`openmodem.conf`, most
  likely) and how to avoid a reboot loop if the failure is upstream of the
  modem entirely (e.g. a dead SIM/plan) rather than something a
  radio-cycle can fix.
- **Webhook notifications on state transitions.** `www/cgi-bin/
  internet_info.sh` already proves the pattern of the modem itself
  `curl`-ing out to a third party (documented in `DEPENDENCIES.md`). Idea:
  a `NOTIFY_WEBHOOK_URL` in `openmodem.conf` that POSTs on WAN down/up,
  signal-poor, high-temp, or TTL-rule-reapplied events. Would need a new
  `DEPENDENCIES.md` row once built, same as the ipinfo.io/gstatic entries.
- **Config backup/restore.** Export `openmodem.conf` + band lock + LAN
  config as a single JSON blob from the System page, importable back in.
  Useful before/after `update.sh` runs, or to replicate settings to a
  second unit. No AT-side risk — this is read/write of local config state
  only.

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
- **Carrier Aggregation card redesigned to match QuecControl's layout**
  (stat summary, bandwidth bar, per-carrier table), styled with
  OpenModem's own palette rather than QuecControl's dark-theme colors —
  see the "Redesign Carrier Aggregation card" commit for the throughput
  estimate this introduced. The bandwidth bar was then updated again to
  label each segment with its actual DL frequency range (not just a
  proportional color block), ported from QuecControl's
  `LTE_BAND_TABLE`/`nrArfcnToMhz` (`app.js`'s `carrierCenterFreqMhz()`)
  — LTE uses the exact per-band DL-low/step/EARFCN-offset table (3GPP TS
  36.101), NR the exact piecewise ARFCN formula (3GPP TS 38.104), both
  intentionally DL-only since this card is downlink-focused throughout.
  Segments are sorted left-to-right by ascending center frequency
  (matching QuecControl); the per-carrier table below stays in the
  modem's own reported order (PCC first, then each SCC), same split
  QuecControl itself uses. The old dot+text legend was dropped in favor
  of the frequency labels doing that job directly, matching
  QuecControl's own current direction. The per-carrier table's columns
  now match QuecControl's set (Carrier/BW/EARFCN/PCI/RSRP/SINR/DL
  Est-Max) with a colored PCC/SCC badge in the Carrier column, though
  intentionally without QuecControl's inline mini progress-bars in RSRP/
  SINR/throughput cells — kept to plain text, consistent with this
  project's other data tables (Neighbor Cells, when it existed, was the
  same).
