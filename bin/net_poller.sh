#!/bin/sh
# net_poller.sh — independent connectivity poller: ICMP ping rolling
# average + adaptive-interval HTTP 204 check ("Connectivity Check").
#
# Deliberately its own daemon, not folded into at_poller.sh: at_poller's
# cadence and failure domain are the AT broker/modem itself, while this
# is testing the actual WAN path end to end. Neither should be able to
# stall the other — an AT broker hiccup shouldn't delay "is the internet
# reachable", and a slow/backed-off WAN check shouldn't delay AT state.
#
# Three independent loops (icmp_loop, check204_loop, geo_loop) are
# forked as background subshells of this same process and joined with
# `wait`, each free-running on its own cadence. Only icmp_loop writes
# the combined state file the front end actually polls (STATE_FILE,
# atomic write-to-.tmp-then-mv, same pattern as at_poller.sh's
# STATE_FILE) — check204_loop and geo_loop instead each write their own
# tiny scratch file (CHECK204_FILE/GEO_FILE, bare tokens, not JSON) that
# icmp_loop reads and merges in on every cycle. That keeps STATE_FILE
# single-writer with no cross-loop write race, while still picking up a
# status change within one ICMP cycle (<= NET_ICMP_INTERVAL seconds) of
# it happening.

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
LOG_LEVEL=1
NET_ICMP_TARGET=1.1.1.1
NET_ICMP_INTERVAL=5
NET_ICMP_WINDOW=6
NET_CHECK204_URL=http://connectivitycheck.gstatic.com/generate_204
NET_CHECK204_HEALTHY_INTERVAL=60
NET_CHECK204_RETRY_INTERVAL=10
NET_CHECK204_RECOVER_SUCCESSES=2
NET_GEO_TRACE_URL=https://1.1.1.1/cdn-cgi/trace
NET_GEO_IPINFO_URL=https://ipinfo.io/json
NET_GEO_INTERVAL=300
HISTORY_WINDOW_SAMPLES=60
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

RUN_DIR="/tmp/openmodem"
LOG_FILE="$RUN_DIR/net_poller.log"
STATE_FILE="$RUN_DIR/net_state.json"
CHECK204_FILE="$RUN_DIR/net_check204_status"
GEO_FILE="$RUN_DIR/net_geo_status"
HISTORY_FILE="$RUN_DIR/history_net.json"
HISTORY_SCRATCH="$RUN_DIR/history_net_scratch"
LOG_MAX_BYTES=262144
LOG_SLOTS=2

mkdir -p "$RUN_DIR"

# -- Logging (same shape as at_poller.sh) ----------------------------------
log_op()  { [ "$LOG_LEVEL" -ge 1 ] 2>/dev/null && echo "$(date '+%Y-%m-%d %H:%M:%S') [net_poller] $*" >> "$LOG_FILE"; }
log_dbg() { [ "$LOG_LEVEL" -ge 2 ] 2>/dev/null && echo "$(date '+%Y-%m-%d %H:%M:%S') [net_poller] $*" >> "$LOG_FILE"; }

rotate_log() {
    [ -f "$LOG_FILE" ] || return
    _size=$(wc -c < "$LOG_FILE" 2>/dev/null) || return
    if [ "$_size" -gt "$LOG_MAX_BYTES" ]; then
        _slot=$(( LOG_SLOTS - 1 ))
        while [ "$_slot" -gt 1 ]; do
            _prev=$(( _slot - 1 ))
            [ -f "${LOG_FILE}.${_prev}" ] && mv "${LOG_FILE}.${_prev}" "${LOG_FILE}.${_slot}"
            _slot=$(( _slot - 1 ))
        done
        mv "$LOG_FILE" "${LOG_FILE}.1"
    fi
}

# -- JSON helpers -----------------------------------------------------------
json_num_or_null() {
    printf '%s' "$1" | grep -qE '^-?[0-9]+(\.[0-9]+)?$' && printf '%s' "$1" || printf 'null'
}

# Escapes backslash/quote and strips newlines — matters now that
# json_str_or_null also carries externally-sourced text (geo_loop's
# city/region names from ipinfo.io), not just internal config strings
# like NET_ICMP_TARGET whose content this project fully controls.
json_str_or_null() {
    if [ -z "$1" ]; then
        printf 'null'
    else
        printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r')"
    fi
}

# Bare status token ("online"/"offline"/anything else incl. empty) -> JSON.
json_status() {
    case "$1" in
        online)  printf '"online"' ;;
        offline) printf '"offline"' ;;
        *)       printf 'null' ;;
    esac
}

