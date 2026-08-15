# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenModem is a local web front end for the Quectel RM520N-GL modem. It runs
directly on the modem's onboard embedded Linux and is served by the modem's
own web server — there is no cloud backend and no build step. During
development, the modem is connected to this host over USB.

The design takes inspiration from
[QuecControl](https://github.com/anthonysecco/QuecControl), an existing
project for the same modem family, but OpenModem is a standalone
replacement, not a fork — it's deliberately narrower and simpler. Consult
QuecControl for prior art on the AT broker/poller pattern, CGI conventions,
and installer structure, but do not assume feature parity is a goal. See
`SCOPE.md` for the intended feature set and what's explicitly excluded —
check it before adding a feature or assuming scope that isn't documented
there.

Key differences from QuecControl, by design:

- **No additional software on the modem.** Backend stays on whatever
  BusyBox already provides (`ash`, `httpd`, coreutils applets) — no
  Go/Python/Node runtime, no cross-compiled binaries added to the device.
- **Narrower feature scope.** Many of QuecControl's features assume a
  working internet connection; OpenModem deliberately excludes most of
  those. Don't add a feature back "for parity" without checking `SCOPE.md`
  or asking.
- **Simpler polling.** A single poll interval, not tiered fast/medium/slow
  polling, and fewer state fields polled overall.

## Architecture

The runtime environment is constrained: BusyBox shell, no Node/Python/Go on
the modem itself. Everything that runs on-device is POSIX `sh` and static
web assets.

- **`bin/`** — long-running shell daemons installed as services on the
  modem:
  - `at_broker.sh` owns the AT command device (`/dev/smd11`, confirmed on
    real hardware — a raw character device, not a tty: `stty`/`read -t`
    don't work on it) and serializes access through a request/response
    FIFO so the poller and CGI scripts never write to it concurrently.
    Protocol: `echo "req_id|timeout_s|AT+COMMAND" > /tmp/at_request`,
    response appears at `/tmp/at_responses/<req_id>`. Reads use fixed
    ~100ms `cat <&3` windows with terminal-line detection (`OK`/`ERROR`/
    `+CME ERROR`/`+CMS ERROR`), the same technique QuecControl uses for
    the same hardware constraint — confirmed working against a real
    RM520N-GL. The FIFO itself is held open on a persistent read-write fd
    (`exec 4<>"$REQUEST_PIPE"`) rather than reopened per read — a
    per-iteration `read -r request < "$REQUEST_PIPE"` (what QuecControl
    does, and what this was ported from) loses concurrent writers that
    race the close/reopen window, confirmed by testing: 3 concurrent
    requests, only 2 ever reached the broker. Don't revert to the
    per-iteration form.
  - `at_command.sh` is the client: `at_command.sh "AT+CMD" [timeout]`
    writes a request and blocks for the response file. Everything else
    (poller, CGI scripts) should go through this rather than writing to
    the FIFO directly. Its response-file poll loop counts 100ms ticks —
    `wait_limit` must be `(timeout + 5) * 10`, not `timeout + 5`. Getting
    this wrong (an off-by-10x, inherited from the same bug in
    QuecControl's own `at_command.sh`) meant every call effectively
    waited a tenth of its requested timeout; found when a real
    `AT+COPS=?` carrier scan came back "timed out" after ~14s instead of
    the ~130s it was given. See `SCOPE.md` for the full story.
  - `at_poller.sh` runs one collection cycle every `POLL_INTERVAL`
    seconds (via `at_command.sh`, not the FIFO directly) and atomically
    writes merged state to `/tmp/openmodem/state_merged.json`
    (write-to-`.tmp`-then-`mv`) for the front end to poll. Every AT
    response line is `\r\n`-terminated — confirmed live — and `\r` is
    stripped centrally in its `run_at()` helper; don't reintroduce
    `$`-anchored parsing on unstripped output elsewhere (see `SCOPE.md`
    for how this broke several fields silently on the first pass, with
    `cut -f1`-based fields masking the bug by working anyway). Covers
    device/SIM/registration/signal/serving-cell/carrier/CA/band-pref/WAN
    fields; LAN client info is deliberately out of scope here — see
    `SCOPE.md`'s Open Questions for why and what's still needed.
    `ca_bands` is `[{"type":"PCC"|"SCC","band":"LTE BAND N"}, ...]`, not
    a flat array of band strings — mind this shape if touching carrier
    aggregation data.
- **`config/openmodem.conf`** — shell-sourced config (`KEY=value`, no
  spaces) read by the daemons and CGI scripts at startup. Poll intervals
  and log verbosity live here.
- **`www/`** — static HTML/CSS/JS front end with no framework and no
  build step. Pages poll `www/cgi-bin/*.sh` endpoints for state (e.g.
  `state.sh` returns the poller's merged JSON) rather than talking to the
  AT device directly.
  - `www/cgi-bin/` is the backend: POSIX shell CGI scripts executed by
    the modem's embedded web server (e.g. `busybox httpd`). They read
    query strings from `$QUERY_STRING` (no framework parsing), write
    `Content-Type`/`Cache-Control` headers by hand, and call into
    `bin/at_command.sh` rather than touching the AT device directly.
    `state.sh` (poller JSON passthrough) and `update.sh` (System's
    Update button) exist alongside three action scripts adapted from
    QuecControl's equivalents: `band_lock.sh` (get/set
    `AT+QNWPREFCFG`), `carrier_scan.sh` (`AT+COPS=?`, up to a 130s
    timeout), and `at_cmd.sh` (generic `AT+COMMAND` passthrough,
    backing both the AT Terminal and Power's fixed-command buttons — see
    `SCOPE.md`'s Actions section).
  - `app.js`'s state refresh is self-scheduling, not a fixed interval:
    each `state.sh` fetch reads `_poll_interval_s` from the response and
    reschedules its own next fetch using that value, so it tracks
    `POLL_INTERVAL` in `openmodem.conf` automatically. The "Updated Xs
    ago" display ticks every second on its own timer, independent of the
    actual (much slower) fetch cadence — don't conflate the two if
    touching either.
- **`installer.sh`** — same shape as QuecControl's installer:
  `curl -fsSL .../installer.sh | sh` first removes any existing
  QuecControl, SimpleAdmin, or OpenModem install (services, systemd
  units, `/usrdata/*`, `/tmp/*` runtime state — only one admin UI should
  run on the device at a time), then deploys `bin/`, `config/`, `www/`
  under `/usrdata/openmodem` and installs/starts systemd services for the
  broker, poller, and httpd. `openmodem.conf` is preserved across
  reinstalls. See `SCOPE.md`'s "Verified against real hardware" section
  for the confirmed SimpleAdmin/socat-at-bridge service names this
  cleans up. `www/cgi-bin/update.sh` is how the System page's Update button
  re-triggers this installer from GitHub — see its docstring and
  `SCOPE.md`'s Install/update section for the confirm-then-poll flow.

## Conventions

- Everything under `bin/` and `www/cgi-bin/` targets BusyBox `ash`, not
  bash — avoid bashisms (arrays, `[[ ]]`, `local` is BusyBox-safe but
  process substitution and here-strings are not).
- CGI scripts must print the `Content-Type` header (and a blank line)
  before any body output.
- Treat `$QUERY_STRING` and any AT command text built from user input as
  untrusted: validate/allowlist before passing it to the AT device (see
  QuecControl's `at_cmd.sh` for the pattern of blocking shell metacharacters
  and enforcing an `AT` prefix).
- Config changes in `config/openmodem.conf` require a service restart to
  take effect; document this in the file itself (as already done) rather
  than adding hot-reload logic.
- UI must be responsive (mobile and desktop) and follow the shared shell
  pattern in `www/style.css`/`www/app.js` — top bar, sidebar nav on
  desktop that collapses to a bottom tab bar on mobile, card-grid content
  (`.om-topbar`, `.om-sidebar`, `.om-tabbar`, `.om-main`, `.om-cards`).
  Modeled on modern router/modem admin UIs (GL.iNet-style). Reuse this
  shell on every page rather than inventing a new layout per page — see
  `SCOPE.md` for the full rationale.

## Development

There is no local dev server that replicates the modem's runtime — test
changes by deploying to the actual modem and exercising the web UI there.
When adding a `cgi-bin` script, verify it manually with `sh -n script.sh`
for syntax and, once deployable, with a real HTTP request against the
modem's httpd.

The modem being "connected over USB" gets you AT-command serial ports
(`ttyUSB0-3` on the host), but that is **not** where OpenModem runs. The
RM520N-GL has its own onboard Application Processor running a full Linux
(`sdxlemur`, systemd, BusyBox) — that's the actual install target, and the
way in is `adb shell` over the same USB connection (root shell once
ADB-unlocked; see `iamromulan/quectel-rgmii-configuration-notes` for the
unlock process on a fresh module — this device already had it done). From
there: `systemctl`, `/usrdata` (writable UBI volume — everything actually
lives here), and `/` (UBIFS, read-only by default, genuinely supports
`mount -o remount,rw /` despite showing an `assert=read-only` mount
option). Deployment to the device always goes through `installer.sh`'s
normal flow — commit and push to GitHub first, then either run
`curl -fsSL .../installer.sh | sh` on-device or trigger it from the
System page's Update button (`www/cgi-bin/update.sh`) — rather than
`adb push`ing individual files straight to `/usrdata/openmodem`. This
was the fast-iteration path early on, but it lets the device and git
history drift apart (an entire session's worth of work went live on
the device while sitting uncommitted in git); `installer.sh` is now the
only deployment path, not just how the install/update flow itself gets
verified. Raw GitHub content by branch (`.../main/...`) is CDN-cached
for a few minutes; pinning just the installer URL to a commit SHA does
**not** avoid this — `installer.sh`'s `REPO` var (what every file it
downloads is fetched from) was hardcoded to `.../main` regardless of
what URL fetched the script itself, confirmed live when a pinned
`installer.sh` fetch still installed a several-minutes-stale `app.js`.
Fixed by making `REPO` default to `.../main` but respect an
`OPENMODEM_INSTALL_REF` env var override — to genuinely pin an entire
deploy to a commit, set that on the `sh` side of the pipe (the process
that actually runs the script), not the `curl` side:
`curl -fsSL .../<sha>/installer.sh | OPENMODEM_INSTALL_REF="https://raw.githubusercontent.com/anthonysecco/OpenModem/<sha>" sh`.
Without that override, just wait out the branch cache (poll
`https://raw.githubusercontent.com/anthonysecco/OpenModem/main/<path>`
for the expected content) rather than assuming a pinned installer URL
alone made the wait unnecessary.
