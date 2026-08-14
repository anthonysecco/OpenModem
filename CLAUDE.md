# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenModem is a local web front end for the Quectel RM520N-GL modem. It runs
directly on the modem's onboard embedded Linux and is served by the modem's
own web server — there is no cloud backend and no build step. During
development, the modem is connected to this host over USB.

The design takes inspiration from
[QuecControl](https://github.com/anthonysecco/QuecControl), an existing
project for the same modem family. Consult it for prior art on the AT
broker/poller pattern, CGI conventions, and installer structure before
inventing new approaches.

## Architecture

The runtime environment is constrained: BusyBox shell, no Node/Python/Go on
the modem itself. Everything that runs on-device is POSIX `sh` and static
web assets.

- **`bin/`** — long-running shell daemons installed as services on the
  modem:
  - `at_broker.sh` owns the AT command device (e.g. `/dev/smd11`, a raw
    character device, not a tty — `stty`/`read -t` don't work on it) and
    serializes access through a request/response FIFO so the poller and
    CGI scripts never write to it concurrently. Protocol:
    `echo "req_id|timeout_s|AT+COMMAND" > /tmp/at_request`, response
    appears at `/tmp/at_responses/<req_id>`.
  - `at_poller.sh` periodically issues AT commands through the broker and
    writes merged state to `/tmp/openmodem/state_merged.json` for the
    front end to poll.
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
    `bin/at_command.sh`-style helpers rather than touching the AT device
    directly.
- **`installer.sh`** — deploys `bin/`, `config/`, `www/` onto the modem's
  filesystem (conventionally under `/usrdata/openmodem`) and installs/
  starts services for the broker, poller, and httpd.

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

## Development

There is no local dev server that replicates the modem's runtime — test
changes by deploying to the actual modem (connected via USB) and exercising
the web UI there. When adding a `cgi-bin` script, verify it manually with
`sh -n script.sh` for syntax and, once deployable, with a real HTTP request
against the modem's httpd.