# -- ICMP rolling-window loop -----------------------------------------------
# One ping per NET_ICMP_INTERVAL against NET_ICMP_TARGET (a literal IP,
# so no DNS involved). $NET_ICMP_TARGET single-quoted list of interfaces
# isn't a concern — this rides whatever the device's default route is,
# same as every other outbound request this project makes.
ping_once() {
    _out=$(ping -c 1 -W 2 "$NET_ICMP_TARGET" 2>/dev/null)
    if [ $? -eq 0 ]; then
        _rtt=$(printf '%s' "$_out" | sed -n 's/.*time=\([0-9.]*\).*/\1/p' | head -1)
        [ -z "$_rtt" ] && _rtt="0"
        printf 'ok:%s' "$_rtt"
    else
        printf 'fail'
    fi
}

# $1 = window (space-separated "ok:<rtt>"/"fail" tokens). Prints three
# bare lines: status ("online"/"offline"/""), avg RTT ms ("" if none,
# rounded to a whole number — sub-ms precision has no UI use here), and
# jitter ms ("" if fewer than 2 consecutive successes to diff). Online =
# at least one "ok" token anywhere in the current window (whatever size
# it's currently at, per spec); offline = every token in a non-empty
# window is "fail". Average is over successful samples only — a failed
# ping has no RTT to contribute, and folding it in as 0 or a penalty
# value would misrepresent latency on an otherwise-healthy link.
#
# Jitter is the mean absolute difference between each pair of
# consecutive successful samples in the window (the standard "average
# variation between consecutive readings" definition) — a "fail" token
# breaks the chain rather than being treated as a 0 or skipped-over gap,
# since a diff spanning a dropped ping doesn't describe jitter between
# two actual measurements.
summarize_icmp_window() {
    _win="$1"
    if [ -z "$_win" ]; then
        echo ""; echo ""; echo ""
        return
    fi
    _ok_count=0
    _sum="0"
    _prev_rtt=""
    _prev_ok=0
    _jitter_sum="0"
    _jitter_count=0
    for _tok in $_win; do
        case "$_tok" in
            ok:*)
                _rtt="${_tok#ok:}"
                _ok_count=$(( _ok_count + 1 ))
                _sum=$(awk -v s="$_sum" -v r="$_rtt" 'BEGIN { printf "%.3f", s + r }')
                if [ "$_prev_ok" -eq 1 ]; then
                    _diff=$(awk -v a="$_rtt" -v b="$_prev_rtt" 'BEGIN { d = a - b; if (d < 0) d = -d; printf "%.3f", d }')
                    _jitter_sum=$(awk -v s="$_jitter_sum" -v d="$_diff" 'BEGIN { printf "%.3f", s + d }')
                    _jitter_count=$(( _jitter_count + 1 ))
                fi
                _prev_rtt="$_rtt"
                _prev_ok=1
                ;;
            *)
                _prev_ok=0
                _prev_rtt=""
                ;;
        esac
    done
    if [ "$_ok_count" -gt 0 ]; then
        echo "online"
        awk -v s="$_sum" -v n="$_ok_count" 'BEGIN { printf "%.0f\n", s / n }'
    else
        echo "offline"
        echo ""
    fi
    if [ "$_jitter_count" -gt 0 ]; then
        awk -v s="$_jitter_sum" -v n="$_jitter_count" 'BEGIN { printf "%.0f\n", s / n }'
    else
        echo ""
    fi
}

# -- 5-minute latency/jitter history ring buffer -----------------------
# Same shape as at_poller.sh's append_signal_history: HISTORY_SCRATCH is
# newline-delimited JSON objects (trim = `tail -n HISTORY_WINDOW_SAMPLES`,
# no array parsing needed), HISTORY_FILE (served by
# www/cgi-bin/history_net.sh) is rebuilt from the trimmed scratch and
# atomic-written every cycle. Lives in icmp_loop, not check204_loop,
# since icmp_loop already runs every NET_ICMP_INTERVAL and already has
# _icmp_avg/_icmp_jitter computed for this cycle — no separate timer needed.
append_net_history() {
    _hts="$1"
    _line="{\"t\":${_hts},\"latency_ms\":$(json_num_or_null "$_icmp_avg"),\"jitter_ms\":$(json_num_or_null "$_icmp_jitter")}"
    { [ -f "$HISTORY_SCRATCH" ] && cat "$HISTORY_SCRATCH"; printf '%s\n' "$_line"; } \
        | tail -n "$HISTORY_WINDOW_SAMPLES" > "${HISTORY_SCRATCH}.tmp" && mv "${HISTORY_SCRATCH}.tmp" "$HISTORY_SCRATCH"

    _arr=$(awk 'NR>1{printf ","} {printf "%s", $0} END{print ""}' "$HISTORY_SCRATCH")
    printf '[%s]\n' "$_arr" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
}

