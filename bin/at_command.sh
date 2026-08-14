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

req_id="$$_$(date +%s)"

# Request format: req_id|timeout|command
echo "${req_id}|${timeout}|${at_cmd}" > "$REQUEST_PIPE"

# Poll for the response file — wait slightly longer than the broker's own
# timeout so a slow-but-answered command isn't cut off here first.
wait_limit=$(( timeout + 5 ))
elapsed=0
while [ ! -f "$RESPONSE_DIR/${req_id}" ] && [ "$elapsed" -lt "$wait_limit" ]; do
    usleep 100000 2>/dev/null || sleep 1
    elapsed=$(( elapsed + 1 ))
done

if [ -f "$RESPONSE_DIR/${req_id}" ]; then
    cat "$RESPONSE_DIR/${req_id}"
    rm -f "$RESPONSE_DIR/${req_id}"
else
    echo "TIMEOUT"
    exit 1
fi
