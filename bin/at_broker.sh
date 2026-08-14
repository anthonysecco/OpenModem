#!/bin/sh
# at_broker.sh — serializes AT command access to AT_DEVICE via a FIFO.
#
# AT_DEVICE (e.g. /dev/smd11) is a raw character device, not a tty: no
# stty, and "read -t" does not work on it. Reads are done by running
# "cat <&3" in the background for a fixed window, then killing it and
# checking what arrived — confirmed against real RM520N-GL hardware
# (a single ~100ms window is enough to capture a full "ATI" response,
# including its terminal OK). This technique and the FIFO protocol below
# follow QuecControl's at_broker.sh, the same approach applied to the
# same hardware constraint.
#
# Protocol:
#   Request  -> echo "req_id|timeout_s|AT+COMMAND" > /tmp/at_request
#   Response <- appears at /tmp/at_responses/<req_id>

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
AT_DEVICE="/dev/smd11"
LOG_LEVEL=1
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

REQUEST_PIPE="/tmp/at_request"
RESPONSE_DIR="/tmp/at_responses"
RUN_DIR="/tmp/openmodem"
LOG_FILE="$RUN_DIR/broker.log"
POLL_FILE="/tmp/at_broker_poll.$$"

POLL_INTERVAL_US=100000   # 100ms per read window
LOG_MAX_BYTES=262144      # rotate at 256KB — /usrdata is small on this hardware
LOG_SLOTS=2               # current + 1 rotated file

mkdir -p "$RUN_DIR"

# -- Logging ------------------------------------------------------------
log_err() { echo "$(date '+%Y-%m-%d %H:%M:%S') [broker] ERROR $*" >> "$LOG_FILE"; }
log_op()  { [ "$LOG_LEVEL" -ge 1 ] 2>/dev/null && echo "$(date '+%Y-%m-%d %H:%M:%S') [broker] $*" >> "$LOG_FILE"; }
log_dbg() { [ "$LOG_LEVEL" -ge 2 ] 2>/dev/null && echo "$(date '+%Y-%m-%d %H:%M:%S') [broker] $*" >> "$LOG_FILE"; }

rotate_log() {
    [ -f "$LOG_FILE" ] || return
    _size=$(wc -c < "$LOG_FILE" 2>/dev/null) || return
    if [ "$_size" -gt "$LOG_MAX_BYTES" ]; then
        _slot=$(( LOG_SLOTS - 1 ))
        while [ "$_slot" -gt 1 ]; do
            _prev=$(( _slot - 1 ))
            [ -f "${LOG_FILE}.${_prev}" ] && mv "${LOG_FILE}.${_prev}" "${LOG_FILE}.${_slot}"
            _slot=$(( _slot - 1 ))
        done
        mv "$LOG_FILE" "${LOG_FILE}.1"
    fi
}

cleanup() {
    log_op "Broker shutting down"
    exec 3<&- 3>&- 4<&- 4>&- 2>/dev/null
    rm -f "$REQUEST_PIPE" "$POLL_FILE"
    rm -rf "$RESPONSE_DIR"
    exit 0
}
trap cleanup INT TERM

# -- Wait for the AT device to appear (it may not be ready the instant
#    this service starts) --
_wait=0
while [ ! -c "$AT_DEVICE" ] && [ "$_wait" -lt 20 ]; do
    sleep 1
    _wait=$(( _wait + 1 ))
done
if [ ! -c "$AT_DEVICE" ]; then
    log_err "AT device $AT_DEVICE not present after ${_wait}s, giving up"
    exit 1
fi

rm -f "$REQUEST_PIPE" "$POLL_FILE"
rm -rf "$RESPONSE_DIR"
mkfifo "$REQUEST_PIPE"
chmod 666 "$REQUEST_PIPE"
mkdir -p "$RESPONSE_DIR"
chmod 777 "$RESPONSE_DIR"

exec 3<>"$AT_DEVICE"

# Hold the FIFO open read-write on a persistent fd for the broker's whole
# lifetime, rather than reopening it fresh for each `read` (the QuecControl
# pattern this was ported from does the latter). Confirmed by testing
# against real hardware: with a per-iteration `read -r request <
# "$REQUEST_PIPE"`, a writer racing the brief window between one read
# closing the fd and the next iteration reopening it loses its request
# outright — three concurrent writers, only two requests ever reached the
# broker. Keeping fd 4 open read-write means a reader is always present
# (no blocking-open race for writers) and nothing gets silently dropped.
exec 4<>"$REQUEST_PIPE"

log_op "Broker starting on $AT_DEVICE (log_level=${LOG_LEVEL})"

# -- Startup flush: drain any stale data left in the device buffer from a
#    previous session --
_flushed=0
while true; do
    cat <&3 > "$POLL_FILE" &
    FPID=$!
    usleep "$POLL_INTERVAL_US" 2>/dev/null || sleep 1
    kill "$FPID" 2>/dev/null
    wait "$FPID" 2>/dev/null
    if [ -s "$POLL_FILE" ]; then
        _flushed=$(( _flushed + 1 ))
    else
        break
    fi
done
rm -f "$POLL_FILE"
log_op "Startup flush: ${_flushed} stale chunk(s) discarded"

_req_count=0

# -- Main request loop ---------------------------------------------------
while true; do
    if read -r request <&4; then
        _req_count=$(( _req_count + 1 ))
        [ $(( _req_count % 50 )) -eq 0 ] && rotate_log

        req_id=$(echo "$request" | cut -d'|' -f1)
        timeout=$(echo "$request" | cut -d'|' -f2)
        at_cmd=$(echo "$request" | cut -d'|' -f3-)

        if [ -z "$req_id" ] || [ -z "$at_cmd" ] || ! echo "$timeout" | grep -qE '^[0-9]+$'; then
            log_err "Malformed request: $request"
            continue
        fi

        log_dbg "REQ[$req_id] timeout=${timeout}s: $at_cmd"
        printf '%s\r' "$at_cmd" >&3

        # Accumulate response chunks across fixed-interval read windows,
        # stopping as soon as a terminal line is seen rather than always
        # running to the full timeout.
        RESPONSE=""
        _poll=0
        _max_polls=$(( timeout * 10 ))

        while [ "$_poll" -lt "$_max_polls" ]; do
            cat <&3 > "$POLL_FILE" &
            CPID=$!
            usleep "$POLL_INTERVAL_US" 2>/dev/null || sleep 1
            kill "$CPID" 2>/dev/null
            wait "$CPID" 2>/dev/null

            if [ -s "$POLL_FILE" ]; then
                RESPONSE="${RESPONSE}$(cat "$POLL_FILE")"
                if printf '%s' "$RESPONSE" | tr -d '\r' | grep -qE '^(OK|ERROR|\+CME ERROR|\+CMS ERROR)'; then
                    rm -f "$POLL_FILE"
                    break
                fi
            fi
            rm -f "$POLL_FILE"
            _poll=$(( _poll + 1 ))
        done

        if [ -z "$RESPONSE" ]; then
            RESPONSE="TIMEOUT"
            log_err "REQ[$req_id] TIMEOUT after ${timeout}s: $at_cmd"
        fi

        echo "$RESPONSE" > "$RESPONSE_DIR/${req_id}"
    fi
done