icmp_loop() {
    _window=""
    while :; do
        _sample=$(ping_once)
        _window="${_window:+$_window }$_sample"

        _count=0
        for _t in $_window; do _count=$(( _count + 1 )); done
        while [ "$_count" -gt "$NET_ICMP_WINDOW" ]; do
            _window=$(printf '%s' "$_window" | cut -d' ' -f2-)
            _count=$(( _count - 1 ))
        done

        _summary=$(summarize_icmp_window "$_window")
        _icmp_status=$(printf '%s\n' "$_summary" | sed -n '1p')
        _icmp_avg=$(printf '%s\n' "$_summary" | sed -n '2p')
        _icmp_jitter=$(printf '%s\n' "$_summary" | sed -n '3p')

        _check204_status=""
        [ -f "$CHECK204_FILE" ] && _check204_status=$(cat "$CHECK204_FILE" 2>/dev/null)

        _geo_colo=""
        _geo_location=""
        if [ -f "$GEO_FILE" ]; then
            _geo_colo=$(sed -n '1p' "$GEO_FILE")
            _geo_location=$(sed -n '2p' "$GEO_FILE")
        fi

        _cycle_t=$(date +%s)
        _json='{"_polled_at":'"$_cycle_t"',"icmp_target":'"$(json_str_or_null "$NET_ICMP_TARGET")"',"icmp_status":'"$(json_status "$_icmp_status")"',"icmp_avg_rtt_ms":'"$(json_num_or_null "$_icmp_avg")"',"icmp_jitter_ms":'"$(json_num_or_null "$_icmp_jitter")"',"check204_status":'"$(json_status "$_check204_status")"',"cf_pop":'"$(json_str_or_null "$_geo_colo")"',"geo_location":'"$(json_str_or_null "$_geo_location")"'}'
        printf '%s\n' "$_json" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
        append_net_history "$_cycle_t"

        log_dbg "icmp=$_icmp_status avg=${_icmp_avg}ms jitter=${_icmp_jitter}ms check204=$_check204_status cf_pop=${_geo_colo:-unknown} geo=${_geo_location:-unknown} window=[$_window]"
        rotate_log
        sleep "$NET_ICMP_INTERVAL"
    done
}

# -- HTTP 204 "Connectivity Check" loop with adaptive interval --------------
# Healthy baseline NET_CHECK204_HEALTHY_INTERVAL while succeeding. On the
# first miss, retry sooner (NET_CHECK204_RETRY_INTERVAL) rather than
# waiting a full interval, to quickly tell a one-off blip from a real
# outage — status doesn't flip to "offline" on this first miss alone. If
# that retry also fails (2nd consecutive failure), it's a sustained
# outage: status flips to "offline" and the interval backs off by
# doubling (10s -> 20s -> 40s -> capped at the healthy 60s), never
# hammering the link faster than the initial retry nor slower than the
# healthy baseline. Recovery requires NET_CHECK204_RECOVER_SUCCESSES
# consecutive successes (checked at the fast retry interval) before
# flipping back to "online" and resetting to the healthy baseline — this
# avoids flapping the indicator on a link that's marginally recovering.
#
# -4 (force IPv4): the same real, confirmed IPv6-routing issue on this
# carrier that installer.sh's download() works around for
# raw.githubusercontent.com (see that function's comment) could just as
# easily bite a different remote host's IPv6 path — applied here
# preemptively rather than waiting to rediscover the same failure mode
# against a second domain.
check204_once() {
    curl -4 -fsS -o /dev/null -m 5 "$NET_CHECK204_URL" 2>/dev/null
}

