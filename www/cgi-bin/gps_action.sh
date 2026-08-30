#!/bin/sh
# gps_action.sh — enable/disable the GPS session.
#
# GET ?action=enable
#     AT+QGPS=1, then AT+QGPSCFG="nmeasrc",1 so a later AT+QGPSGNMEA query
#     would also work (confirmed live 2026-08-30: nmeasrc resets to 0 at
#     some point — likely a reboot — silently breaking the NMEA family
#     with "+CME ERROR: Function not enable" until it's set again; see
#     SCOPE.md). Touches GPS_FLAG so at_poller.sh starts chaining
#     AT+QGPSLOC=2 onto its next cycle.
# GET ?action=disable
#     AT+QGPSEND. Removes GPS_FLAG so the poller stops querying position.
#
# Immediate confirm-then-act, same shape as sim_action.sh's set_slot —
# nothing here is staged/batched, unlike LAN/Band Lock's apply-bar forms.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"
RUN_DIR="/tmp/openmodem"
GPS_FLAG="$RUN_DIR/gps_enabled"

if [ ! -p /tmp/at_request ]; then
    echo '{"success":false,"error":"AT broker not running"}'
    exit 1
fi

ACTION=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | grep -o 'action=[^&]*' | cut -d= -f2 | head -1)
fi
[ -z "$ACTION" ] && ACTION="invalid"

json_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

case "$ACTION" in

  enable)
    RESP=$("$AT_CMD" "AT+QGPS=1" 10 2>/dev/null | tr -d '\r')
    if echo "$RESP" | grep -q '^OK'; then
        "$AT_CMD" 'AT+QGPSCFG="nmeasrc",1' 10 >/dev/null 2>&1
        mkdir -p "$RUN_DIR"
        touch "$GPS_FLAG"
        echo '{"success":true,"message":"GPS enabled. Acquiring a fix can take a while outdoors with a clear sky view."}'
    else
        printf '{"success":false,"error":"AT command failed: %s"}\n' "$(json_esc "$RESP")"
        exit 1
    fi
    ;;

  disable)
    RESP=$("$AT_CMD" "AT+QGPSEND" 10 2>/dev/null | tr -d '\r')
    if echo "$RESP" | grep -q '^OK'; then
        rm -f "$GPS_FLAG"
        echo '{"success":true,"message":"GPS disabled."}'
    else
        printf '{"success":false,"error":"AT command failed: %s"}\n' "$(json_esc "$RESP")"
        exit 1
    fi
    ;;

  *)
    echo '{"success":false,"error":"Invalid action"}'
    exit 1
    ;;

esac
