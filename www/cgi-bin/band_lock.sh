#!/bin/sh
# band_lock.sh — GET or SET LTE/NR5G band lock, adapted from QuecControl's
# band_lock.sh (same AT+QNWPREFCFG mechanism, verified against real
# hardware — see SCOPE.md).
#
# GET /cgi-bin/band_lock.sh?action=get
#     Returns current lte_bands / nr_bands as JSON arrays (null if the
#     modem reports a hex bitmask instead of a colon list, meaning "all
#     bands" — not worth decoding for display).
#
# GET /cgi-bin/band_lock.sh?action=set&lte_bands=2,4,12&nr_bands=71
#     Bands are comma-separated in the query string; the modem expects
#     colon-separated. NR bands are applied to both nr5g_band (SA) and
#     nsa_nr5g_band (NSA) — same as QuecControl, since a band lock that
#     only covers one of the two leaves the other free to roam anywhere.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"

if [ ! -p /tmp/at_request ]; then
    echo '{"success":false,"error":"AT broker not running"}'
    exit 1
fi

url_decode() {
    printf '%s' "$1" | sed 's/%2C/,/g; s/%2c/,/g; s/%3A/:/g; s/%3a/:/g'
}

ACTION=""
LTE_BANDS=""
NR_BANDS=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING"  | grep -o 'action=[^&]*'    | cut -d= -f2 | head -1)
    LTE_RAW=$(echo "$QUERY_STRING" | grep -o 'lte_bands=[^&]*' | cut -d= -f2 | head -1)
    NR_RAW=$(echo "$QUERY_STRING"  | grep -o 'nr_bands=[^&]*'  | cut -d= -f2 | head -1)
    LTE_BANDS=$(url_decode "$LTE_RAW")
    NR_BANDS=$(url_decode "$NR_RAW")
fi
[ -z "$ACTION" ] && ACTION="get"

run_at() { "$AT_CMD" "$1" "${2:-8}" 2>/dev/null | tr -d '\r'; }
at_ok()  { echo "$1" | grep -q '^OK'; }

# Colon-separated band list from a +QNWPREFCFG response, empty if the
# modem returned a hex bitmask instead (means "all bands").
parse_band_list() {
    _val=$(echo "$1" | grep '+QNWPREFCFG:' | sed "s/+QNWPREFCFG: \"${2}\",//" | tr -d '" \r\n')
    case "$_val" in
        0x*|0X*) echo "" ;;
        *)       echo "$_val" ;;
    esac
}

if [ "$ACTION" = "get" ]; then
    LTE_VAL=$(parse_band_list "$(run_at 'AT+QNWPREFCFG="lte_band"')" "lte_band")
    NR_VAL=$(parse_band_list  "$(run_at 'AT+QNWPREFCFG="nr5g_band"')" "nr5g_band")

    [ -n "$LTE_VAL" ] && lte_json="[$(echo "$LTE_VAL" | sed 's/:/, /g')]" || lte_json="null"
    [ -n "$NR_VAL" ]  && nr_json="[$(echo "$NR_VAL" | sed 's/:/, /g')]"   || nr_json="null"

    echo "{\"success\":true,\"lte_bands\":${lte_json},\"nr_bands\":${nr_json}}"
    exit 0
fi

if [ "$ACTION" = "set" ]; then
    if [ -z "$LTE_BANDS" ] && [ -z "$NR_BANDS" ]; then
        echo '{"success":false,"error":"No bands specified"}'
        exit 1
    fi

    ERRORS=""

    if [ -n "$LTE_BANDS" ]; then
        RESP=$(run_at "AT+QNWPREFCFG=\"lte_band\",$(echo "$LTE_BANDS" | sed 's/,/:/g')")
        at_ok "$RESP" || ERRORS="${ERRORS}LTE band lock failed: ${RESP}. "
    fi

    if [ -n "$NR_BANDS" ]; then
        NR_COLON=$(echo "$NR_BANDS" | sed 's/,/:/g')
        RESP=$(run_at "AT+QNWPREFCFG=\"nr5g_band\",${NR_COLON}")
        at_ok "$RESP" || ERRORS="${ERRORS}NR SA band lock failed: ${RESP}. "
        RESP=$(run_at "AT+QNWPREFCFG=\"nsa_nr5g_band\",${NR_COLON}")
        at_ok "$RESP" || ERRORS="${ERRORS}NR NSA band lock failed: ${RESP}. "
    fi

    if [ -n "$ERRORS" ]; then
        printf '{"success":false,"error":"%s"}\n' "$(echo "$ERRORS" | sed 's/[[:space:]]*$//')"
        exit 1
    fi

    echo '{"success":true,"message":"Band lock applied. Network may reconnect; the dashboard will catch up on the next poll cycle."}'
    exit 0
fi

echo '{"success":false,"error":"Invalid action"}'
exit 1
