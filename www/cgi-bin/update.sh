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

# "Is an update running" is answered by asking systemd about the
# openmodem-update unit directly (systemctl is-active), not a lock
# file — a lock file has no recovery path if the update dies before it
# gets a chance to clean up after itself (confirmed live: a crashed run
# left a stale lock that blocked every future update until removed by
# hand). systemd-run's --collect below already unloads the transient
# unit as soon as it goes inactive-or-failed, so `is-active` naturally
# reports "not running" again the instant a run ends, however it ended.
#
# Deliberately NOT under /tmp/openmodem — installer.sh rm -rf's that
# directory as part of its own cleanup step, which would delete the log
# out from under this still-running update.
LOG_FILE="/tmp/openmodem_update.log"
INSTALLER_URL="https://raw.githubusercontent.com/anthonysecco/OpenModem/main/installer.sh"
UPDATE_UNIT="openmodem-update"

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
    if systemctl is-active --quiet "$UPDATE_UNIT"; then
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

if systemctl is-active --quiet "$UPDATE_UNIT"; then
    printf '{"error":"already_running"}\n'
    exit 0
fi

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
# unit once it exits so repeated updates don't accumulate dead units —
# and so `is-active` above naturally goes back to "false" on its own,
# whether the run finished, failed, or never managed to start.
if systemd-run --unit="$UPDATE_UNIT" --collect \
    --description="OpenModem Installer/Update" \
    /bin/sh -c '
        curl -fsSL "'"$INSTALLER_URL"'" | sh > "'"$LOG_FILE"'" 2>&1
    ' > /dev/null 2>&1
then
    printf '{"status":"started","log":"%s"}\n' "$LOG_FILE"
else
    printf '{"error":"failed_to_start","message":"systemd-run could not launch the update — check that systemd-run is available."}\n'
fi
