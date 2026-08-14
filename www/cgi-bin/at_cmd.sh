#!/bin/sh
# at_cmd.sh — CGI wrapper for single AT commands, used by System's AT
# terminal and by Power's reboot/radio actions.
#
# GET /cgi-bin/at_cmd.sh?cmd=AT%2BQTEMP
# Returns: raw AT response text (plain text, not JSON)

echo "Content-Type: text/plain"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

AT_CMD_BIN="/usrdata/openmodem/bin/at_command.sh"

if [ ! -p /tmp/at_request ]; then
    echo "ERROR: AT broker not running"
    exit 1
fi

# -- Parse ?cmd= from query string --
RAW_CMD=""
if [ -n "$QUERY_STRING" ]; then
    RAW_CMD=$(echo "$QUERY_STRING" | sed -n 's/.*cmd=\([^&]*\).*/\1/p')
fi

if [ -z "$RAW_CMD" ]; then
    echo "ERROR: No command specified"
    exit 1
fi

# -- URL-decode: %XX hex sequences and + as space --
CMD=$(printf '%b' "$(echo "$RAW_CMD" | sed 's/+/ /g; s/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')")

# -- Block shell-escape attempts. The UI only ever sends fixed commands
# (terminal input, or the confirm-gated power actions), but this is the
# last line of defense before the command reaches the broker. --
case "$CMD" in
    *";"*|*"&"*|*">"*|*"<"*|*'`'*|*'$('*)
        echo "ERROR: Command contains disallowed characters"
        exit 1 ;;
esac

# -- Enforce AT prefix (case-insensitive) --
UPPER_CMD=$(echo "$CMD" | tr '[:lower:]' '[:upper:]')
case "$UPPER_CMD" in
    AT*) : ;;
    *)
        echo "ERROR: Only AT commands are accepted"
        exit 1 ;;
esac

# -- Per-command timeout: most commands are fast; a few need headroom --
TIMEOUT=10
case "$UPPER_CMD" in
    *CFUN=1*)  TIMEOUT=15 ;;   # reboot — give the broker time before the modem dies
    *CFUN=0*)  TIMEOUT=12 ;;
    *QPOWD*)   TIMEOUT=12 ;;   # power off
    *COPS=?*)  TIMEOUT=130 ;;  # carrier scan (handled by carrier_scan.sh normally,
                               # but allow it here too if sent from the terminal)
esac

RESULT=$("$AT_CMD_BIN" "$CMD" "$TIMEOUT")

# Strip a bare echo of the sent command if the modem echoed it back
RESULT=$(echo "$RESULT" | grep -v "^${UPPER_CMD}$" | tr -d '\r')

echo "$RESULT"
