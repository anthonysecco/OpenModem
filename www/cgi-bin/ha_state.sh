#!/bin/sh
# ha_state.sh — merged state.sh + net_state.sh, for the Home Assistant
# (HACS) integration: one request instead of two.
#
# Nested under "modem" / "connectivity" rather than flattened — both
# source files independently write their own "_polled_at", so a flat
# merge would collide; nesting also keeps visible that the two pollers
# (at_poller.sh / net_poller.sh) run on different intervals.
#
# No polling of its own: this is a pure pass-through of whatever the
# two pollers last wrote, same as state.sh/net_state.sh — as fresh as
# those on every request, nothing cached or re-triggered here. The one
# exception is wan_rx_rate_bps/wan_tx_rate_bps below, computed here
# rather than left to the HA integration (app.js does the equivalent
# client-side today — see www/app.js:311-348 — this is the server-side
# version so the integration doesn't have to reimplement it).
#
# GET /cgi-bin/ha_state.sh

STATE_FILE="/tmp/openmodem/state_merged.json"
NET_STATE_FILE="/tmp/openmodem/net_state.json"
WAN_PREV_FILE="/tmp/openmodem/ha_wan_prev"

# -- Registration/access-tech code -> string, for HA's "enum" device
# class (which requires a fixed set of string options, not an arbitrary
# AT status code). Table is 3GPP TS 27.007's <stat>/<AcT> value list
# (shared by CEREG/C5GREG/CREG, and by COPS respectively) — only
# not_registered/home/searching/roaming (reg_*) and eutran (carrier_act,
# =7) have actually been observed live on this AT&T LTE connection; the
# rest are ported from spec, same "UNCONFIRMED" caveat at_poller.sh
# already applies to its own NR5G branches. Falls back to "code_N"
# rather than a guess for anything outside the table, so an unexpected
# value is still visible instead of silently disappearing.
reg_state_str() {
    case "$1" in
        0)  printf 'not_registered' ;;
        1)  printf 'home' ;;
        2)  printf 'searching' ;;
        3)  printf 'denied' ;;
        4)  printf 'unknown' ;;
        5)  printf 'roaming' ;;
        6)  printf 'sms_only_home' ;;
        7)  printf 'sms_only_roaming' ;;
        8)  printf 'emergency_only' ;;
        9)  printf 'csfb_not_preferred_home' ;;
        10) printf 'csfb_not_preferred_roaming' ;;
        *)  printf 'code_%s' "$1" ;;
    esac
}

act_str() {
    case "$1" in
        0)  printf 'gsm' ;;
        1)  printf 'gsm_compact' ;;
        2)  printf 'utran' ;;
        3)  printf 'gsm_egprs' ;;
        4)  printf 'utran_hsdpa' ;;
        5)  printf 'utran_hsupa' ;;
        6)  printf 'utran_hsdpa_hsupa' ;;
        7)  printf 'eutran' ;;
        8)  printf 'ec_gsm_iot' ;;
        9)  printf 'eutran_nbiot' ;;
        10) printf 'eutra_5gcn' ;;
        11) printf 'nr_5gcn' ;;
        12) printf 'ng_ran' ;;
        13) printf 'eutra_nr_dc' ;;
        *)  printf 'code_%s' "$1" ;;
    esac
}

# Extracts $1's raw numeric value out of MODEM, maps it through mapper
# function $2, and replaces the numeric JSON value with the mapped
# string in place. No-op (leaves the field untouched, incl. a genuine
# JSON null) if the field isn't present as a bare number — same
# extraction pattern as CUR_TX/CUR_RX below.
translate_enum_field() {
    _field="$1"
    _mapper="$2"
    _raw=$(printf '%s' "$MODEM" | sed -n "s/.*\"${_field}\": *\([0-9][0-9]*\).*/\1/p")
    [ -z "$_raw" ] && return
    _str=$("$_mapper" "$_raw")
    MODEM=$(printf '%s' "$MODEM" | sed "s/\"${_field}\": ${_raw}/\"${_field}\": \"${_str}\"/")
}

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

MODEM="null"
[ -f "$STATE_FILE" ] && MODEM=$(cat "$STATE_FILE")

CONNECTIVITY="null"
[ -f "$NET_STATE_FILE" ] && CONNECTIVITY=$(cat "$NET_STATE_FILE")

if [ "$MODEM" != "null" ]; then
    translate_enum_field "reg_lte" reg_state_str
    translate_enum_field "reg_nr" reg_state_str
    translate_enum_field "reg_creg" reg_state_str
    translate_enum_field "carrier_act" act_str
fi

# -- WAN throughput rate: bits/sec, computed from the delta in
# wan_data_tx/wan_data_rx (cumulative byte counters, AT+QGDCNT) between
# this request and the last one. Not tied to POLL_INTERVAL — uses wall-
# clock time between requests, so it stays correct at whatever cadence
# the HA coordinator actually polls at (a jump only appears once every
# POLL_INTERVAL since that's the counters' own refresh rate, same
# burstiness app.js's client-side version already has).
if [ "$MODEM" != "null" ]; then
    CUR_TX=$(printf '%s' "$MODEM" | sed -n 's/.*"wan_data_tx": *\([0-9][0-9]*\).*/\1/p')
    CUR_RX=$(printf '%s' "$MODEM" | sed -n 's/.*"wan_data_rx": *\([0-9][0-9]*\).*/\1/p')
    NOW=$(date +%s)

    RX_RATE="null"
    TX_RATE="null"

    if [ -n "$CUR_TX" ] && [ -n "$CUR_RX" ]; then
        if [ -f "$WAN_PREV_FILE" ]; then
            _prev=$(cat "$WAN_PREV_FILE" 2>/dev/null)
            _prev_t=$(printf '%s' "$_prev" | cut -d' ' -f1)
            _prev_tx=$(printf '%s' "$_prev" | cut -d' ' -f2)
            _prev_rx=$(printf '%s' "$_prev" | cut -d' ' -f3)

            if printf '%s' "$_prev_t"  | grep -qE '^[0-9]+$' && \
               printf '%s' "$_prev_tx" | grep -qE '^[0-9]+$' && \
               printf '%s' "$_prev_rx" | grep -qE '^[0-9]+$'; then
                _elapsed=$(( NOW - _prev_t ))
                # Negative deltas mean a counter reset (Reset Counter
                # action, or a reboot) — no rate for this tick, same as
                # app.js's equivalent guard.
                if [ "$_elapsed" -gt 0 ] && [ "$CUR_TX" -ge "$_prev_tx" ] && [ "$CUR_RX" -ge "$_prev_rx" ]; then
                    RX_RATE=$(awk -v a="$CUR_RX" -v b="$_prev_rx" -v s="$_elapsed" 'BEGIN { printf "%.0f", (a - b) * 8 / s }')
                    TX_RATE=$(awk -v a="$CUR_TX" -v b="$_prev_tx" -v s="$_elapsed" 'BEGIN { printf "%.0f", (a - b) * 8 / s }')
                fi
            fi
        fi

        mkdir -p /tmp/openmodem
        printf '%s %s %s\n' "$NOW" "$CUR_TX" "$CUR_RX" > "${WAN_PREV_FILE}.tmp" && mv "${WAN_PREV_FILE}.tmp" "$WAN_PREV_FILE"
    fi

    MODEM="${MODEM%\}}"
    MODEM="${MODEM},\"wan_rx_rate_bps\":${RX_RATE},\"wan_tx_rate_bps\":${TX_RATE}}"
fi

printf '{"modem":%s,"connectivity":%s}\n' "$MODEM" "$CONNECTIVITY"
