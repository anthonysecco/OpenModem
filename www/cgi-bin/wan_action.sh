#!/bin/sh
# wan_action.sh — WAN actions: data counter reset and TTL spoofing.
#
# GET ?action=reset_counter
#     AT+QGDCNT=0 — zeroes the cumulative TX/RX byte counters that
#     at_poller.sh's wan_data_tx/wan_data_rx report.
#
# GET ?action=get_ttl
#     Returns the persisted TTL/hop-limit override value.
#
# GET ?action=set_ttl&value=N
#     N=0 disables spoofing; N=1-255 sets it. See below for why this
#     doesn't touch iptables directly.
#
# TTL spoofing is NOT implemented as OpenModem's own iptables rule.
# This device already has a separate, pre-existing package —
# SimpleFirewall (/usrdata/simplefirewall/) — with its own
# ttl-override.service independently managing the exact same mechanism
# (a POSTROUTING mangle TTL/HL rule on the rmnet+ WWAN interfaces,
# confirmed live: iptables -t mangle -I POSTROUTING -o rmnet+ -j TTL
# --ttl-set N / ip6tables ... -j HL --hl-set N). The TTL target doesn't
# stop rule processing, so two independently-managed rules silently
# fight over the last word on every packet — confirmed by testing:
# flushing SimpleFirewall's live TTL=88 rule during development and
# re-adding a different value would have left both rules stacked, with
# whichever is later in the chain quietly winning regardless of what
# either UI shows. Rather than risk that, this is deliberately a
# front-end for SimpleFirewall's existing mechanism: it reads/writes
# /usrdata/simplefirewall/ttlvalue and drives its ttl-override script,
# instead of managing iptables independently. This makes the feature
# dependent on SimpleFirewall being present on the device — see
# SCOPE.md.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"
TTL_OVERRIDE="/usrdata/simplefirewall/ttl-override"
TTL_VALUE_FILE="/usrdata/simplefirewall/ttlvalue"

ACTION=""
VALUE=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | grep -o 'action=[^&]*' | cut -d= -f2 | head -1)
    VALUE=$(echo "$QUERY_STRING"  | grep -o 'value=[^&]*'  | cut -d= -f2 | head -1)
fi
[ -z "$ACTION" ] && ACTION="invalid"

json_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

case "$ACTION" in

  reset_counter)
    if [ ! -p /tmp/at_request ]; then
        echo '{"success":false,"error":"AT broker not running"}'
        exit 1
    fi
    RESP=$("$AT_CMD" "AT+QGDCNT=0" 8 2>/dev/null | tr -d '\r')
    if echo "$RESP" | grep -q '^OK'; then
        echo '{"success":true,"message":"Data usage counter reset."}'
    else
        printf '{"success":false,"error":"AT command failed: %s"}\n' "$(json_esc "$RESP")"
        exit 1
    fi
    ;;

  get_ttl)
    if [ ! -f "$TTL_VALUE_FILE" ]; then
        echo '{"success":true,"ttl":0}'
        exit 0
    fi
    TTL=$(grep -o '[0-9]\{1,3\}' "$TTL_VALUE_FILE" | head -1)
    [ -z "$TTL" ] && TTL=0
    printf '{"success":true,"ttl":%s}\n' "$TTL"
    ;;

  set_ttl)
    if ! echo "$VALUE" | grep -qE '^[0-9]+$' || [ "$VALUE" -gt 255 ]; then
        echo '{"success":false,"error":"TTL must be 0 (disabled) or 1-255"}'
        exit 1
    fi
    if [ ! -x "$TTL_OVERRIDE" ]; then
        echo '{"success":false,"error":"SimpleFirewall ttl-override not found on this device"}'
        exit 1
    fi

    # Stop FIRST, while ttlvalue still holds the currently-applied value
    # — ttl-override's stop action deletes the iptables rule matching
    # whatever's in that file right now. Overwriting the file before
    # stopping would make it try to delete a rule for the *new* value,
    # which was never inserted, leaving the old rule stuck and stacking
    # a second one on top of it.
    "$TTL_OVERRIDE" stop >/dev/null 2>&1
    echo "$VALUE" > "$TTL_VALUE_FILE"
    START_OUT=$("$TTL_OVERRIDE" start 2>&1)

    if [ "$VALUE" = "0" ]; then
        echo '{"success":true,"message":"TTL spoofing disabled."}'
    else
        printf '{"success":true,"message":"TTL set to %s."}\n' "$(json_esc "$VALUE")"
    fi
    ;;

  *)
    echo '{"success":false,"error":"Invalid action"}'
    exit 1
    ;;

esac
