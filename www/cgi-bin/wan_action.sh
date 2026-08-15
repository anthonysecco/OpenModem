#!/bin/sh
# wan_action.sh — WAN actions: data counter reset and TTL spoofing.
#
# GET ?action=reset_counter
#     AT+QGDCNT=0 — zeroes the cumulative TX/RX byte counters that
#     at_poller.sh's wan_data_tx/wan_data_rx report.
#
# GET ?action=get_ttl
#     Returns the persisted TTL/hop-limit override value (config/
#     openmodem.conf's TTL_VALUE key).
#
# GET ?action=set_ttl&value=N
#     N=0 disables spoofing; N=1-255 sets it. Deletes the specific old
#     rule (by value, not a chain flush — see below) before inserting
#     the new one, then persists TTL_VALUE so bin/apply_iptables.sh
#     re-applies it after a reboot.
#
# TTL spoofing is OpenModem's own iptables/ip6tables mangle rule now —
# it was originally a front-end for a pre-existing third-party package
# on this device (SimpleFirewall's ttl-override.service), but that
# introduced a hard dependency the project doesn't want (see SCOPE.md:
# "no additional software installed on the modem" is a core constraint,
# and SimpleFirewall requires bash, which nothing else here does).
# SimpleFirewall has been fully removed by installer.sh; this script and
# bin/apply_iptables.sh (boot-time re-application) replace both halves
# of what it did — TTL override and, separately, the web-UI port
# protection it also provided (see apply_iptables.sh's own comment).
#
# Deliberately never flushes the whole mangle/POSTROUTING chain
# (`iptables -t mangle -F POSTROUTING`, which is what SimpleFirewall's
# own script and QuecControl's original wan_action.sh both do) — on this
# hardware that chain also carries two Qualcomm baseband rules
# (qcom_qos_reset_POSTROUTING/qcom_qos_filter_POSTROUTING), unrelated to
# TTL, that a blind flush silently deletes. Confirmed live: flushing to
# clean up a test rule wiped them too. Uses a targeted delete of just
# the rule this script itself owns instead.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"
CONF_FILE="/usrdata/openmodem/config/openmodem.conf"

ACTION=""
VALUE=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | grep -o 'action=[^&]*' | cut -d= -f2 | head -1)
    VALUE=$(echo "$QUERY_STRING"  | grep -o 'value=[^&]*'  | cut -d= -f2 | head -1)
fi
[ -z "$ACTION" ] && ACTION="invalid"

json_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

current_ttl() {
    _val=$(grep '^TTL_VALUE=' "$CONF_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r\n')
    echo "$_val" | grep -qE '^[0-9]+$' && echo "$_val" || echo "0"
}

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
    printf '{"success":true,"ttl":%s}\n' "$(current_ttl)"
    ;;

  set_ttl)
    if ! echo "$VALUE" | grep -qE '^[0-9]+$' || [ "$VALUE" -gt 255 ]; then
        echo '{"success":false,"error":"TTL must be 0 (disabled) or 1-255"}'
        exit 1
    fi

    OLD=$(current_ttl)
    if [ "$OLD" -gt 0 ]; then
        iptables  -t mangle -D POSTROUTING -o rmnet+ -j TTL --ttl-set "$OLD" 2>/dev/null
        ip6tables -t mangle -D POSTROUTING -o rmnet+ -j HL  --hl-set  "$OLD" 2>/dev/null
    fi

    if [ "$VALUE" -gt 0 ]; then
        if ! iptables -t mangle -I POSTROUTING -o rmnet+ -j TTL --ttl-set "$VALUE"; then
            echo '{"success":false,"error":"iptables command failed"}'
            exit 1
        fi
        ip6tables -t mangle -I POSTROUTING -o rmnet+ -j HL --hl-set "$VALUE" 2>/dev/null
    fi

    mkdir -p "$(dirname "$CONF_FILE")"
    _tmp="${CONF_FILE}.tmp"
    if [ -f "$CONF_FILE" ]; then
        grep -v '^TTL_VALUE=' "$CONF_FILE" > "$_tmp"
    else
        : > "$_tmp"
    fi
    echo "TTL_VALUE=${VALUE}" >> "$_tmp"
    mv "$_tmp" "$CONF_FILE"

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
