#!/bin/sh
# update.sh — CGI endpoint for the System page's "Update" action.
#
# GET /cgi-bin/update.sh?action=start&confirm=1
#   Kicks off installer.sh (re-downloaded fresh from GitHub) in the
#   background and returns immediately. The installer stops/restarts
#   every OpenModem service, including this httpd, so the page will lose
#   its connection for a bit — the frontend must warn about this before
#   calling with confirm=1 (see www/system.html).
#
# GET /cgi-bin/update.sh?action=status
#   Reports whether an update is currently running and the tail of its
#   log, so the frontend can poll after the httpd comes back up.

# Deliberately NOT under /tmp/openmodem — installer.sh rm -rf's that
# directory as part of its own cleanup step, which would delete the lock
# and log out from under this still-running update.
LOCK_FILE="/tmp/openmodem_update.lock"
LOG_FILE="/tmp/openmodem_update.log"
INSTALLER_URL="https://raw.githubusercontent.com/anthonysecco/OpenModem/main/installer.sh"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

ACTION=""
CONFIRM=""
if [ -n "$QUERY_STRING" ]; then
    ACTION=$(echo "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')
    CONFIRM=$(echo "$QUERY_STRING" | sed -n 's/.*confirm=\([^&]*\).*/\1/p')
fi
[ -z "$ACTION" ] && ACTION="start"

json_escape() {
    # Minimal escaping: backslash and double-quote only, good enough for
    # our own log output.
    sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ "$ACTION" = "status" ]; then
    if [ -f "$LOCK_FILE" ]; then
        RUNNING="true"
    else
        RUNNING="false"
    fi
    TAIL=""
    [ -f "$LOG_FILE" ] && TAIL=$(tail -n 40 "$LOG_FILE" | json_escape)
    printf '{"running":%s,"log":"%s"}\n' "$RUNNING" "$TAIL"
    exit 0
fi

if [ "$ACTION" != "start" ]; then
    printf '{"error":"unknown_action"}\n'
    exit 0
fi

if [ "$CONFIRM" != "1" ]; then
    printf '{"error":"confirmation_required","message":"Pass confirm=1 after the user has explicitly confirmed the update."}\n'
    exit 0
fi

if [ -f "$LOCK_FILE" ]; then
    printf '{"error":"already_running"}\n'
    exit 0
fi

touch "$LOCK_FILE"

# Launched via systemd-run rather than a plain background `&` job: this
# script runs as a CGI child of openmodem-httpd.service, so a bare `&`
# job stays in that service's cgroup. installer.sh's own cleanup step
# runs `systemctl stop openmodem-httpd` (it's one of the services it
# removes/reinstalls) — with the default KillMode=control-group, that
# kills every process in the cgroup, including the installer itself,
# mid-run. Confirmed live: the installer died right after "Remounting /
# as read-write", having stopped openmodem-poller/-broker/-httpd but
# never reaching -iptables/-netpoller in the same cleanup loop, with no
# process left alive anywhere — self-inflicted, not a hang or a slow
# install. systemd-run gives the installer its own independent
# transient unit/cgroup (confirmed live: stopping openmodem-httpd does
# not touch it), so it survives stopping/restarting the very service
# that's running this script. --collect garbage-collects the transient
# unit once it exits so repeated updates don't accumulate dead units.
systemd-run --unit=openmodem-update --collect \
    --description="OpenModem Installer/Update" \
    /bin/sh -c '
        curl -fsSL "'"$INSTALLER_URL"'" | sh > "'"$LOG_FILE"'" 2>&1
        rm -f "'"$LOCK_FILE"'"
    ' > /dev/null 2>&1

printf '{"status":"started","log":"%s"}\n' "$LOG_FILE"
