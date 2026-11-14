# Device capabilities survey (RM520N-GL)

> Field notes from an on-device exploration of the Quectel RM520N-GL (Qualcomm
> SDX65 / sdxlemur). A throwaway Go collector was used to validate the QMI-over-QRTR
> data path; **that code is R&D and is deliberately not part of this repo** (see
> [architecture-decisions.md](architecture-decisions.md) for why the product stays on
> AT + shell). What follows is the knowledge, not the tooling.

---

# OpenModem — Device Capability Survey

Exploration notes for the next phase: what the modem's onboard Linux actually
exposes beyond the AT interface, and what we could build on it. Gathered by
deploying an experimental telnet root shell (`openmodem-telnet.service`, this
branch) to modem **192.168.225.1** and inventorying the live device.

- **Date:** 2026-11-13
- **Target:** Quectel RM520N-GL, firmware `RM520NGLAAR03A04M4G_01.202.01.202`
- **Access used:** `dev2 → ssh rigatony → ssh omp-remote1 (10.0.0.1) → telnet 192.168.225.1:23`
- **Note:** a second, identical modem lives on the same host at
  `192.168.226.1:8080` (not surveyed; same platform assumed).

> ⚠️ **Standing exposure:** modem 1 currently runs a **passwordless root
> telnet on :23** (what this survey used). It should be turned off when the
> exploration phase ends — see [Cleanup](#cleanup).

---

## 1. Platform / hardware

| Property | Value |
|---|---|
| SoC | Qualcomm **SDX65** (`sdxlemur`), "Flattened Device Tree" |
| CPU | **single-core ARMv7** (Cortex-A7 class), `armv7l`, 1 x 1.80 GHz, gov `ondemand` |
| Kernel | **Linux 5.4.210-perf**, PREEMPT, built with clang 10 |
| Distro | QTI Linux reference `nogplv3-perf`, `LE.UM.6.3.6.r1-02600-SDX65.0` |
| Userland | **BusyBox v1.31.1** + systemd |
| RAM | **182 MB** total, ~130 MB used, ~28 MB free, ~54 MB available |
| Swap | **91 MB zram** (14 MB used) |
| Uptime at survey | 41 days |

**Takeaway:** this is a *constrained* single-core ARMv7 box with ~50 MB of
practical headroom. Anything we add has to be lightweight. No GPU, no second
core to lean on.

### Storage (flash layout)

| Mount | FS | Size | Used | Notes |
|---|---|---|---|---|
| `/` (`ubi0:rootfs`) | UBIFS | 100 MB | 51 % | **read-only** (`assert=read-only`; remounts rw per CLAUDE.md) |
| `/usrdata` (`ubi2_0`) | UBIFS | 124 MB | 48 % | **writable** — the only real scratch space (~64 MB free) |
| `/firmware` (`ubi1_0`) | UBIFS | 91 MB | 71 % | modem firmware, ro |
| `/tmp`, `/run`, `/var/volatile` | tmpfs | 89 MB each | — | RAM-backed |

Raw flash is 29 NAND partitions (`/proc/mtd`): `sbl`, `mibib`, **`efs2`**
(modem NV/EFS, 22 MB), `tz`, `aop`, `abl`, `uefi`, `boot`, `recovery`,
`multi_fota`, etc. `/usrdata` is where everything custom already lives
(OpenModem, a bundled Tailscale, Quectel config).

**Budget for "our own application":** realistically **a few tens of MB on
`/usrdata`** and **single-digit to low-tens of MB RAM**. Design for that.

---

## 2. What runs today (software baseline)

**Interpreters present:** `sh`/`ash`/`bash`, BusyBox `awk`. 
**Interpreters absent:** no **python / perl / lua / node**, no `gcc`/toolchain
on-device, **no package manager** (`opkg`/`apt`/`dnf`).

> **Implication for "load our own application":** scripting is limited to
> POSIX shell + awk. Anything heavier must be a **cross-compiled native
> binary for `armv7l`** (static, or against the device's glibc), dropped into
> `/usrdata` and run under a systemd unit — exactly the pattern OpenModem's
> installer already uses. **Go is proven to work here:** the device ships and
> runs Tailscale's ~16/30 MB static ARM Go binaries (`/usrdata/tailscale/`),
> so a small static **Go** or **C** daemon is the realistic path for anything
> beyond shell. This is a bigger step than the current "no added software"
> scope — see `SCOPE.md` before committing to it.

### Running services (systemd) — notable

- **OpenModem:** `openmodem-broker/poller/httpd/netpoller` (+ our new
  `openmodem-telnet`). Confirmed running `COMMIT_SHA=8ce6924…`.
- **Qualcomm Mobile-AP stack:** `QCMAP_ConnectionManagerd`, `netmgrd`,
  `ipacm` (+`ipacmdiag`), `port_bridge`, `dnsmasq@0` (DHCP/DNS for the LAN).
- **Quectel daemons:** `quectel_daemon`, `quectel-monitor-daemon`,
  `quectel-voice-server` (VoLTE/voice), `ql-netd`, `ql-nw-service`,
  `ql-remotefs-daemon`, `atfwd_daemon` (AT command forwarding).
- **Diagnostics / logging:** `diag-router`, `adbd` (USB ADB, localhost :5037),
  `tftp_server` (TFTP), `busybox-syslog`, `serial-getty@ttyMSM0` (console).
- **Location:** `loc_launcher`, `location_hal_daemon` (GNSS/SUPL).
- **Remote access:** `tailscaled` (running, but **logged out** — see §4).

### Listening ports (modem)

| Port | Service | Scope |
|---|---|---|
| `8080/tcp` | OpenModem httpd | LAN (Basic Auth, still `admin/admin`) |
| `53` tcp/udp, `67/udp` | dnsmasq (DNS + DHCP) | LAN |
| `23/tcp` | **telnetd (our temp root shell)** | LAN — remove later |
| `127.0.0.1:5037` | adbd | localhost only |
| `41641/udp` | tailscaled | all |
| `11111/12222/22222` udp | port_bridge / quectel_daemon | localhost |

---

## 3. Data available (beyond AT)

The AT broker (`/dev/smd11`) is only one of several data planes. Richer
sources already on the box:

- **QMI (Qualcomm MSM Interface)** — the native control/telemetry bus the
  Quectel/QCMAP daemons use (`/dev/smd*`, `/dev/smdcntl*`, `rmnet_ctrl`,
  `/dev/at_mdm0`). Far richer than AT: signal/neighbor-cell/serving-cell,
  data-session stats, NAS/registration events as a stream rather than polled
  text. Note: `qmicli`/`uqmi`/`libqmi` are **not** installed — we'd use the
  Quectel CLIs (`ql_*`, `QCMAP_*`) or ship our own QMI client.
- **DIAG / QXDM** (`/dev/diag`, `diag-router.service`, `diag_mdlog`,
  `diag_mdlog`, `diag_socket_log`) — the deep RF/protocol log plane. Can dump
  full modem diagnostics, stream to FTP, enable QDSS traces. This is where
  "valuable data" like per-layer RF metrics, scheduling, and HARQ live.
- **Thermal** (`/sys/class/thermal/*`) — **dozens** of live sensors: per-PA
  temps (`modem-lte-sub6-pa1`), SDR, `cpuss`, `mdmss-[0-3]`, PMIC
  (`pmx65_tz`), skin/ambient. Currently ~29–36 °C. OpenModem only surfaces one
  (`device_temp_c`); the rest are free.
- **GNSS** (`/dev/gps`, `/etc/gps.conf`) — assisted GPS configured (SUPL,
  XTRA, NMEA). Location/NMEA data is available via the loc daemon or
  `AT+QGPS*`. Not currently used by OpenModem.
- **Per-PDN traffic counters** (`/sys/class/net/rmnet_data*/statistics`) —
  live byte counters per data context. At survey: `rmnet_data0` (primary WAN)
  247 MB↓ / 609 MB↑; `rmnet_data1` (second context) 79/88 MB. Cheaper/more
  accurate than the AT-derived throughput estimate OpenModem computes now.
- **IPA / netmgr stats** (`/dev/ipa_lnx_stats_ioctl`, `ipacm_log.txt`) —
  hardware-accelerated datapath counters.
- **Carrier/WAN identity** — `rmnet_data0` holds the real assigned WAN IPs
  (`10.184.66.247/28` CGNAT v4 + a routable `2600:380:…` v6), gateway, and
  per-interface MTU (1430) — direct, no AT parsing.

---

## 4. Controls available

### Qualcomm Mobile-AP — `QCMAP_CLI` / `ql_qmap`

The big one. `QCMAP_CLI` exposes a full gateway/router control surface
(interactive menu; `ql_qmap` is Quectel's scriptable wrapper):

1. MobileAP config · 2. LAN config · 3. **NAT / ALG / VPN** · 4. WLAN ·
5. **Firewall** · 6. **Backhaul** · 7. **Tethering** · 8. Media service ·
9. Software bridge · 10. V2X · 11. Modem throughput estimation · 12. WiFi params

That means programmatic control of **port forwarding, DMZ, NAT, firewall
rules, DHCP, data-call bring-up/teardown, backhaul selection** — much of
which QuecControl-style UIs expose and OpenModem currently doesn't.

### Other control planes

- **AT** (`/dev/smd11` via the OpenModem broker) — band lock, carrier scan,
  TTL, generic passthrough (already wired in OpenModem).
- **Netfilter** — `iptables` / `ip6tables` (legacy) present; OpenModem already
  uses this for TTL. `conntrack`/`conntrackd` present. `tc` present (QoS/shaping).
- **DIAG logging control** — `diag_mdlog` to start/stop/route deep logs.
- **Thermal** — `thermal-engine` (config-driven PA/throttle behaviour).
- **Power/reset** — `systemctl` (`/sbin/reboot → systemctl`), autosleep units.
- **Remote access** — **Tailscale is installed** (`/usrdata/tailscale/`,
  v1.62.1, state present) but **logged out**. Re-authing it would give
  zero-config remote shell/SSH/management **without any LAN port-forward** —
  a strong alternative to telnet for ongoing access. `adbd` is up but bound to
  localhost (USB only).

---

## 5. Network topology (as found)

```
dev2 (this host, 10.10.10.15)
  └─(tailscale)→ rigatony (100.64.0.1, Proxmox "tailscale", advertises 192.168.225/226.0 routes)
       └─(LAN 10.0.0.0/24)→ omp-remote1 (10.0.0.1, Debian MPTCP router)
            ├─ enp2s0 192.168.225.3/22 ──(RGMII/eth)── Modem 1  bridge0 192.168.225.1
            └─ enp3s0 192.168.226.100/22 ─(RGMII/eth)── Modem 2  (…226.1)
```

- Modems attach to the router over **ethernet/RGMII** (Intel `igc` NICs), not
  USB — so there is **no `adb` path to the modem from the router**; the only
  control surface reachable off-box is the OpenModem web UI on `:8080`.
- Modem WAN is live on `rmnet_data0` (CGNAT v4 + routable v6), LAN is
  `bridge0` serving `192.168.224.0/22` via dnsmasq.

---

## 6. Implications for the next phase

**Feasible and high-value (data):** surface the sensors/counters already on
the box — full thermal array, per-PDN byte counters, DIAG-sourced RF metrics,
GNSS/location — most of which need no new binary, just more polling in the
existing shell poller.

**Feasible, bigger lift (control):** wrap `QCMAP_CLI`/`ql_qmap` for port
forwarding, firewall, NAT, DMZ, tethering, data-call control via new CGI
actions (same allowlist-and-validate pattern as the existing action scripts).

**"Our own application":** possible but a real scope change. No interpreters
beyond shell/awk, read-only rootfs, ~64 MB flash + ~50 MB RAM headroom, single
ARMv7 core. The realistic shape is a **small static native (Go/C) daemon in
`/usrdata` under systemd**, cross-compiled off-device — Tailscale proves the
Go-on-ARM path works. This directly contradicts CLAUDE.md's current "no
additional software on the modem" principle, so it's a `SCOPE.md`-level
decision, not an incremental feature.

**Access for ongoing dev:** prefer re-enabling the **already-installed
Tailscale** over telnet — it gives authenticated remote shell with no LAN
exposure. Telnet (this branch) is fine as a throwaway but should not persist.

---

## Cleanup

Left running after this survey (to undo when done):

1. **Modem 1 telnet** — `openmodem-telnet.service` is active on `:23`
   (passwordless root). Disable with `ENABLE_TELNET=0` in
   `config/openmodem.conf` + redeploy, or stop/mask the unit.
2. **`main` branch** carries the telnet commit (`8ce6924`). Decide whether to
   keep it or revert; it must **not** ship enabled to end users (passwordless
   root bypassing the web UI auth).
3. Web UI still on default `admin/admin` (`web_auth_is_default: true`).

---

# Deep Dive: non-AT data, refresh speed, and Go (measured on modem 1)

Follow-up investigation answering three questions, benchmarked live on-device.

## A. Data available that AT is *not* tapping

The AT interface (`/dev/smd11`) is the slowest and narrowest of several
planes. What's reachable without AT at all:

| Plane | How | What it gives (that AT doesn't, or gives slower) |
|---|---|---|
| **QMI over QRTR** | kernel `AF_QIPCRTR` socket family (**confirmed**: `QIPCRTR` in `/proc/net/protocols`; `qrtr-lookup` enumerates services) | The native modem control bus. Services live on the bus right now: NAS/DMS/WDS-class modem services (node 2), **DIAG** (per subsystem), **Thermal sensors service (23)**, **Thermal mitigation (24)**, **Modem EFS (21)**, **IPA control (49)**, CoreSight. Gives signal/serving-cell/neighbor/registration/data-session as **push indications** — no polling. |
| **sysfs** | plain file reads | **Full thermal array** (dozens of sensors: per-PA, SDR, `cpuss`, `mdmss-0..3`, PMIC `pmx65` — OpenModem surfaces 1), **per-PDN byte/packet counters** (`/sys/class/net/rmnet_data*/statistics`), cpufreq, link states. |
| **DIAG / QXDM** | `/dev/diag` + `diag-router` (QRTR svc 4097) | Deep PHY/L2 RF telemetry — per-RB metrics, HARQ, RLC/MAC, scheduler — the stuff QXDM shows. Streamable to file/FTP via `diag_mdlog`. |
| **GNSS** | `/dev/gps`, `location` daemon socket (`/dev/socket/location`) | Position + NMEA. **Currently OFF** (`AT+QGPS?` → `+QGPS: 0`); enable to use. |
| **Netlink** | `AF_NETLINK` (present) | Interface/address/route **change events** (push) — WAN up/down, IP changes, instantly. |
| **Qualcomm daemon sockets** | `/dev/socket/{location,data,thermal-*,atfwd}` | IPC endpoints the stock daemons use (proprietary framing; QMI is the cleaner path). |

## B. Can data refresh faster than AT? — Yes, by 1–2 orders of magnitude

Measured on-device (single ARMv7 core, so shell `cat` carries ~3 ms
fork/exec overhead that native code avoids entirely):

| Method | Measured latency | Notes |
|---|---|---|
| **AT command** (via broker) | **250–370 ms each**; 270 ms each sustained (5× CSQ) | `AT+CSQ` 250 ms, `AT+QTEMP` 260 ms, `AT+QCAINFO` 370 ms. Serial through one device + broker's fixed 100 ms read windows. Full poll cycle ≈ 1–3 s. |
| **sysfs counter** (shell `cat`) | **3.0 ms each** (500 reads = 1520 ms) | Dominated by `cat` fork/exec; the read itself is µs. |
| **sysfs thermal** (shell `cat`) | **7.8 ms each** (500 = 3880 ms) | ~5 ms is the hardware sensor sample; rest is `cat`. |
| **sysfs in native code** | **tens of µs** (counters), ~5 ms (thermal sensor) | No fork. Effectively free for counters/link state. |
| **QMI indication** | **0 ms polling** — pushed on change | Signal/cell/registration/data-stats arrive as events. |

**Bottom line:** fast-changing fields (signal, throughput, temps) could update
at **1–10 Hz** cheaply via sysfs/QMI instead of the current **5 s** AT poll,
and registration/cell/WAN-state changes could be **event-driven (instant)**
instead of polled. AT stays only for what's AT-only (band lock, carrier scan,
config writes).

## C. What you could do with Go

**Confirmed runnable:** the device already executes a **Go 1.22.1** static ARM
binary (Tailscale). Target = `GOOS=linux GOARCH=arm GOARM=7`,
`CGO_ENABLED=0` → one static file, no libc dependency (glibc 2.31 / armhf is
present if cgo is ever needed). Drop it in `/usrdata`, run under a systemd unit
— exactly OpenModem's existing deploy shape.

What that unlocks:

1. **One daemon replacing broker + poller + httpd + CGI.** A single Go process
   can own `/dev/smd11` (AT, only where needed), read sysfs directly, speak
   **QMI over `AF_QIPCRTR` in pure Go** (raw syscalls, no cgo), and serve the
   UI — removing the FIFO/concurrency dance entirely.
2. **Event-driven + sub-second telemetry.** QMI indications for
   signal/cell/registration; sysfs at 1–10 Hz for throughput/thermal; Netlink
   for WAN state. No more phase-locked 5 s polling.
3. **WebSocket push to the browser** instead of the 1 s `state.sh` fetch loop —
   the UI updates the instant data changes, at lower overhead.
4. **Richer data in the UI** at no AT cost: full thermal array, per-PDN
   counters, QMI serving-cell/neighbor detail, GNSS position (once enabled).
5. **Native control** via QMI (QCMAP-class: NAT, port-forward, firewall, DHCP,
   data-call) without shelling out to `QCMAP_CLI`.

**Constraints to design around:** single ARMv7 core, **~53 MB available RAM**
(BusyBox httpd uses 580 KB; keep a Go daemon lean — target < 15 MB RSS), and
~64 MB free on `/usrdata` for a ~10–20 MB binary. This is a deliberate break
from CLAUDE.md's "no additional software on the modem" principle — a
`SCOPE.md`-level decision, not an incremental change.

---

# Appendix: Data Dictionary (live values, modem 1, 2026-11-13 21:5x)

Enumeration of the Section-3 data with real readings. **Query speed** is the
*fastest non-AT* path; radio values below were read today via the AT broker for
the example, but the same fields are on **QMI (push)**. Reference AT latency is
**250–370 ms/command**; sysfs is **~3 ms (counter) / ~7 ms (thermal) via shell,
µs–low-ms in native code**; QMI/Netlink are **push (event-driven)**.

### Thermal — `/sys/class/thermal/thermal_zone*/temp` (unit: °C; raw = milli°C)

| Source (zone) | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| `thermal_zone/modem-lte-sub6-pa1` | LTE Sub-6 PA1 temp | 30.0 | °C | ~7 ms / µs native |
| `…/modem-lte-sub6-pa2` | LTE Sub-6 PA2 temp | 30.0 | °C | ~7 ms |
| `…/modem-lte-sub6` | LTE Sub-6 transceiver | 29.0 | °C | ~7 ms |
| `…/modem-sdr0` | SDR0 (radio) temp | 29.0 | °C | ~7 ms |
| `…/cpuss-0-usr` | CPU subsystem temp | 34.5 | °C | ~7 ms |
| `…/mdmss-0-usr` … `mdmss-3-usr` | Modem subsystem temps (×4) | 32.8–35.1 | °C | ~7 ms |
| `…/mdmq6-0-usr` | Modem Q6 DSP temp | 34.1 | °C | ~7 ms |
| `…/aoss-0-usr` | Always-on subsystem temp | 33.8 | °C | ~7 ms |
| `…/pmx65_tz` | PMIC (PMX65) temp | 30.6 | °C | ~7 ms |
| `…/modem-skin-usr` | Skin temp | 31.5 | °C | ~7 ms |
| `…/modem-ambient-usr` | Ambient temp | 31.2 | °C | ~7 ms |

*~40 zones total; the rest (mmW, SDR1, beamer) read −273 °C / empty = inactive on this LTE-only unit. OpenModem currently surfaces one (`device_temp_c`).*

### Thermal mitigation state — `/sys/class/thermal/cooling_device*` (unit: step)

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| `cooling_device/thermal-cpufreq-0` | CPU-freq throttle level | 0 (max 3) | step | ~3 ms |
| `cooling_device/modem_lte_dsc` | LTE Tx power backoff | 0 (max 255) | step | ~3 ms |
| `cooling_device/pa_lte_sdr{0,1}_dsc` | PA discrete backoff | 0 (max 255) | step | ~3 ms |

*18 cooling devices; current throttle level per actuator (0 = no mitigation now).*

### CPU / system — `/proc`, `/sys/.../cpufreq`

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| `cpufreq/scaling_cur_freq` | CPU current freq | 1,804,800 | kHz | ~3 ms |
| `cpufreq/scaling_available_frequencies` | CPU freq steps | 345.6/576/1094.4/1804.8 | MHz | ~3 ms |
| `cpufreq/scaling_governor` | CPU governor | ondemand | — | ~3 ms |
| `/proc/loadavg` | Load 1/5/15 min | 1.91 / 1.94 / 1.81 | — | ~3 ms |
| `/proc/meminfo:MemAvailable` | RAM available | 53,368 | kB | ~3 ms |
| `/proc/meminfo:MemFree` | RAM free | 18,312 | kB | ~3 ms |
| `/proc/meminfo:SwapFree` | zram swap free | 76,656 | kB | ~3 ms |
| `/proc/uptime` | Uptime | 3,564,614 | s | ~3 ms |
| `/proc/stat:cpu` | CPU jiffies (→ %util) | user 42.6M / sys 97.4M / idle 211M | jiffies | ~3 ms |
| `/proc/stat:ctxt` | Context switches | 4,504,272,764 | count (→ rate) | ~3 ms |

### Data-plane counters — `/sys/class/net/<if>/statistics` (unit: bytes / packets)

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| `rmnet_data0` (WAN PDN#1) | rx_bytes / tx_bytes | 246,755,661 / 609,579,514 | bytes | ~3 ms (→ throughput on delta) |
| `rmnet_data0` | rx_packets / tx_packets | 1,573,580 / 2,238,000 | packets | ~3 ms |
| `rmnet_data0` | carrier / mtu | 1 / 1430 | bool / bytes | ~3 ms |
| `rmnet_data1` (WAN PDN#2) | rx_bytes / tx_bytes | 79,482,255 / 88,135,590 | bytes | ~3 ms |
| `bridge0` (LAN) | rx_bytes / tx_bytes | 402,726,706 / 84,439,230 | bytes | ~3 ms |
| `eth0` (RGMII host link) | rx_bytes / tx_bytes | 421,683,716 / 84,481,422 | bytes | ~3 ms |

### WAN session — Netlink / `ip` / QMI-WDS

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| Netlink / `rmnet_data0` | WAN IPv4 | 10.184.66.247/28 | IPv4 | push / ~1 ms |
| Netlink / `rmnet_data0` | WAN IPv6 (GUA) | 2600:380:8772:d9a1:4d22:ab01:79a0:2e60/64 | IPv6 | push |
| Netlink (route) | Default gateway | 10.184.66.248 | IPv4 | push |
| `rmnet_data0` | Link MTU | 1430 | bytes | push |

### Radio — signal — QMI-NAS (push) · ref. `AT+QCSQ`/`AT+CSQ`

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| QMI-NAS | RAT / sysmode | LTE | — | push / <5 ms |
| QMI-NAS | RSSI | −63 | dBm | push |
| QMI-NAS | RSRP | −91 | dBm | push |
| QMI-NAS | RSRQ | −11 | dB | push |
| QMI-NAS | SINR | 6–11 | dB | push |

### Radio — serving cell — QMI-NAS (push) · ref. `AT+QENG="servingcell"`

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| QMI-NAS | Registration state | NOCONN (idle) | enum | push |
| QMI-NAS | MCC / MNC | 310 / 410 | — | push |
| QMI-NAS | Cell ID (ECI) | 0x1DAACCA | hex | push |
| QMI-NAS | PCI | 15 | — | push |
| QMI-NAS | EARFCN | 66986 | — | push |
| QMI-NAS | Band | B66 | — | push |
| QMI-NAS | TAC | 0x9F05 | hex | push |

### Radio — carrier aggregation — QMI-NAS · ref. `AT+QCAINFO`

Confirmed live (`0x00AC` + `0x43`, validated vs `AT+QCAINFO`; see "Validated
live via QMI" below). Band/freq derived from EARFCN offline:

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| QMI-NAS | Aggregated carriers | 3 (1 PCC + 2 SCC) | count | poll (0x00AC) |
| QMI-NAS | PCC | B2 / EARFCN 800 / 20 MHz / PCI 186 | band/earfcn/BW/PCI | poll |
| QMI-NAS | SCC #1 | B66 / EARFCN 66986 / 10 MHz / PCI 15 / activated | …+state | poll |
| QMI-NAS | SCC #2 | B66 / EARFCN 66661 / 5 MHz / PCI 92 / deactivated | …+state | poll |
| QMI-NAS | Per-CC RSRP/RSRQ/RSSI | −85.7 / −9.5 / −56.6 (PCC) | dBm/dB | poll (0x43) |

### Network identity / registration — QMI-NAS · ref. `AT+QNWINFO`/`QSPN`/`COPS`/`CEREG`

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| QMI-NAS | Operator | AT&T | string | push |
| QMI-NAS | PLMN | 310410 | — | push |
| QMI-NAS | Access tech | FDD LTE | — | push |
| QMI-NAS | EPS reg status | 1 (registered, home) | enum | push |

### SIM / device identity — QMI-DMS/UIM · ref. `AT+QCCID`/`CNUM`/state

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| QMI-UIM | ICCID | 89014104334607986547 | digits | <5 ms (static) |
| QMI-DMS | MSISDN (own #) | +14089733995 | E.164 | <5 ms |
| QMI-UIM | IMSI | 310410460829595 | digits | <5 ms |
| QMI-DMS | IMEI | 351507700611105 | digits | <5 ms |
| QMI-DMS | Model / firmware | RM520N-GL / …AAR03A04M4G | string | <5 ms |

### Time — QMI-NAS network time · ref. `AT+CCLK?`

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| QMI-NAS | Network time | 2026-11-13 21:53:50 | datetime | push on update |
| QMI-NAS | TZ offset | −32 (−8h) | ¼-hours | push |

### GNSS — location daemon `/dev/socket/location` · `/dev/gps` (NMEA) — **currently OFF**

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| loc daemon | Fix (lat, lon) | — (engine off: `+QGPS: 0`) | ° | 1 Hz stream when on |
| loc daemon | Altitude | — | m | 1 Hz |
| loc daemon | Speed / course | — | m/s · ° | 1 Hz |
| loc daemon | HDOP / #sats | — | — / count | 1 Hz |

*Enable with `AT+QGPS=1` (or via loc daemon); then NMEA streams from `/dev/gps`.*

### Deep RF (PHY/L2) — DIAG `/dev/diag` (QRTR svc 4097) — streaming

| Source | Name | Example | Unit | Query speed |
|---|---|---|---|---|
| DIAG | Per-RB / wideband SINR, CQI | (decode-only) | dB / index | stream |
| DIAG | HARQ ACK/NACK, BLER | — | % | stream |
| DIAG | RLC/MAC throughput, grants | — | bps / RB | stream |
| DIAG | Timing advance, PRACH | — | — | stream |
| DIAG | NR SSB/beam, RSRP (when NR active) | — | dBm | stream |

*Requires a DIAG log decoder (QXDM-style); richest data on the box, highest effort.*

---

# Deep RF: QCI, per-carrier modulation, and congestion (what's gettable without AT)

Investigation into the metrics needed for accurate throughput estimation —
per-carrier bandwidth/modulation, QCI, and congestion — and where each one
actually lives on this device.

## Where each metric lives

| Metric | Reachable? | Best non-AT source | Effort |
|---|---|---|---|
| Per-CC band / EARFCN / **DL bandwidth (RB)** / PCI | ✅ | **QMI-NAS** "LTE CPHY CA Info" indication (push) — the same data `AT+QCAINFO` wraps | Low |
| Per-CC RSRP / RSRQ / SINR | ✅ | QMI-NAS | Low |
| MIMO **layers / rank** per CC | ◑ | **DIAG** (authoritative); partial via QMI | Med |
| **Modulation** (QPSK/16/64/256-QAM) per CC | ⚠️ DIAG-only | **DIAG** LTE LL1 PDSCH decode log | High |
| **MCS** index per CC | ⚠️ DIAG-only | DIAG | High |
| **TBS / actual bits per TTI** per CC | ⚠️ DIAG-only | DIAG LTE ML1/LL1 — gives **real** PHY throughput, not an estimate | High |
| **BLER / HARQ** retransmit rate | ⚠️ DIAG-only | DIAG | High |
| CQI | ◑ | DIAG (some via QMI) | Med |
| **QCI** (bearer QoS class) | ◑ | **QMI-WDS**, but *stateful* — needs WDS Bind Mux Data Port first (see validated note below); default bearer is QCI 9 with no dedicated QoS to read here | Med |
| **Measured** datapath throughput | ✅ | **IPA debugfs** `hw_stats`/GSI pipe counters, or rmnet byte counters | Very low |
| Cell **congestion / PRB utilization** | ✗ direct | *Not exposed to a UE by 3GPP* — must be **inferred** (see below) | Med–High |

Legend: ✅ straightforward · ◑ partial · ⚠️ only via DIAG · ✗ not directly available.

## Key findings

- **Per-carrier bandwidth, band, PCI, and per-CC signal are QMI, not just AT.**
  The CA table (`AT+QCAINFO` today: PCC B66/50RB, SCC B2/100RB, SCC B66/25RB)
  originates from a **QMI-NAS "LTE CPHY CA Info"** message delivered as a push
  indication. A QMI client gets it event-driven with no polling. RB count → BW
  (50RB=10 MHz, 100RB=20 MHz, 25RB=5 MHz), which is most of a throughput
  estimate already.

- **Modulation / MCS / TBS / BLER are DIAG-only on this box.** The stock
  userland does **not** expose them — confirmed: `quectel_daemon` (the QMI
  aggregator) has no modulation/MCS/rank strings; they exist solely in the
  **DIAG log stream**. This is the "deep RF" you suspected. DIAG is live here:
  `diag-router.service` active, `/dev/diag` used by `diag_mdlog` (qmdl2_v2
  format), and a 4 KB HDLC log-mask config at `/data/diag.cfg`.

- **The accuracy win:** DIAG's **LTE LL1 PDSCH decode** records report, per CC
  per TTI, the **modulation order, code rate, #layers, #RBs, and the resulting
  TBS**. That means you don't have to *estimate* throughput at all — you can read
  the **actual transport-block bits/TTI** and sum across carriers for true
  instantaneous PHY throughput. Modulation + MCS is exactly what turns the
  current estimate into a measurement.

- **QCI via QMI-WDS is stateful, not a simple get** (validated — see below).
  `rmnet_data0` carries **33 TX queues** (per-QoS/bearer) and each data context
  (`rmnet_data0`/`rmnet_data1`) is a separate PDN, but the live bearer QoS is
  gated behind a mux bind.

- **Measured throughput is a very cheap quick win.** IPA debugfs
  (`/sys/kernel/debug/ipa/hw_stats`, per-GSI-pipe counters) and the rmnet byte
  counters are **hardware datapath counters** — sampling them gives real
  delivered throughput (ground truth to compare any estimate against), at
  sysfs speed.

## Validated live via QMI — `experiments/gocollector` (2026-11-14)

Built a pure-Go QMI-over-QRTR client (no libqmi, no AT) and confirmed the
per-carrier CA plane end-to-end against `AT+QCAINFO`/`AT+QENG` ground truth.
Serving live on `:8091` (`/data` JSON). What's now decoded, and from where:

- **`NAS Get LTE CPHY CA Info` — message `0x00AC`** (authoritative CA structure):
  - **PCell** TLV `0x13`: `{pci u16, earfcn u16, dl_bw u32 enum}`.
  - **SCell** TLV `0x19`: u8 count + 18-byte entries
    `{pci u16, earfcn u32, dl_bw u32 enum, …, state u8}` (state 0=deactivated,
    1=activated). **This is where per-SCC DL bandwidth and activation state
    live** — the gap the earlier draft left open.
  - DL-bandwidth enum `{0:1.4, 1:3, 2:5, 3:10, 4:15, 5:20}` MHz.
- **`NAS Get Cell Location Info` — message `0x43`** (per-cell signal + ids):
  intra-freq TLV `0x13` (19-byte header: TAC@4, cell id@6; then 10-byte cells)
  and inter-freq TLV `0x14` (per-freq `{earfcn u16, 3 bytes, cells_len, cells}`).
  Cell struct: `{pci u16, rsrq, rsrp, rssi, srxlev}` as signed int16 in 0.1 units.
  Each carrier's RSRP/RSRQ/RSSI is attached by **matching the authoritative
  SCell PCI** from `0x00AC` to a cell here (resolves which measured cell is the
  configured SCell).
- **Band + DL centre frequency are derived offline** from the EARFCN (3GPP
  TS 36.101, `qmi/earfcn.go`) — no device round-trip. E.g. 800→B2/1950 MHz,
  66986→B66/2165 MHz.
- Confirmed sample (all matching AT): PCC 800 B2 **20 MHz** PCI 186; SCC 66661
  B66 **5 MHz** PCI 92 deactivated; SCC 66986 B66 **10 MHz** PCI 15 activated;
  TAC `0x9f05`, cell `0x01daacb4`. Decode is unit-tested against the captured
  bytes (`qmi/ca_test.go`).

**Message-ID correction:** on this firmware `NAS 0x004D` is *Get System Info*
(registration/PLMN/TAC), **not** CA info. An earlier probe of `0x4D` looked
CA-shaped but was system data; CA info is `0x00AC`.

**QCI reality check:** live `WDS Get Current Settings` (`0x2D`) returns QMI error
**15 (`OUT_OF_CALL`)** — the WDS client must first issue **WDS Bind Mux Data
Port** against the active `rmnet_data0` session (stateful) before any bearer QoS
is returned. And `AT+CGEQOSRDP` is empty here: there is **no dedicated QoS
bearer**, only the default EPS bearer, which is conventionally **QCI 9** with no
per-flow QoS to report. The WDS *profile* (`0x2B`) decodes cleanly (APN
`broadband`) but that's static config, not the live bearer. So QCI is reachable
in principle but low-value on this connection until a dedicated bearer exists.

## Congestion — the honest limit

A UE **cannot read cell PRB utilization** (how loaded the tower is) — 3GPP
doesn't report eNB-side load to handsets. "Congestion" must be **inferred** from
UE-visible signals, all of which are in DIAG:

- **BLER up + MCS capped below what SINR supports** → network withholding grants.
- **Grant/scheduling rate** — fraction of TTIs you're scheduled while your buffer
  is non-empty; low grant rate with a full buffer = contention.
- **Allocated PRBs vs. your demand** — consistently small grants despite backlog.
- **Rank/MCS drop without a matching SINR drop.**
- Datapath side: sustained **rmnet TX-queue backlog** (BQL/`tx_queue_len`) with
  delivered rate below PHY capacity → downstream-limited.

A composite "congestion index" from these is feasible, but it's a derived metric
built on DIAG, not a register you can read.

## Recommended path (staged)

1. **Tier 1 — no DIAG (low effort, big improvement):** a QMI client (pure-Go
   over `AF_QIPCRTR`) for **NAS CA info** (per-CC band/BW/SINR, push) + **WDS**
   (QCI), plus **IPA/rmnet counters** for measured throughput. Replaces the
   current estimate's inputs with better ones and adds a measured-throughput
   ground truth. Still lacks modulation.
2. **Tier 2 — DIAG (high effort, full accuracy):** a DIAG client that sets a log
   mask for the LTE PHY codes and parses **PDSCH decode** records →
   modulation/MCS/rank/**TBS** per CC (exact throughput) + **BLER** and grant
   stats (congestion proxies). The packet formats for these exact Qualcomm log
   codes are already decoded by open tools (**SCAT, QCSuper, MobileInsight**) on
   the same SDX/MDM family — so it's a port/reuse effort, not greenfield reverse
   engineering. Suggested de-risking step: capture a short `.qmdl` with
   `diag_mdlog`, decode it offline to confirm the exact codes/fields this
   firmware emits, then build the live Go parser for just those.

## DIAG capture on this firmware — the access reality (tested)

Tried to capture a `.qmdl`; the simple path does **not** work on this unit, and
the reason matters for Tier 2:

- **No local diag char device.** `/dev/diag` is absent, there is **no `diag`
  character major** in `/proc/devices` (only `mhi_uci`), and no
  `/sys/module/diagchar`. `diag_mdlog` runs but attaches to nothing and writes
  an empty output dir.
- **`diag-router` owns the stream.** It holds the modem's **DIAG QRTR services
  (svc 4097: MODEM/LPASS/WCNSS/SENSORS/CDSP… each CNTL/DATA/DCI)** and bridges
  them to the **USB functionfs gadget** (`/dev/ffs-diag/ep0-2`). There is **no
  DIAG TCP listener** — DIAG is not exposed over the network.
- So on this RGMII build DIAG is **QRTR-sourced, USB-sinked**. Because the modem
  attaches to the host over **RGMII ethernet, not USB**, the USB/QXDM capture
  path isn't wired to anything reachable in this setup.

**Capture paths that actually work here:**

1. **USB QXDM/QCAT host** physically attached to the modem's DIAG USB interface
   — not available in the RGMII/ethernet topology.
2. **Native on-device QRTR-DIAG client** that subscribes to QMI/QRTR **svc 4097**
   directly (the approach QCSuper's "qrtr" backend uses for exactly these SDX
   parts), sets the log mask, and parses the packets. It must run **on the
   modem** (QRTR is an on-SoC bus) and be **native** (no Python on-device) — i.e.
   this *is* the Tier-2 Go/C program. Caveat: `diag-router` is already a
   subscriber, so a second DATA-stream consumer may need to coordinate with or
   replace it.

**Net:** there is no shortcut `.qmdl` capture on this unit. The
modulation/MCS/TBS/BLER data requires building the QRTR-DIAG client (Tier 2) or
a USB QXDM rig — the quick `diag_mdlog` capture is a dead end on this firmware.

## DIAG Tier-2, step 2 — why the on-device QRTR path is a dead end (researched)

Built a raw DIAG-over-QRTR tap (`experiments/gocollector/cmd/diagtap`) and
researched the DCI/QRTR path against references (QCSuper, wwand-qlog/QLog,
qcom-band-menu/libdiag). Conclusion: **there is no userspace path to read DIAG
over raw QRTR on this device**, and building one is impractical.

On-device tap findings:
- DIAG endpoints exist on QRTR node 2 (CNTL 16405 / DATA 16407 / DCI 16408),
  but direct command injection (raw + HDLC, Version/Build-ID) gets **no reply**.
- No `/dev/diag` (diagchar driver absent — no char major, no module), and
  `diag-router` exposes **no local client socket** — only the USB gadget
  (`/dev/ffs-diag`). `libdiag`/`diag_mdlog` target `/dev/diag`, so they're inert.

What the references establish:
- Every established DIAG consumer uses **`/dev/diag` via libdiag** (DCI client
  registration is a `/dev/diag` ioctl flow) **or a host-side USB/MHI DM port**
  (`/dev/mhi_DIAG`, `/dev/ttyUSB*`, `/dev/sdiag*`). Quectel's own QLog uses the
  latter.
- On SDX/MDM designs, **QRTR carries only QMI**; user-facing DIAG goes through
  the kernel diagchar driver as a remote processor. The QRTR "DIAG service"
  channels are the diag-core peripheral transport, not a user interface — hence
  the silence to direct probes.

Implication: on the AP, DIAG would require reimplementing the diagchar
peripheral protocol over QRTR from scratch (no reference, contends with
diag-router) — not viable. The realistic DIAG path is **host-side over
USB/MHI**, which this RGMII/ethernet topology does not provide (the modem's USB
DM port is not connected to a reachable host). Getting modulation/MCS/TBS/BLER
therefore needs a topology change (USB DM port to a host, or PCIe/MHI in an x86
slot → host `/dev/mhi_DIAG`), not more on-device software.

**Net:** QMI (signal, CA, serving cell — all working) is the ceiling for
non-AT data in the current physical setup; DIAG-only metrics (modulation, MCS,
TBS, BLER) are out of reach without rewiring how the modem attaches to a host.
