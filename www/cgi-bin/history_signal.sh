#!/bin/sh
# history_signal.sh — serve at_poller.sh's 5-minute signal history ring
# buffer as a JSON array.
#
# GET /cgi-bin/history_signal.sh

HISTORY_FILE="/tmp/openmodem/history_signal.json"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

if [ ! -f "$HISTORY_FILE" ]; then
    printf '{"_error":"unavailable","_message":"Poller not running or still initialising"}\n'
    exit 0
fi

cat "$HISTORY_FILE"
