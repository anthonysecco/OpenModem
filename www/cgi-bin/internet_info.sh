#!/bin/sh
# internet_info.sh — public IP/ASN/ISP/geolocation lookup for the WAN
# page's Internet card, requested by the modem itself (via curl, over
# its own WAN connection) rather than the browser — see SCOPE.md for
# why this moved server-side.
#
# GET (no params) — passes through ipinfo.io's own JSON response as-is
# on success. On failure (no WAN, timeout, curl error) returns this
# project's usual {"success":false,"error":...} shape instead, since
# ipinfo.io's own shape has no such field to key off of.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

RESP=$(curl -fsSL -m 8 'https://ipinfo.io/json' 2>/dev/null)
RC=$?

if [ "$RC" -eq 0 ] && [ -n "$RESP" ]; then
    echo "$RESP"
else
    printf '{"success":false,"error":"ipinfo.io request failed (curl exit %s)"}\n' "$RC"
fi
