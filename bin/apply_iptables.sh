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
# Every rule below is applied idempotently (checked with -C before -A/-I)
# since this runs on every boot and installer.sh also calls it directly
# on every install/update — without the check, repeated runs would stack
# duplicate rules instead of no-ops.

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
TTL_VALUE=0
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

# -- Web UI port (8080): allow from LAN-facing interfaces, drop elsewhere --
# Same accept-then-catch-all-drop shape SimpleFirewall used (proven on
# this hardware), but scoped to only the port OpenModem actually owns —
# not the other three ports (80/8088/443) SimpleFirewall also blocked,
# which belonged to other tools this project doesn't run.
for _if in bridge0 eth0 tailscale0; do
    iptables -C INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT 2>/dev/null || \
        iptables -A INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT
done
iptables -C INPUT -p tcp --dport 8080 -j DROP 2>/dev/null || \
    iptables -A INPUT -p tcp --dport 8080 -j DROP

# -- TTL / hop-limit override, if configured (0 = disabled) --
# Matches wan_action.sh's set_ttl exactly, so a value persisted by a
# previous session is re-applied identically after a reboot.
if [ "$TTL_VALUE" -gt 0 ] 2>/dev/null; then
    iptables -t mangle -C POSTROUTING -o rmnet+ -j TTL --ttl-set "$TTL_VALUE" 2>/dev/null || \
        iptables -t mangle -I POSTROUTING -o rmnet+ -j TTL --ttl-set "$TTL_VALUE"
    ip6tables -t mangle -C POSTROUTING -o rmnet+ -j HL --hl-set "$TTL_VALUE" 2>/dev/null || \
        ip6tables -t mangle -I POSTROUTING -o rmnet+ -j HL --hl-set "$TTL_VALUE"
fi
