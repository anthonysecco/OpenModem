#!/bin/sh
# network_action.sh — SET Network Mode (AT+QNWPREFCFG="mode_pref") and
# Data Roaming (AT+QNWCFG="data_roaming"). No GET action here: both
# current values are already surfaced by the poller as net_mode_pref/
# net_data_roaming in state.sh's JSON, so the front end reads its
# baseline from there rather than a second round trip.
#
# Both commands confirmed live against this hardware (2026-08-17):
# AT+QNWPREFCFG="mode_pref" answers with a colon-separated RAT list the
# same way lte_band/nr5g_band do (this module's own AT+QNWPREFCFG=?
# lists it as "mode_pref",RAT1:...:RATN); AT+QNWCFG="data_roaming" is a
# plain (0,1) toggle per its own AT+QNWCFG=? entry. There is NO
# "roamservice" QCFG key on this firmware — data_roaming is the real
# roaming control here, not that.
#
# GET /cgi-bin/network_action.sh?action=set_mode&mode=AUTO|LTE|NR5G|LTE:NR5G
# GET /cgi-bin/network_action.sh?action=set_roaming&value=0|1

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"

if [ ! -p /tmp/at_request ]; then
    echo '{"success":false,"error":"AT broker not running"}'
    exit 1
fi

url_decode() {
    printf '%s' "$1" | sed 's/%3A/:/g; s/%3a/:/g'
}

ACTION=""
MODE=""
VALUE=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | grep -o 'action=[^&]*' | cut -d= -f2 | head -1)
    MODE_RAW=$(echo "$QUERY_STRING" | grep -o 'mode=[^&]*' | cut -d= -f2 | head -1)
    MODE=$(url_decode "$MODE_RAW")
    VALUE=$(echo "$QUERY_STRING" | grep -o 'value=[^&]*' | cut -d= -f2 | head -1)
fi

run_at() { "$AT_CMD" "$1" "${2:-8}" 2>/dev/null | tr -d '\r'; }
at_ok()  { echo "$1" | grep -q '^OK'; }

# action=set_mode — mode is allowlisted against the exact literal RAT
# combinations this UI offers (see cellular.html's toggle group), not
# passed through — same untrusted-input handling as band_lock.sh.
if [ "$ACTION" = "set_mode" ]; then
    case "$MODE" in
        AUTO|LTE|NR5G|LTE:NR5G) ;;
        *) echo '{"success":false,"error":"Invalid mode"}'; exit 1 ;;
    esac

    RESP=$(run_at "AT+QNWPREFCFG=\"mode_pref\",${MODE}")
    if at_ok "$RESP"; then
        echo '{"success":true,"message":"Network mode applied. The connection may briefly reconnect."}'
        exit 0
    fi
    printf '{"success":false,"error":"%s"}\n' "$RESP"
    exit 1
fi

if [ "$ACTION" = "set_roaming" ]; then
    case "$VALUE" in
        0|1) ;;
        *) echo '{"success":false,"error":"Invalid value"}'; exit 1 ;;
    esac

    RESP=$(run_at "AT+QNWCFG=\"data_roaming\",${VALUE}")
    if at_ok "$RESP"; then
        echo '{"success":true,"message":"Data roaming updated."}'
        exit 0
    fi
    printf '{"success":false,"error":"%s"}\n' "$RESP"
    exit 1
fi

echo '{"success":false,"error":"Invalid action"}'
exit 1
