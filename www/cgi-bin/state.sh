#!/bin/sh
# state.sh — serve merged poller state as JSON.
#
# GET /cgi-bin/state.sh

MERGED_FILE="/tmp/openmodem/state_merged.json"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

if [ ! -f "$MERGED_FILE" ]; then
    printf '{"_error":"unavailable","_message":"Poller not running or still initialising"}\n'
    exit 0
fi

cat "$MERGED_FILE"
