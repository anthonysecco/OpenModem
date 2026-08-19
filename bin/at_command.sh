#!/bin/sh
# at_command.sh — client for at_broker.sh's FIFO protocol.
# Usage: at_command.sh "AT+COMMAND" [timeout_seconds]

REQUEST_PIPE="/tmp/at_request"
RESPONSE_DIR="/tmp/at_responses"

at_cmd="$1"
timeout="${2:-8}"

if [ ! -p "$REQUEST_PIPE" ]; then
    echo "ERROR: AT broker not running"
    exit 1
fi

if [ -z "$at_cmd" ]; then
    echo "ERROR: No AT command specified"
    exit 1
fi

# PID + wall-clock second alone can collide: this device's PID space is
# small enough that two concurrent callers (e.g. a browser tab and
# ha_state.sh polling at the same moment) can land on the same PID+second
# combo, letting one caller read the other's response or delete it out
# from under it via the cleanup below. mktemp's random suffix (confirmed
# live on this hardware's BusyBox build — no %N/nanosecond date support
# to fall back on instead) closes that gap. Fixed 2026-08-19.
req_id="$$_$(date +%s)_$(mktemp -u XXXXXX)"

# Request format: req_id|timeout|command
echo "${req_id}|${timeout}|${at_cmd}" > "$REQUEST_PIPE"

# Poll for the response file — wait slightly longer than the broker's own
# timeout so a slow-but-answered command isn't cut off here first.
#
# elapsed counts 100ms ticks, not seconds — wait_limit must be scaled by
# 10 to match, or this loop gives up after (timeout+5) * 100ms instead of
# (timeout+5) seconds. Found by testing a real 130s carrier scan: it came
# back "TIMEOUT" after ~14s instead of waiting the requested ~135s. Same
# bug exists in QuecControl's at_command.sh, which this was ported from.
wait_limit=$(( (timeout + 5) * 10 ))
elapsed=0
while [ ! -f "$RESPONSE_DIR/${req_id}" ] && [ "$elapsed" -lt "$wait_limit" ]; do
    usleep 100000 2>/dev/null || sleep 0.1
    elapsed=$(( elapsed + 1 ))
done

if [ -f "$RESPONSE_DIR/${req_id}" ]; then
    cat "$RESPONSE_DIR/${req_id}"
    rm -f "$RESPONSE_DIR/${req_id}"
else
    echo "TIMEOUT"
    exit 1
fi
