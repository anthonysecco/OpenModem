#!/bin/sh
# wan_action.sh — WAN actions: data counter reset and TTL spoofing.
#
# GET ?action=reset_counter
#     AT+QGDCNT=0 — zeroes the cumulative TX/RX byte counters that
#     at_poller.sh's wan_data_tx/wan_data_rx report.
#
# GET ?action=get_ttl
#     Returns the persisted TTL/hop-limit override value (config/
#     openmodem.conf's TTL_VALUE key) as "ttl", and the TTL actually in
#     effect as "applied" (bin/ttl.sh applied; 0 = no rule). The two
#     differ when a saved value did not take effect, which the WAN page
#     shows rather than letting the saved number stand for what the
#     modem is doing.
#
# GET ?action=set_ttl&value=N
#     N=0 disables spoofing; N=1-255 sets it. Applied through bin/ttl.sh,
#     which removes every TTL rule (by rule, not a chain flush — see
#     below) before adding the new one and confirms it is in effect. Only
#     then is TTL_VALUE persisted, so bin/apply_iptables.sh re-applies it
#     after a reboot.
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
# clean up a test rule wiped them too. Uses targeted deletes of the TTL
# rules instead (bin/ttl.sh).

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"
TTL_SH="/usrdata/openmodem/bin/ttl.sh"
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

# applied_ttl: the TTL in effect, or null when it can't be read, so the
# JSON stays valid either way.
applied_ttl() {
    _val=$("$TTL_SH" applied 2>/dev/null)
    echo "$_val" | grep -qE '^[0-9]+$' && echo "$_val" || echo "null"
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
    printf '{"success":true,"ttl":%s,"applied":%s}\n' "$(current_ttl)" "$(applied_ttl)"
    ;;

  set_ttl)
    if ! echo "$VALUE" | grep -qE '^[0-9]+$' || [ "$VALUE" -gt 255 ]; then
        echo '{"success":false,"error":"TTL must be 0 (disabled) or 1-255"}'
        exit 1
    fi
    # Persisted as the number ttl.sh applies, without leading zeros.
    VALUE=$(echo "$VALUE" | sed 's/^0*//')
    VALUE=${VALUE:-0}

    if ! "$TTL_SH" apply "$VALUE" 2>/dev/null; then
        printf '{"success":false,"error":"TTL %s did not take effect (in effect: %s); the saved value is unchanged"}\n' \
            "$(json_esc "$VALUE")" "$(applied_ttl)"
        exit 1
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
