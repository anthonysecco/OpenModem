#!/bin/sh
# lan_action.sh — LAN configuration actions, adapted from QuecControl's
# lan_action.sh (same AT+QMAP mechanism) but as GET+query-string actions
# rather than a POST+JSON body, matching band_lock.sh's convention in
# this codebase.
#
# GET ?action=set_lanip&router_ip=X&dhcp_start=Y&dhcp_end=Z
#     AT+QMAP="LANIP",<start>,<end>,<gateway>,1 — DHCP pool + gateway IP,
#     applied immediately (drops the current LAN session).
#
# GET ?action=set_dns&dns_mode=local|carrier
#     AT+QMAP="DHCPV4DNS","enable"|"disable" — local=enable (modem proxies
#     DNS to LAN clients), carrier=disable (clients get carrier DNS from
#     the PDP context directly). Takes effect after reboot.
#
# GET ?action=set_mode&mode=nat|passthrough[&mac=AA:BB:CC:DD:EE:FF]
#     AT+QMAP="MPDN_rule" NAT-vs-IP-Passthrough toggle. Clears rule 0
#     first (drops the active WAN connection), waits up to 5s for OK,
#     then reapplies with the new mode — same sequence QuecControl uses.
#     mac defaults to FF:FF:FF:FF:FF:FF (first DHCP client) if omitted.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"

if [ ! -p /tmp/at_request ]; then
    echo '{"success":false,"error":"AT broker not running"}'
    exit 1
fi

url_decode() {
    printf '%s' "$1" | sed 's/%3A/:/g; s/%3a/:/g; s/%2C/,/g; s/%2c/,/g'
}

ACTION=""
ROUTER_IP=""
DHCP_START=""
DHCP_END=""
DNS_MODE=""
MODE=""
MAC=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING"     | grep -o 'action=[^&]*'      | cut -d= -f2 | head -1)
    ROUTER_IP=$(echo "$QUERY_STRING"  | grep -o 'router_ip=[^&]*'   | cut -d= -f2 | head -1)
    DHCP_START=$(echo "$QUERY_STRING" | grep -o 'dhcp_start=[^&]*'  | cut -d= -f2 | head -1)
    DHCP_END=$(echo "$QUERY_STRING"   | grep -o 'dhcp_end=[^&]*'    | cut -d= -f2 | head -1)
    DNS_MODE=$(echo "$QUERY_STRING"   | grep -o 'dns_mode=[^&]*'    | cut -d= -f2 | head -1)
    MODE=$(echo "$QUERY_STRING"       | grep -o 'mode=[^&]*'        | cut -d= -f2 | head -1)
    MAC_RAW=$(echo "$QUERY_STRING"    | grep -o 'mac=[^&]*'         | cut -d= -f2 | head -1)
    MAC=$(url_decode "$MAC_RAW")
fi
[ -z "$ACTION" ] && ACTION="invalid"

run_at() { "$AT_CMD" "$1" "${2:-8}" 2>/dev/null | tr -d '\r'; }
at_ok()  { echo "$1" | grep -q '^OK'; }

json_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

is_ipv4() {
    echo "$1" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
    _oldifs="$IFS"
    IFS='.'
    for _oct in $1; do
        IFS="$_oldifs"
        [ "$_oct" -le 255 ] 2>/dev/null || return 1
    done
    IFS="$_oldifs"
    return 0
}

is_mac() {
    echo "$1" | grep -qiE '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'
}

case "$ACTION" in

  set_lanip)
    if ! is_ipv4 "$ROUTER_IP" || ! is_ipv4 "$DHCP_START" || ! is_ipv4 "$DHCP_END"; then
        echo '{"success":false,"error":"Invalid IP address"}'
        exit 1
    fi
    RESP=$(run_at "AT+QMAP=\"LANIP\",${DHCP_START},${DHCP_END},${ROUTER_IP},1")
    if at_ok "$RESP"; then
        printf '{"success":true,"message":"LAN IP settings applied. Reconnect at %s."}\n' "$(json_esc "$ROUTER_IP")"
    else
        printf '{"success":false,"error":"AT command failed: %s"}\n' "$(json_esc "$RESP")"
        exit 1
    fi
    ;;

  set_dns)
    case "$DNS_MODE" in
        local)   AT_VAL="enable" ;;
        carrier) AT_VAL="disable" ;;
        *)
            echo '{"success":false,"error":"Invalid dns_mode"}'
            exit 1 ;;
    esac
    RESP=$(run_at "AT+QMAP=\"DHCPV4DNS\",\"${AT_VAL}\"")
    if at_ok "$RESP"; then
        echo '{"success":true,"message":"DNS mode set. Reboot required to take effect."}'
    else
        printf '{"success":false,"error":"AT command failed: %s"}\n' "$(json_esc "$RESP")"
        exit 1
    fi
    ;;

  set_mode)
    case "$MODE" in
        nat)         IPPT=0 ;;
        passthrough) IPPT=1 ;;
        *)
            echo '{"success":false,"error":"Invalid mode"}'
            exit 1 ;;
    esac

    if [ "$IPPT" = "1" ]; then
        [ -z "$MAC" ] && MAC="FF:FF:FF:FF:FF:FF"
        if ! is_mac "$MAC"; then
            echo '{"success":false,"error":"Invalid MAC address"}'
            exit 1
        fi
    fi

    # Clearing rule 0 drops the active connection; wait up to 5s for OK
    # before reapplying, same sequence QuecControl uses.
    CLEAR_RESP=$(run_at 'AT+QMAP="MPDN_rule",0')
    if ! at_ok "$CLEAR_RESP"; then
        _elapsed=0
        _got_ok=0
        while [ "$_elapsed" -lt 5 ]; do
            sleep 1
            _elapsed=$((_elapsed + 1))
            if at_ok "$(run_at 'AT+QMAP="MPDN_rule"')"; then
                _got_ok=1
                break
            fi
        done
        if [ "$_got_ok" = "0" ]; then
            printf '{"success":false,"error":"Failed to clear MPDN rule: %s"}\n' "$(json_esc "$CLEAR_RESP")"
            exit 1
        fi
    fi
    sleep 1

    if [ "$IPPT" = "0" ]; then
        RESP=$(run_at 'AT+QMAP="MPDN_rule",0,1,0,0,1')
    else
        RESP=$(run_at "AT+QMAP=\"MPDN_rule\",0,1,0,1,1,\"${MAC}\"")
    fi

    if at_ok "$RESP"; then
        echo '{"success":true,"message":"Network mode updated."}'
    else
        printf '{"success":false,"error":"Rule apply failed: %s"}\n' "$(json_esc "$RESP")"
        exit 1
    fi
    ;;

  *)
    echo '{"success":false,"error":"Invalid action"}'
    exit 1
    ;;

esac
