# Architecture decisions & key findings

Conclusions from the RM520N-GL exploration, recorded so the reasoning survives.
Short version: **the existing AT + BusyBox-shell design is the right one for this
project; the QMI/Go work is validated R&D, not a production direction.**

## Decision 1 — Interface: AT (production) vs QMI-over-QRTR (R&D only)

**Decision: keep AT, through the existing `at_broker.sh` / `at_poller.sh` / shell
CGI, as the production interface. Do not build the product on QMI.**

QMI-over-QRTR was proven to work in pure Go on-device (signal, carrier aggregation,
serving system, per-SCC bandwidth/PCI/state all decoded and matched AT ground truth).
It is genuinely faster and structured. It is still the wrong foundation here:

- **Supportability dominates, and it favors AT.** AT is a documented, vendor-committed,
  firmware-stable interface, hand-debuggable over a shell. QMI message IDs and TLV
  layouts are undocumented and reverse-engineered — we already hit `0x4D` being
  Get-System-Info, not CA-Info, and most catalog rows are "verify on-device." A
  firmware update can silently shift a TLV with no error.
- **Performance isn't the constraint.** The UI refreshes every few seconds; the AT
  broker chains ~30 commands into one ~0.3–0.5 s round-trip. QMI's sub-second edge
  only matters for high-rate telemetry — and the richest high-rate data (modulation /
  MCS / TBS) is DIAG-only and blocked anyway (Finding C).
- **QMI can't cover everything.** MIMO layers, LAN clients, cell-lock and SA/NSA-disable
  are AT-only on this box (Finding D). An all-QMI app couldn't deliver them.
- **It respects the project charter.** `CLAUDE.md`: no additional software on the modem.
  QMI means shipping/cross-compiling/flashing a ~3 MB Go binary and breaks the
  `curl installer.sh | sh` text-file deploy model. AT needs no binary.

**This choice also settles "Go vs shell": QMI is the only thing that justified a Go
binary. Choosing AT means the product needs no Go daemon at all.**

**Flip condition:** a feature needing genuine high-rate telemetry (e.g. 1 Hz+ signal/CA
for a live chart) that would otherwise make the single AT broker contend with the UI's
action commands. Then add a *small, targeted* QMI sampler for the 2–3 validated messages
(`0x4F`, `0x43`, `0x00AC`) alongside AT — not a wholesale QMI layer.

## Decision 2 — Web serving: keep BusyBox httpd + shell CGI; no Go daemon

**Decision: keep `busybox httpd` serving static assets + shell CGI, with the poller
writing a pre-computed JSON file. Do not introduce a Go (or other) application server.**

The architecture already does the one thing that matters for performance: the expensive
work (AT round-trips) lives in the long-running `at_poller.sh` daemon, which atomically
writes `/tmp/openmodem/state_merged.json`; the hot-path CGI (`state.sh`) just `cat`s that
file — no AT call, no computation, one BusyBox `ash` fork per request. The
persistent-daemon pattern a rewrite would reach for *already exists* — it's the poller.

- **Supportability:** httpd is already on the device (zero added software); CGI is
  editable in place over a shell with no build step; a binary breaks the GitHub
  text-file deploy.
- **Performance is a non-issue:** a shell fork + `cat` at ~1 req/s for 1–2 clients on a
  UI that refreshes every second. The only true serialization point is the AT broker
  (one physical AT device) — inherent to the hardware; a Go server wouldn't change it,
  and the hot read path doesn't touch it.

**Flip condition:** a real need for server-push (SSE/WebSocket) — high-rate live
telemetry or many simultaneous clients — which request/response CGI can't hold cleanly.
Then add *one* small long-running SSE endpoint, not a stack replacement.

## Finding A — Throttling is graduated, exposed via sysfs (not AT, not QMI)

Throttling is **per-component and graduated**, via ~18 kernel "cooling devices"
(`/sys/class/thermal/cooling_device*`), each throttled to a level between 0 and its
`max_state`. Three level-scales:

| Scale | Device(s) | Range | Meaning |
|---|---|---|---|
| CPU frequency | `thermal-cpufreq-0` | 0–3 | 0 = full 1.8 GHz; 1/2/3 step to 1.09 / 0.58 / 0.35 GHz |
| Modem voltage | `modem_vdd` | 0–1 | binary core-voltage backoff |
| RF / PA | 14× `*_dsc` (e.g. `modem_lte_dsc`, `pa_lte_sdr0_dsc`) | 0–255 | fine-grained TX / throughput backoff per radio path |

The authoritative CPU-throttle signal is the `thermal-cpufreq-0` cooling level, **not**
a `scaling_max_freq < cpuinfo_max_freq` compare — that device clamps frequency without
always lowering `scaling_max_freq`, so the compare can miss real thermal throttling.
Modem RF trip points don't engage until ~125 °C junction. OpenModem's single `AT+QTEMP`
read surfaces none of this; it's a clean net-new capability if ever wanted.

## Finding B — Carrier identity / registration is fully non-AT

`NAS Get Serving System (0x24)` returns registration state, RAT, roaming indicator, PLMN
and operator-name string in one message — i.e. everything `AT+COPS?` / `AT+QSPN` /
`AT+CEREG?` give. Validated live.

## Finding C — DIAG (modulation / MCS / TBS) is a dead end on this topology

No `/dev/diag`, and no userspace path to read DIAG over raw QRTR (all tooling uses
`/dev/diag`/libdiag or a host-side USB/MHI DM port). Getting modulation/MCS/TBS/BLER
would require a topology change (expose the USB DM port to a host, or PCIe/MHI), not more
software. See the "DIAG Tier-2" section of [device-capabilities.md](device-capabilities.md).

## Finding D — MIMO layers are AT-only

Per-CC MIMO layers come from `AT+QNWCFG="lte_mimo_info"` / `"nr5g_mimo_info"` — Quectel-
proprietary (not in Quectel's official AT manual), with no clean standard-QMI equivalent.
True per-TTI rank is DIAG-only (Finding C).

## Finding E — QMI is a real control plane, but writes are dangerous

QMI is bidirectional: network mode, band lock, roaming, airplane mode, APN and SIM-slot
switch all have Set/Action messages (e.g. `NAS Set System Selection Preference 0x33`,
`DMS Set Operating Mode 0x2E`). Many are persistent-by-default and some are destructive
(DMS factory reset, operating-mode shutdown, a band mask that strands the modem). Any
control action — via QMI or AT — should be gated behind read-back-and-confirm. Full map
in [qmi-at-capability-matrix.md](qmi-at-capability-matrix.md).
