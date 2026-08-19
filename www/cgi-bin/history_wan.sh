#!/bin/sh
# history_wan.sh — serve at_poller.sh's 5-minute WAN rx/tx rate history
# ring buffer as a JSON array.
#
# GET /cgi-bin/history_wan.sh

HISTORY_FILE="/tmp/openmodem/history_wan.json"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

if [ ! -f "$HISTORY_FILE" ]; then
    printf '{"_error":"unavailable","_message":"Poller not running or still initialising"}\n'
    exit 0
fi

cat "$HISTORY_FILE"
