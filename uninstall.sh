#!/bin/sh
# OpenModem Uninstaller
# Stops and removes OpenModem: systemd services, the firewall/TTL rules
# installer.sh/bin/apply_iptables.sh applied, runtime state under /tmp,
# and everything under /usrdata/openmodem (including openmodem.conf).
# Leaves the device the way it was before OpenModem was ever installed.
#
# Does NOT touch QuecControl/SimpleAdmin/SimpleFirewall — installer.sh
# already removes those on install, so if OpenModem is here, they're
# already gone — or Tailscale, which is unrelated and never touched by
# anything OpenModem owns.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/main/uninstall.sh | sh
#
# No confirmation prompt, matching installer.sh: a script read from a
# pipe can't reliably prompt for input (stdin is the script itself), so
# if you want a chance to back out, don't run this — there's nothing to
# confirm inline once it starts. Every step below is idempotent
# (already-removed services/rules/files are silently skipped, not
# treated as an error), so it's also safe to re-run.

INSTALL_DIR="/usrdata/openmodem"
CONF_FILE="$INSTALL_DIR/config/openmodem.conf"

echo "==============================="
echo "  OpenModem Uninstaller"
echo "==============================="
echo ""

# Read TTL_VALUE before the config file is removed (step 4), so the
# exact mangle-table rule apply_iptables.sh inserted (if TTL spoofing
# was ever turned on) can be matched and deleted below — iptables -D
# needs the same rule spec used to insert it, not just a rule number.
TTL_VALUE=0
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

# --- Stop and remove services ---
echo "[1/4] Stopping and removing services..."

# /lib/systemd/system lives on the root filesystem, read-only by
# default (confirmed UBIFS on real hardware, see CLAUDE.md) — remount
# rw before touching it, same as installer.sh's step 3.
echo "  Remounting / as read-write..."
mount -o remount,rw /

for svc in openmodem-httpd openmodem-poller openmodem-broker openmodem-iptables openmodem-netpoller; do
    systemctl stop "$svc" 2>/dev/null
    systemctl disable "$svc" 2>/dev/null
done

rm -f /etc/systemd/system/openmodem-*.service
rm -f /lib/systemd/system/openmodem-*.service
rm -f /lib/systemd/system/multi-user.target.wants/openmodem-*.service
rm -f /etc/systemd/system/multi-user.target.wants/openmodem-*.service

systemctl daemon-reload 2>/dev/null

# Belt-and-suspenders in case a service unit was already missing or
# disable/stop didn't fully land — same processes installer.sh's own
# cleanup step kills before a fresh install.
pkill -f "at_broker.sh"  2>/dev/null
pkill -f "at_poller.sh"  2>/dev/null
pkill -f "net_poller.sh" 2>/dev/null
pkill -f "httpd.*8080"   2>/dev/null

echo "  Remounting / as read-only..."
mount -o remount,ro /

echo "  Done."

# --- Remove firewall/TTL rules ---
# Exact reverse of bin/apply_iptables.sh: same rule specs, -D instead
# of -A/-I, each -C-checked first so re-running this (or running it
# after a rule was already removed some other way) is a silent no-op
# rather than a noisy "rule does not exist" error.
echo "[2/4] Removing firewall/TTL rules..."

for _if in bridge0 eth0 tailscale0; do
    iptables -C INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT 2>/dev/null && \
        iptables -D INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT
done
iptables -C INPUT -p tcp --dport 8080 -j DROP 2>/dev/null && \
    iptables -D INPUT -p tcp --dport 8080 -j DROP

if [ "$TTL_VALUE" -gt 0 ] 2>/dev/null; then
    iptables -t mangle -C POSTROUTING -o rmnet+ -j TTL --ttl-set "$TTL_VALUE" 2>/dev/null && \
        iptables -t mangle -D POSTROUTING -o rmnet+ -j TTL --ttl-set "$TTL_VALUE"
    ip6tables -t mangle -C POSTROUTING -o rmnet+ -j HL --hl-set "$TTL_VALUE" 2>/dev/null && \
        ip6tables -t mangle -D POSTROUTING -o rmnet+ -j HL --hl-set "$TTL_VALUE"
fi

echo "  Done."

# --- Clean up runtime state ---
echo "[3/4] Cleaning up runtime state..."

rm -f  /tmp/at_request
rm -rf /tmp/at_responses
rm -f  /tmp/at_broker.log*
rm -rf /tmp/openmodem

echo "  Done."

# --- Remove installed files ---
# Deliberately last — the TTL rule removal above already read whatever
# it needed from openmodem.conf before this deletes it.
echo "[4/4] Removing installed files..."
rm -rf "$INSTALL_DIR"
echo "  Done."

# --- Verify ---
echo ""
echo "==============================="
echo "  Uninstall Complete"
echo "==============================="
echo ""

_leftover=0

for svc in openmodem-broker openmodem-poller openmodem-httpd openmodem-iptables openmodem-netpoller; do
    if systemctl is-enabled --quiet "$svc" 2>/dev/null || systemctl is-active --quiet "$svc" 2>/dev/null; then
        _leftover=1
    fi
done

if pgrep -f "at_broker.sh" > /dev/null 2>&1 || pgrep -f "at_poller.sh" > /dev/null 2>&1 || pgrep -f "net_poller.sh" > /dev/null 2>&1; then
    _leftover=1
fi

if [ -d "$INSTALL_DIR" ]; then
    _leftover=1
fi

if [ "$_leftover" = "0" ]; then
    echo "  OK OpenModem fully removed."
else
    echo "  WARNING: Some OpenModem services or files may still be present — check manually."
fi
echo ""
