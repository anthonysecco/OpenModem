#!/bin/sh
# auth_action.sh — change the web UI's Basic Auth password (System page's
# Change Password card).
#
# GET ?action=set_password&password=NEWPASS
#   Hashes NEWPASS (busybox httpd -m — MD5-crypt, fresh random salt each
#   call), persists it to openmodem.conf's WEB_AUTH_HASH (single-quoted —
#   see bin/apply_httpd_auth.sh for why), clears WEB_AUTH_IS_DEFAULT,
#   regenerates httpd_auth.conf, then restarts openmodem-httpd.service
#   and openmodem-poller.service (the latter so state.sh's
#   web_auth_is_default flag reflects the change immediately rather than
#   waiting for the poller's next incidental restart).
#
#   No re-entry of the *current* password is required or checked: the
#   entire site (including this endpoint) already sits behind BusyBox
#   httpd's own Basic Auth gate, so a request only reaches this script
#   at all once the browser has already sent valid credentials for the
#   current password.
#
#   The restart is deliberately deferred a couple seconds inside its own
#   detached systemd-run unit, not fired immediately: this script itself
#   runs as a CGI child inside openmodem-httpd.service's cgroup, and
#   restarting that service kills its entire cgroup (KillMode=
#   control-group, same reasoning documented in update.sh) — including
#   this still-running script — before it can flush its own JSON
#   response to the browser if the restart happens too early. A short
#   sleep in the detached unit (which itself is NOT in that cgroup, so
#   it survives the kill) gives this script time to finish and exit
#   normally first.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
APPLY_SCRIPT="/usrdata/openmodem/bin/apply_httpd_auth.sh"

ACTION=""
PASSWORD=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')
    PASSWORD=$(echo "$QUERY_STRING" | sed -n 's/.*password=\([^&]*\).*/\1/p')
fi
# QUERY_STRING is URL-encoded (the frontend encodeURIComponent()s the
# password before building the query string) — busybox httpd -d decodes
# both %XX escapes and "+"-as-space the same way a query string expects,
# confirmed live (`busybox httpd -d 'a%20b+c%26d'` -> "a b c&d").
PASSWORD=$(busybox httpd -d "$PASSWORD" 2>/dev/null)

[ -z "$ACTION" ] && ACTION="invalid"

case "$ACTION" in

  set_password)
    case "$PASSWORD" in
        ????*) : ;;
        *)
            echo '{"success":false,"error":"Password must be at least 4 characters."}'
            exit 1
            ;;
    esac

    HASH=$(busybox httpd -m "$PASSWORD")
    if [ -z "$HASH" ]; then
        echo '{"success":false,"error":"Failed to hash password."}'
        exit 1
    fi

    mkdir -p "$(dirname "$CONF_FILE")"
    _tmp="${CONF_FILE}.tmp"
    if [ -f "$CONF_FILE" ]; then
        grep -vE '^WEB_AUTH_(HASH|IS_DEFAULT)=' "$CONF_FILE" > "$_tmp"
    else
        : > "$_tmp"
    fi
    {
        echo "WEB_AUTH_HASH='${HASH}'"
        echo "WEB_AUTH_IS_DEFAULT=0"
    } >> "$_tmp"
    mv "$_tmp" "$CONF_FILE"

    [ -x "$APPLY_SCRIPT" ] && "$APPLY_SCRIPT"

    systemd-run --unit=openmodem-auth-restart --collect \
        --description="OpenModem httpd/poller restart (password change)" \
        /bin/sh -c 'sleep 2; systemctl restart openmodem-httpd.service openmodem-poller.service' \
        > /dev/null 2>&1

    echo '{"success":true,"message":"Password changed. You will be asked to log in again in a few seconds."}'
    ;;

  *)
    echo '{"success":false,"error":"Invalid action"}'
    exit 1
    ;;
esac
