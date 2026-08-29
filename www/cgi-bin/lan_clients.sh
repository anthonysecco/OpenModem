#!/bin/sh
# lan_clients.sh — list currently active DHCP leases as JSON, for the LAN
# page's Connected Clients card. Read directly from dnsmasq's own lease
# file rather than any AT command — LAN client info has never been
# AT-sourced on this hardware (see SCOPE.md). Path confirmed live via
# /var/run/data/dnsmasq.conf.bridge0's dhcp-leasefile= setting, not
# assumed from dnsmasq's compiled-in default.
#
# GET (no params) — {"clients":[{"hostname":...|null,"ip":...,
# "mac":...,"expires_at":<epoch>}, ...]}. hostname is null when dnsmasq
# has none for that lease (written as "*" in the lease file).

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

LEASE_FILE="/var/run/data/dnsmasq.leases"

if [ ! -f "$LEASE_FILE" ]; then
    echo '{"clients":[]}'
    exit 0
fi

awk '
function jstr(s) {
    if (s == "" || s == "*") return "null"
    gsub(/\\/, "\\\\", s)
    gsub(/"/, "\\\"", s)
    return "\"" s "\""
}
{
    if (NF < 4) next
    expires = $1 + 0; mac = $2; ip = $3; host = $4
    if (out != "") out = out ","
    out = out "{\"hostname\":" jstr(host) ",\"ip\":" jstr(ip) ",\"mac\":" jstr(mac) ",\"expires_at\":" expires "}"
}
END { print "{\"clients\":[" out "]}" }
' "$LEASE_FILE"