check204_loop() {
    _status=""
    _consec_fail=0
    _consec_recover=0
    _interval="$NET_CHECK204_HEALTHY_INTERVAL"

    while :; do
        if check204_once; then
            _consec_fail=0
            if [ "$_status" = "offline" ]; then
                _consec_recover=$(( _consec_recover + 1 ))
                if [ "$_consec_recover" -ge "$NET_CHECK204_RECOVER_SUCCESSES" ]; then
                    _status="online"
                    _interval="$NET_CHECK204_HEALTHY_INTERVAL"
                    _consec_recover=0
                else
                    _interval="$NET_CHECK204_RETRY_INTERVAL"
                fi
            else
                _status="online"
                _interval="$NET_CHECK204_HEALTHY_INTERVAL"
                _consec_recover=0
            fi
        else
            _consec_recover=0
            _consec_fail=$(( _consec_fail + 1 ))

            _i="$NET_CHECK204_RETRY_INTERVAL"
            _p=1
            while [ "$_p" -lt "$_consec_fail" ]; do
                _i=$(( _i * 2 ))
                _p=$(( _p + 1 ))
            done
            [ "$_i" -gt "$NET_CHECK204_HEALTHY_INTERVAL" ] && _i="$NET_CHECK204_HEALTHY_INTERVAL"
            _interval="$_i"

            # First miss alone stays unconfirmed (whatever _status already
            # was); only a 2nd consecutive failure declares the outage.
            [ "$_consec_fail" -ge 2 ] && _status="offline"
        fi

        printf '%s' "$_status" > "${CHECK204_FILE}.tmp" && mv "${CHECK204_FILE}.tmp" "$CHECK204_FILE"
        log_dbg "check204=${_status:-unknown} consec_fail=$_consec_fail next_interval=${_interval}s"
        sleep "$_interval"
    done
}

# -- Cloudflare PoP + IP geolocation loop -----------------------------------
# Both values change rarely (only when the device actually roams to a
# different tower/region or gets handed a new public IP) — polling them
# every NET_ICMP_INTERVAL like latency would be wasted requests against
# third-party services for no benefit, so this is its own much slower
# loop (NET_GEO_INTERVAL, default 5 min).
#
# Cloudflare's own trace endpoint (already used for the 204/latency
# comparisons earlier) returns plain "key=value" lines including
# colo=<3-letter airport code> for the Cloudflare datacenter/PoP the
# request landed on — confirmed live (2026-08-17): colo=SJC while
# physically nowhere near San Jose, i.e. this reflects network routing,
# not GPS position, which is exactly why it's shown as a distinct field
# from geolocation rather than folded into it.
#
# ipinfo.io/json is a free, unauthenticated IP-geolocation lookup
# (confirmed live: returns city/region for this device's public IP,
# well under its free-tier rate limit at one request per
# NET_GEO_INTERVAL) — city+region only, not the full response (org/
# postal/timezone/lat-long aren't surfaced anywhere in the UI, no
# reason to carry them through). Parsed with sed rather than a JSON
# library (none available in BusyBox ash, see CLAUDE.md's Conventions)
# — safe here because the field shape is simple and stable (a flat
# "key": "value" pair per line in ipinfo's own pretty-printed output,
# confirmed live), same pragmatic approach at_poller.sh already takes
# for AT command responses.
geo_loop() {
    while :; do
        _trace=$(curl -4 -fsS -m 5 "$NET_GEO_TRACE_URL" 2>/dev/null)
        _colo=$(printf '%s' "$_trace" | sed -n 's/^colo=\(.*\)$/\1/p' | tr -d '\r\n')

        _ipinfo=$(curl -4 -fsS -m 5 "$NET_GEO_IPINFO_URL" 2>/dev/null)
        _city=$(printf '%s' "$_ipinfo" | sed -n 's/.*"city" *: *"\([^"]*\)".*/\1/p')
        _region=$(printf '%s' "$_ipinfo" | sed -n 's/.*"region" *: *"\([^"]*\)".*/\1/p')
        _geo=""
        if [ -n "$_city" ] && [ -n "$_region" ]; then
            _geo="${_city}, ${_region}"
        elif [ -n "$_city" ]; then
            _geo="$_city"
        elif [ -n "$_region" ]; then
            _geo="$_region"
        fi

        {
            printf '%s\n' "$_colo"
            printf '%s\n' "$_geo"
        } > "${GEO_FILE}.tmp" && mv "${GEO_FILE}.tmp" "$GEO_FILE"

        log_dbg "geo colo=${_colo:-unknown} location=${_geo:-unknown}"
        sleep "$NET_GEO_INTERVAL"
    done
}

log_op "net_poller starting (icmp_target=$NET_ICMP_TARGET interval=${NET_ICMP_INTERVAL}s window=$NET_ICMP_WINDOW; check204_url=$NET_CHECK204_URL healthy=${NET_CHECK204_HEALTHY_INTERVAL}s retry=${NET_CHECK204_RETRY_INTERVAL}s recover=${NET_CHECK204_RECOVER_SUCCESSES}; geo_interval=${NET_GEO_INTERVAL}s)"

icmp_loop &
check204_loop &
geo_loop &
wait
