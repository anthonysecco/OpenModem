#!/bin/sh
# mtu_test.sh — on-demand path-MTU probe for the WAN page's TTL Spoofing
# card ("Path MTU" section). Not polled — button-triggered, like
# carrier_scan.sh/internet_info.sh.
#
# Reports two distinct numbers:
#   configured_mtu    — what the WAN interface itself is set to
#                        (/sys/class/net/<iface>/mtu). Cheap, always
#                        available, but only describes what the modem's
#                        network stack believes, not what actually
#                        round-trips over the carrier network.
#   effective_path_mtu — the largest DF-bit ICMP echo that actually got a
#                        reply from NET_ICMP_TARGET (config/openmodem.conf,
#                        same host net_poller.sh already pings — see
#                        DEPENDENCIES.md), found via binary search using
#                        `ping -M do -s <size>`. Confirmed live
#                        (2026-08-20) against a real RM520N-GL: iputils
#                        ping (/bin/ping -> /bin/ping.iputils, not the
#                        BusyBox applet — that one isn't compiled in on
#                        this firmware) supports -M do/-s, and a payload
#                        exceeding the interface's own MTU fails locally
#                        and immediately ("local error: message too long,
#                        mtu=N"), cleanly distinguishable in effect (exit
#                        nonzero, no reply) from a real network timeout
#                        for the purposes of this search — this script
#                        never probes above configured_mtu-28 in the
#                        first place, so that local-cap failure mode can't
#                        occur here; a failure within the search range
#                        means the probe genuinely didn't come back.
#
# A gap between the two numbers (or an inconclusive effective_path_mtu)
# means something upstream of the modem's own interface — carrier core
# tunneling, a filtering middlebox — is dropping large DF-bit packets
# rather than reporting a smaller MTU. That's a real-world failure mode
# a configured-MTU-only reading can't see.
#
# GET (no params).

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"

json_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }

TARGET=$(grep '^NET_ICMP_TARGET=' "$CONF_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r\n')
[ -z "$TARGET" ] && TARGET="1.1.1.1"

IFACE=$(ip route show default 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)
if [ -z "$IFACE" ]; then
    echo '{"success":false,"error":"No default route — WAN is not up"}'
    exit 0
fi

CONFIGURED_MTU=$(cat "/sys/class/net/${IFACE}/mtu" 2>/dev/null)
if ! echo "$CONFIGURED_MTU" | grep -qE '^[0-9]+$'; then
    printf '{"success":false,"error":"Could not read MTU for interface %s"}\n' "$(json_esc "$IFACE")"
    exit 0
fi

# ICMP + IPv4 header overhead is 28 bytes; -s takes the ICMP payload size,
# so the largest payload that fits the interface's own MTU is MTU-28.
CEIL=$((CONFIGURED_MTU - 28))
FLOOR=1200

probe() {
    ping -M do -c 1 -W 2 -s "$1" "$TARGET" >/dev/null 2>&1
}

EFFECTIVE="null"
NOTE=""

if [ "$CEIL" -lt "$FLOOR" ]; then
    NOTE="Configured MTU too small to test (below ${FLOOR}-byte floor)."
elif ! probe "$FLOOR"; then
    NOTE="Even a ${FLOOR}-byte probe got no reply — ICMP may be filtered on this path, or the connection is down."
else
    LO=$FLOOR
    HI=$CEIL
    BEST=$FLOOR
    while [ "$LO" -le "$HI" ]; do
        MID=$(( (LO + HI) / 2 ))
        if probe "$MID"; then
            BEST=$MID
            LO=$((MID + 1))
        else
            HI=$((MID - 1))
        fi
    done
    EFFECTIVE=$((BEST + 28))
    if [ "$EFFECTIVE" -lt "$CONFIGURED_MTU" ]; then
        NOTE="Verified path MTU is smaller than the configured interface MTU — large packets may be silently dropped somewhere upstream."
    fi
fi

printf '{"success":true,"iface":"%s","target":"%s","configured_mtu":%s,"effective_path_mtu":%s,"note":"%s"}\n' \
    "$(json_esc "$IFACE")" "$(json_esc "$TARGET")" "$CONFIGURED_MTU" "$EFFECTIVE" "$(json_esc "$NOTE")"
