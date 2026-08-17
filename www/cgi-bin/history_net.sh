#!/bin/sh
# history_net.sh — serve net_poller.sh's 5-minute latency/jitter history
# ring buffer as a JSON array.
#
# GET /cgi-bin/history_net.sh

HISTORY_FILE="/tmp/openmodem/history_net.json"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

if [ ! -f "$HISTORY_FILE" ]; then
    printf '{"_error":"unavailable","_message":"Connectivity poller not running or still initialising"}\n'
    exit 0
fi

cat "$HISTORY_FILE"
