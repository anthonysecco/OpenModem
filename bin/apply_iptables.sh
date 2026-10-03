#!/bin/sh
# apply_iptables.sh — applies OpenModem's own iptables/ip6tables state at
# boot: web UI port protection (always) and TTL/hop-limit spoofing (if
# configured). Runs once via openmodem-iptables.service (oneshot).
#
# Replaces SimpleFirewall entirely (both its ttl-override and
# simplefirewall.sh port-blocking) — see SCOPE.md for why: two
# independent managers of the same iptables rules silently fight (the
# TTL target doesn't stop rule processing, so whichever rule is later in
# the chain wins regardless of which tool applied it last), and nothing
# else on this device was protecting port 8080 (OpenModem's own web UI)
# independently of SimpleFirewall's catch-all rule — confirmed live: with
# SimpleFirewall's rule removed, the port would be reachable from the
# cellular WAN interface with no substitute in place.
#
# Every rule below is applied idempotently (checked with -C before -A/-I,
# and the TTL rule by removing every TTL rule first, see bin/ttl.sh)
# since this runs on every boot and installer.sh also calls it directly
# on every install/update — without that, repeated runs would stack
# duplicate rules instead of no-ops.
#
# -w waits for the xtables lock: at boot Quectel's own network daemons
# are editing iptables too, and without it a collision fails at once.

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
TTL_VALUE=0
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

# -- Web UI port (8080): allow from LAN-facing interfaces, drop elsewhere --
# Same accept-then-catch-all-drop shape SimpleFirewall used (proven on
# this hardware), but scoped to only the port OpenModem actually owns —
# not the other three ports (80/8088/443) SimpleFirewall also blocked,
# which belonged to other tools this project doesn't run.
for _if in bridge0 eth0 tailscale0; do
    iptables -w 5 -C INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT 2>/dev/null || \
        iptables -w 5 -A INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT
done
iptables -w 5 -C INPUT -p tcp --dport 8080 -j DROP 2>/dev/null || \
    iptables -w 5 -A INPUT -p tcp --dport 8080 -j DROP

# -- TTL / hop-limit override (0 = disabled) --
# Through bin/ttl.sh, the same path the WAN page's Apply takes, so a value
# persisted by a previous session is re-applied identically after a reboot.
#
# Retried until it is confirmed in effect, for up to a minute, and the unit
# fails if it never is. A saved value that silently did not apply after a
# reboot is what this used to do: confirmed live 2026-10-03, a modem saved
# at 88 sent everything with an unmodified TTL after restarting. The unit
# is also ordered after ql-netd.service (see installer.sh) for the same
# reason, as iamromulan's ttl-override.service is.
case "$TTL_VALUE" in
    ''|*[!0-9]*) TTL_VALUE=0 ;;
esac
_try=1
until /usrdata/openmodem/bin/ttl.sh apply "$TTL_VALUE"; do
    if [ "$_try" -ge 12 ]; then
        echo "apply_iptables: TTL $TTL_VALUE still not in effect after $_try tries (in effect: $(/usrdata/openmodem/bin/ttl.sh applied))" >&2
        exit 1
    fi
    _try=$(( _try + 1 ))
    sleep 5
done
