#!/bin/sh
# carrier_scan.sh — trigger AT+COPS=? (full network scan) and return
# discovered operators as JSON. Adapted from QuecControl's carrier_scan.sh.
#
# A real scan takes up to ~2 minutes and briefly interrupts data service
# while the modem searches — the frontend must warn about this before
# calling (see cellular.html/app.js's confirm-then-scan flow).

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"

if [ ! -p /tmp/at_request ]; then
    echo '{"operators":[],"error":"AT broker not running"}'
    exit 1
fi

# 130s: AT+COPS=? itself can take up to ~120s per the AT command reference.
COPS_RAW=$("$AT_CMD" "AT+COPS=?" 130 | tr -d '\r')

if [ "$COPS_RAW" = "TIMEOUT" ]; then
    echo '{"operators":[],"error":"Scan timed out"}'
    exit 0
fi

if echo "$COPS_RAW" | grep -qE '^ERROR|^\+CME ERROR'; then
    ERR=$(echo "$COPS_RAW" | grep -E 'ERROR' | head -1)
    printf '{"operators":[],"error":"%s"}\n' "$ERR"
    exit 0
fi

COPS_LINE=$(echo "$COPS_RAW" | grep '^+COPS:' | sed 's/^+COPS: //')
if [ -z "$COPS_LINE" ]; then
    echo '{"operators":[],"error":"No response from modem"}'
    exit 0
fi

# Each operator entry looks like (status,"long","short","plmn",act) and
# entries are comma-separated between parens. status: 0=unknown,
# 1=available, 2=current, 3=forbidden.
OPERATORS=$(echo "$COPS_LINE" | awk '
BEGIN { first = 1; out = "" }
{
    n = split($0, entries, /\),\(/)
    for (i = 1; i <= n; i++) {
        entry = entries[i]
        gsub(/^\(/, "", entry)
        gsub(/\).*$/, "", entry)
        clean = entry
        gsub(/"/, "", clean)
        split(clean, f, ",")
        status = f[1]; longn = f[2]; shortn = f[3]; plmn = f[4]; act = f[5]
        if (status !~ /^[0-9]$/) continue
        if (plmn == "") continue
        gsub(/"/, "\\\"", longn)
        gsub(/"/, "\\\"", shortn)
        if (!first) out = out ","
        first = 0
        out = out "{\"status\":" status ",\"name\":\"" longn "\",\"plmn\":\"" plmn "\",\"act\":\"" act "\"}"
    }
}
END { print out }
')

echo "{\"operators\":[${OPERATORS}]}"
