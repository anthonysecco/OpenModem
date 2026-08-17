#!/bin/sh
# net_state.sh — serve net_poller's connectivity-check state as JSON.
#
# GET /cgi-bin/net_state.sh
#
# Deliberately separate from state.sh: net_poller.sh writes this file on
# its own cadence (as fast as every NET_ICMP_INTERVAL seconds), decoupled
# from at_poller.sh's own POLL_INTERVAL and STATE_FILE — see net_poller.sh's
# header comment for why the two pollers are kept independent.

NET_STATE_FILE="/tmp/openmodem/net_state.json"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

if [ ! -f "$NET_STATE_FILE" ]; then
    printf '{"_error":"unavailable","_message":"Connectivity poller not running or still initialising"}\n'
    exit 0
fi

cat "$NET_STATE_FILE"
