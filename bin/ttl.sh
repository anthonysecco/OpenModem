#!/bin/sh
# ttl.sh — the one place OpenModem's TTL/hop-limit override is applied.
#
#   ttl.sh apply N   Remove every TTL rule (and IPv6 HL rule) in the mangle
#                    table's POSTROUTING chain, then for N=1-255 add the
#                    override on rmnet+ and confirm it is the one in effect.
#                    Exits 0 only when what is in effect is N (or nothing,
#                    for N=0).
#   ttl.sh applied   Print the TTL actually in effect: the last TTL rule in
#                    POSTROUTING, or 0 when there is none.
#
# Both www/cgi-bin/wan_action.sh (the WAN page's Apply) and
# bin/apply_iptables.sh (boot) go through this, so the two can't drift.
#
# Why every rule rather than the one openmodem.conf remembers: the TTL
# target does not stop rule processing, so with two TTL rules in the chain
# the one lower down wins. Deleting only the remembered value left any
# other rule in place — an earlier value, a duplicate, a previous tool's —
# and it silently overrode every later setting. Confirmed live 2026-10-03:
# the WAN page said 88 while packets left the modem at 65. iamromulan's
# ttl_script.sh removes whatever is installed for the same reason. A TTL
# rule in POSTROUTING is only ever a spoofing rule; the Qualcomm baseband
# rules that share the chain (qcom_qos_*) are jumps, which this never
# touches.
#
# -w waits for the xtables lock instead of failing at once. Quectel's own
# network daemons edit iptables while the modem boots, and without it a
# collision made the insert fail with nothing to show for it.

IPT="iptables -w 5"
IP6T="ip6tables -w 5"

# rules CMD TARGET: the -S lines in mangle POSTROUTING that jump to TARGET.
rules() {
    $1 -t mangle -S POSTROUTING 2>/dev/null | grep -e "-j $2 "
}

# remove_all CMD TARGET: delete each of them. The listing is read in full
# before the first delete, so no delete waits on the listing's own lock.
remove_all() {
    _lines=$(rules "$1" "$2")
    [ -z "$_lines" ] && return 0
    echo "$_lines" | while read -r _append _spec; do
        # _spec is the rule exactly as -S printed it after "-A", e.g.
        # "POSTROUTING -o rmnet+ -j TTL --ttl-set 65" - no quoting in it,
        # so word splitting gives back the original arguments.
        $1 -t mangle -D $_spec
    done
}

applied() {
    _v=$(rules "$IPT" TTL | sed -n 's/.*--ttl-set \([0-9]*\).*/\1/p' | tail -1)
    echo "${_v:-0}"
}

apply() {
    _want=$1
    remove_all "$IPT" TTL
    remove_all "$IP6T" HL
    if [ "$_want" -gt 0 ]; then
        # Appended, so it is the last TTL rule in the chain and so the one
        # that wins.
        $IPT -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set "$_want" || return 1
        # IPv6 is best effort, as it always was: the carrier detection this
        # exists for reads IPv4, and the confirmation below is IPv4 only.
        $IP6T -t mangle -A POSTROUTING -o rmnet+ -j HL --hl-set "$_want" ||
            echo "ttl.sh: could not add the IPv6 hop-limit rule" >&2
    fi
    [ "$(applied)" = "$_want" ]
}

case "$1" in
  apply)
    case "$2" in
      ''|*[!0-9]*) echo "usage: ttl.sh apply 0-255" >&2; exit 2 ;;
    esac
    # Leading zeros dropped: "065" would otherwise reach iptables, which
    # can read it as octal, and never match what "applied" prints.
    _n=$(echo "$2" | sed 's/^0*//')
    _n=${_n:-0}
    [ "$_n" -gt 255 ] && { echo "usage: ttl.sh apply 0-255" >&2; exit 2; }
    apply "$_n"
    ;;
  applied)
    applied
    ;;
  *)
    echo "usage: ttl.sh apply N | applied" >&2
    exit 2
    ;;
esac
