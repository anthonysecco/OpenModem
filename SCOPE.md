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

## Open questions

- Exact set of state fields polled per page (which AT queries feed
  Dashboard/Cellular/SIM/WAN/LAN specifically).
- Exact button-level actions under WAN and LAN (which of QuecControl's
  `wan_action.sh`/`lan_action.sh` actions carry over as-is vs. get
  simplified).
