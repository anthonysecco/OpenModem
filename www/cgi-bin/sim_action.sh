#!/bin/sh
# sim_action.sh — switch the active SIM slot.
#
# GET ?action=set_slot&slot=1|2
#     AT+QUIMSLOT=<slot>. Confirmed disruptive on real hardware: it
#     triggers a full USB re-enumeration on the AT/diag interface, not
#     just a SIM reinit — adb briefly lost the device entirely during
#     testing. openmodem-broker/poller/httpd self-recovered within ~5s
#     without any manual intervention, but expect a real, if brief,
#     interruption — the AT command itself returns OK almost instantly
#     (the disruption happens shortly after, as the modem reinitializes
#     in the background), so this script's own response doesn't block
#     on that recovery. See SCOPE.md.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD="/usrdata/openmodem/bin/at_command.sh"

if [ ! -p /tmp/at_request ]; then
    echo '{"success":false,"error":"AT broker not running"}'
    exit 1
fi

ACTION=""
SLOT=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | grep -o 'action=[^&]*' | cut -d= -f2 | head -1)
    SLOT=$(echo "$QUERY_STRING"   | grep -o 'slot=[^&]*'   | cut -d= -f2 | head -1)
fi
[ -z "$ACTION" ] && ACTION="invalid"

json_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

case "$ACTION" in

  set_slot)
    case "$SLOT" in
        1|2) : ;;
        *)
            echo '{"success":false,"error":"slot must be 1 or 2"}'
            exit 1 ;;
    esac

    RESP=$("$AT_CMD" "AT+QUIMSLOT=$SLOT" 15 2>/dev/null | tr -d '\r')
    if echo "$RESP" | grep -q '^OK'; then
        printf '{"success":true,"message":"Switched to SIM%s. The connection may briefly drop while it reinitializes."}\n' "$(json_esc "$SLOT")"
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
