#!/bin/sh
# at_poller.sh — polls modem state through at_broker.sh (via at_command.sh)
# on a single interval and writes merged JSON for the front end to read.
#
# Single POLL_INTERVAL (see config/openmodem.conf), not QuecControl's
# tiered fast/medium/slow polling — see SCOPE.md. Field/command choices
# below were captured against a real RM520N-GL (AT&T SIM, LTE-registered)
# via at_command.sh, not assumed from documentation; see SCOPE.md's
# "Verified against real hardware" section for the raw samples.
#
# LAN client info is deliberately NOT collected here: on this hardware
# it comes from dnsmasq's lease file on the Application Processor, not
# from any AT command — a different data source that needs its own
# collector, not shoehorned into this AT-only poller.

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
LOG_LEVEL=1
POLL_INTERVAL=10
HISTORY_WINDOW_SAMPLES=60
MIMO_MAX_WINDOW_S=300
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

AT_CMD_BIN="/usrdata/openmodem/bin/at_command.sh"
RUN_DIR="/tmp/openmodem"
LOG_FILE="$RUN_DIR/poller.log"
STATE_FILE="$RUN_DIR/state_merged.json"
HISTORY_FILE="$RUN_DIR/history_signal.json"
HISTORY_SCRATCH="$RUN_DIR/history_signal_scratch"
HISTORY_FILE_WAN="$RUN_DIR/history_wan.json"
HISTORY_SCRATCH_WAN="$RUN_DIR/history_wan_scratch"
MIMO_CACHE="$RUN_DIR/mimo_max_cache"
LOG_MAX_BYTES=262144
LOG_SLOTS=2

mkdir -p "$RUN_DIR"

# -- Logging --------------------------------------------------------------
log_err() { echo "$(date '+%Y-%m-%d %H:%M:%S') [poller] ERROR $*" >> "$LOG_FILE"; }
log_op()  { [ "$LOG_LEVEL" -ge 1 ] 2>/dev/null && echo "$(date '+%Y-%m-%d %H:%M:%S') [poller] $*" >> "$LOG_FILE"; }
log_dbg() { [ "$LOG_LEVEL" -ge 2 ] 2>/dev/null && echo "$(date '+%Y-%m-%d %H:%M:%S') [poller] $*" >> "$LOG_FILE"; }

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

run_at() {
    # Strip \r here, once, centrally: every response line from the modem
    # is \r\n-terminated (confirmed live — od -c on a captured response
    # shows literal \r before each \n), which silently breaks every
    # $-anchored pattern downstream (^RM...$, ^OK$, a trailing "$ for a
    # quoted value, ...) since $ anchors to true end-of-line and the \r
    # is still sitting there. Every collector below assumes \r is already
    # gone by the time it sees this output.
    "$AT_CMD_BIN" "$1" "${2:-8}" 2>/dev/null | tr -d '\r'
}

# Splits a chained "AT+CMD1;+CMD2;+CMD3" response (as returned by run_at)
# back into per-command blocks, 1-indexed in chain order. Confirmed live
# on real hardware: each sub-command's answer — however many lines, e.g.
# CGDCONT's per-context lines — comes back as one contiguous run of
# non-blank lines, with exactly one blank line separating it from the
# next sub-command's answer, and a bare "OK"/"ERROR" trailing block after
# the last one. This lets every collector below chain its AT commands
# into a single broker round trip while reusing its original per-field
# parsing unchanged, just fed this instead of a fresh run_at() call per
# field — round-trip overhead (~0.25-0.35s fixed, regardless of command
# complexity) dominates poll time, not the AT device's actual response
# time, so collapsing N commands into 1 round trip is the real lever.
#
# Also confirmed live: a chain aborts at the first sub-command that
# ERRORs — nothing after it is even attempted, only a trailing ERROR
# block appears — so collectors below order any sub-command known to
# legitimately fail (e.g. AT+CNUM on SIMs without a provisioned number)
# last in its chain, so an error there degrades just that one field to
# null instead of losing the rest of the group.
nth_block() {
    printf '%s\n' "$1" | awk -v want="$2" '
        BEGIN { blk = 0; buf = "" }
        /^$/ {
            if (buf != "") {
                blk++
                if (blk == want) { print buf; exit }
                buf = ""
            }
            next
        }
        { buf = (buf == "" ? $0 : buf "\n" $0) }
        END {
            if (buf != "") {
                blk++
                if (blk == want) print buf
            }
        }
    '
}

# -- JSON helpers -----------------------------------------------------------
json_str() {
    if [ -z "$1" ]; then
        printf 'null'
    else
        printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r')"
    fi
}

json_num() {
    if printf '%s' "$1" | grep -qE '^-?[0-9]+(\.[0-9]+)?$'; then
        printf '%s' "$1"
    else
        printf 'null'
    fi
}

json_bool() {
    [ "$1" = "1" ] && printf 'true' || printf 'false'
}

atomic_write() {
    printf '%s\n' "$1" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

# -- 5-minute signal history ring buffer -----------------------------------
# HISTORY_SCRATCH holds one JSON object per line (newline-delimited, not a
# JSON array itself) — trimming a fixed-size window is then just
# `tail -n HISTORY_WINDOW_SAMPLES`, no JSON array parsing/splitting needed.
# HISTORY_FILE (what the front end actually polls, via
# www/cgi-bin/history_signal.sh) is rebuilt fresh from that trimmed scratch
# every cycle and atomic-written the same write-to-.tmp-then-mv way as
# STATE_FILE above. At the default POLL_INTERVAL=5s and
# HISTORY_WINDOW_SAMPLES=60, that's a 5-minute trailing window; both are
# config keys (config/openmodem.conf) so they stay in sync if either
# changes. Accumulates every cycle regardless of whether any browser has
# the Dashboard open — a page opening for the first time still sees the
# preceding 5 minutes via history_signal.sh's initial fetch.
#
# dl_est_mbps rides along here too (the Dashboard's "Est. Speed" trend)
# rather than getting its own history file — it's already computed once
# per cycle by collect_carrier_aggregation (F_CA_DL_EST_MBPS), which runs
# earlier in the same main-loop iteration, so this is just capturing an
# already-available value, not adding a new collector.
append_signal_history() {
    _t="$1"
    _line="{\"t\":${_t},\"lte_rsrp\":${F_LTE_RSRP},\"lte_rsrq\":${F_LTE_RSRQ},\"lte_sinr\":${F_LTE_SINR},\"nr_rsrp\":${F_NR_RSRP},\"nr_rsrq\":${F_NR_RSRQ},\"nr_sinr\":${F_NR_SINR},\"dl_est_mbps\":${F_CA_DL_EST_MBPS}}"
    { [ -f "$HISTORY_SCRATCH" ] && cat "$HISTORY_SCRATCH"; printf '%s\n' "$_line"; } \
        | tail -n "$HISTORY_WINDOW_SAMPLES" > "${HISTORY_SCRATCH}.tmp" && mv "${HISTORY_SCRATCH}.tmp" "$HISTORY_SCRATCH"

    _arr=$(awk 'NR>1{printf ","} {printf "%s", $0} END{print ""}' "$HISTORY_SCRATCH")
    printf '[%s]\n' "$_arr" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
}

# -- WAN rx/tx rate + its own 5-minute history ring buffer -----------------
# AT+QGDCNT only ever reports a running cumulative byte counter
# (collect_wan's F_WAN_DATA_TX/RX) — never an instantaneous rate — so the
# rate itself has to be derived here, once per poll cycle, from the delta
# against the previous cycle's counters (_WAN_PREV_RX/TX/T, plain globals
# that persist across loop iterations since this whole script is one
# long-running process, same assumption STATE_FILE's write-once-per-loop
# design already makes). This used to be computed client-side in app.js
# (delta between two consecutive state.sh fetches, divided by
# _poll_interval_s) — moved server-side so the front end has a single
# source of truth (matches renderConnectivityCard's latency/jitter, which
# made the same move) AND so a rate exists to persist into a history file:
# a client-only computation has nothing to seed a freshly-opened tab's
# graph with, unlike RSRP/dl_est_mbps's HISTORY_FILE above.
#
# Divides by actual elapsed wall-clock time between cycles (_t - prev t),
# not POLL_INTERVAL, since this runs server-side and has the real cycle
# timestamps on hand — no need for app.js's "trust the configured
# interval" shortcut. A negative delta (Reset Counter button, or a
# reboot) yields a null rate for that one sample, same as app.js's old
# "counter went backwards" guard; the prev-counter globals still advance
# every cycle regardless, so the next cycle resumes computing normally
# from the new (lower) baseline.
_WAN_PREV_RX=""; _WAN_PREV_TX=""; _WAN_PREV_T=""
compute_wan_rate() {
    _t="$1"
    F_WAN_RX_MBPS="null"; F_WAN_TX_MBPS="null"

    if [ -n "$_WAN_PREV_T" ]; then
        _rate=$(awk -v rx="$F_WAN_DATA_RX" -v tx="$F_WAN_DATA_TX" \
                    -v prx="$_WAN_PREV_RX" -v ptx="$_WAN_PREV_TX" \
                    -v pt="$_WAN_PREV_T" -v t="$_t" '
            BEGIN {
                if (rx == "null" || tx == "null") { print "null null"; exit }
                dt = t - pt
                if (dt <= 0 || rx < prx || tx < ptx) { print "null null"; exit }
                printf "%.3f %.3f", (rx - prx) * 8 / dt / 1000000, (tx - ptx) * 8 / dt / 1000000
            }')
        F_WAN_RX_MBPS=$(printf '%s' "$_rate" | cut -d' ' -f1)
        F_WAN_TX_MBPS=$(printf '%s' "$_rate" | cut -d' ' -f2)
    fi

    if [ "$F_WAN_DATA_RX" != "null" ]; then
        _WAN_PREV_RX="$F_WAN_DATA_RX"
        _WAN_PREV_TX="$F_WAN_DATA_TX"
        _WAN_PREV_T="$_t"
    fi
}

append_wan_history() {
    _t="$1"
    _line="{\"t\":${_t},\"rx_mbps\":${F_WAN_RX_MBPS},\"tx_mbps\":${F_WAN_TX_MBPS}}"
    { [ -f "$HISTORY_SCRATCH_WAN" ] && cat "$HISTORY_SCRATCH_WAN"; printf '%s\n' "$_line"; } \
        | tail -n "$HISTORY_WINDOW_SAMPLES" > "${HISTORY_SCRATCH_WAN}.tmp" && mv "${HISTORY_SCRATCH_WAN}.tmp" "$HISTORY_SCRATCH_WAN"

    _arr=$(awk 'NR>1{printf ","} {printf "%s", $0} END{print ""}' "$HISTORY_SCRATCH_WAN")
    printf '[%s]\n' "$_arr" > "${HISTORY_FILE_WAN}.tmp" && mv "${HISTORY_FILE_WAN}.tmp" "$HISTORY_FILE_WAN"
}

# AT+CGPADDR reports IPv6 as 16 dot-separated decimal octets (confirmed
# live: "38.0.3.128.135.82.175.111.0.0.0.72.21.29.30.1"), not colon-hex —
# QuecControl's own poller assumes colon notation already, which doesn't
# match this hardware. Converts pairs of octets into hex groups (each
# group computed as hi*256+lo so printf naturally drops leading zeros,
# e.g. 2600:380:8752:af6f:0:48:151d:1e01 — verified against this device's
# real assigned prefix). Returns empty on anything other than exactly 16
# dot-separated fields (also covers the all-zero "no address" case,
# which parses to 16 zero fields and is treated the same as absent).
ipv6_from_octets() {
    _oct="$1"
    [ -z "$_oct" ] && return
    _oldifs="$IFS"
    IFS='.'
    set -- $_oct
    IFS="$_oldifs"
    [ "$#" -eq 16 ] || return
    _out=""
    while [ "$#" -ge 2 ]; do
        _grp=$(printf '%x' $(( $1 * 256 + $2 )))
        _out="${_out}${_out:+:}${_grp}"
        shift 2
    done
    [ "$_out" = "0:0:0:0:0:0:0:0" ] && return
    printf '%s' "$_out"
}

# AT+QENG="servingcell"'s <UL_bandwidth>/<DL_bandwidth> use a 0-5 index
# scheme ("0 1.4MHz / 1 3MHz / 2 5MHz / 3 10MHz / 4 15MHz / 5 20MHz",
# confirmed live: index 5 there matched QCAINFO's own 100-PRB code for
# the same PCC's DL bandwidth at the same moment) — a *different*
# encoding than QCAINFO's PRB-count style (6/15/25/50/75/100), which
# compute_ca_throughput's lte_bw_mhz()/nr_bw_mhz() already decode. Only
# used for the PCC's UL bandwidth (QCAINFO never carries UL fields for
# the PCC line, only for SCCs), since that is the one piece of real
# UL data this specific AT command adds beyond what QCAINFO covers.
qeng_bw_mhz() {
    case "$1" in
        0) printf '1.4' ;;
        1) printf '3' ;;
        2) printf '5' ;;
        3) printf '10' ;;
        4) printf '15' ;;
        5) printf '20' ;;
        *) printf '' ;;
    esac
}

# -- Collectors ---------------------------------------------------------
# Each sets F_* globals (json-ready strings) from one or more AT commands.
# Missing/unparseable fields are left as "null" rather than guessed.

collect_device() {
    F_MODEL="null"; F_IMEI="null"; F_FIRMWARE="null"; F_TEMP_C="null"
    _blob="$1"

    # GSN/QGMR/ATI("I") each answer with bare, unprefixed text, so it's
    # chain position via nth_block — not content matching — that tells
    # them apart once merged. Positions are into the poller's single
    # whole-cycle chain — see ALL_CMD and its block-number comment below.
    _gsn=$(nth_block "$_blob" 1)
    F_IMEI=$(json_str "$(printf '%s' "$_gsn" | grep -E '^[0-9]{10,}$' | tr -d ' \r\n')")

    _gmr=$(nth_block "$_blob" 2)
    F_FIRMWARE=$(json_str "$(printf '%s' "$_gmr" | grep -v '^OK$' | grep -v '^$' | head -1 | tr -d '\r')")

    _ati=$(nth_block "$_blob" 3)
    F_MODEL=$(json_str "$(printf '%s' "$_ati" | grep -E '^RM[0-9A-Z-]+$' | head -1 | tr -d '\r')")

    # AT+QTEMP reports ~17 sensors on this hardware (PA paths that read
    # 0 when idle, a mmWave sensor that reads -273 since this module has
    # none, several internal subsystem cores). Rather than surface all
    # of them, take just "mdmss-0-usr" (the modem baseband subsystem
    # core) — the sensor both QuecControl's and SimpleAdmin's own
    # temperature logic converge on for this hardware: QuecControl's
    # naive first-line pick happens to land elsewhere (a PA sensor,
    # positional accident), but SimpleAdmin's deliberate fallback chain
    # (XO_THERM -> MDM-CORE-USR -> MDMSS*) resolves to this same MDMSS
    # sensor since the first two don't exist on this module.
    _qtemp=$(nth_block "$_blob" 4)
    F_TEMP_C=$(json_num "$(printf '%s' "$_qtemp" | grep '^+QTEMP:"mdmss-0-usr"' | head -1 | sed 's/^[^,]*,"//; s/"$//' | tr -d '\r')")
}

# Application Processor OS uptime — not an AT command at all, this is
# the Linux system OpenModem itself runs on (see CLAUDE.md's
# "Development" section on the AP vs. the modem's AT-command side), so
# it's a plain /proc/uptime read rather than anything routed through
# the AT broker/chain. First field is seconds since boot as a float
# (confirmed live, e.g. "3495.06 2404.67"); truncated to a whole-second
# integer since sub-second precision has no UI use here. The
# years/months/weeks/days/hours/minutes breakdown itself is computed
# client-side in app.js (fmtUptime), same division of labor as
# fmtBytes already uses for wan_data_tx/rx — this just supplies the raw
# seconds count.
collect_uptime() {
    F_UPTIME_S=$(json_num "$(cut -d. -f1 /proc/uptime 2>/dev/null | tr -d ' \r\n')")
}


# This module supports 2 SIM slots (AT+QUIMSLOT=? confirmed live:
# "+QUIMSLOT: (1,2)") but only one is active/queryable at a time — the
# other's ICCID/IMSI can't be read without an actual AT+QUIMSLOT=N
# switch, which is genuinely disruptive (confirmed live: triggers a
# full USB re-enumeration on the AT/diag interface, not just a SIM
# reinit — broker/poller/httpd self-recovered within ~5s without
# intervention, but it's a real interruption, not a quick reinit). So
# ICCID/IMSI/status/phone here describe whichever slot sim_active_slot
# says is active, never both — see SCOPE.md and www/cgi-bin/
# sim_action.sh (the disruptive AT+QUIMSLOT=N switch itself).
collect_sim() {
    F_SIM_STATUS="null"; F_SIM_IMSI="null"; F_SIM_ICCID="null"
    F_SIM_ACTIVE_SLOT="null"; F_SIM_PHONE="null"
    _blob="$1"

    _cpin=$(nth_block "$_blob" 5)
    F_SIM_STATUS=$(json_str "$(printf '%s' "$_cpin" | grep '+CPIN:' | sed 's/+CPIN: //' | tr -d ' \r\n')")

    _cimi=$(nth_block "$_blob" 6)
    F_SIM_IMSI=$(json_str "$(printf '%s' "$_cimi" | grep -E '^[0-9]{10,}$' | tr -d ' \r\n')")

    _ccid=$(nth_block "$_blob" 7)
    F_SIM_ICCID=$(json_str "$(printf '%s' "$_ccid" | grep '+QCCID:' | sed 's/+QCCID: //' | tr -d ' \r\n')")

    _slot=$(nth_block "$_blob" 8)
    F_SIM_ACTIVE_SLOT=$(json_num "$(printf '%s' "$_slot" | grep '+QUIMSLOT:' | sed 's/+QUIMSLOT: //' | tr -d ' \r\n')")

    # +CNUM: [alpha],"<number>",<type> — alpha tag is usually empty; not
    # every carrier/SIM provisions this, ERROR or a bare OK is normal.
    # Placed right before nr5g_mimo_info (block 31, see ALL_CMD) rather
    # than after it: nr5g_mimo_info reliably ERRORs whenever there's no
    # active NR component carrier (the normal state on an LTE-only
    # connection, not just an edge case — see build_mimo_lookup()'s
    # header comment), and a chain aborts at the first ERROR. With CNUM
    # after nr5g_mimo_info, that near-permanent NR failure was silently
    # nulling sim_phone even on SIMs with a provisioned number —
    # confirmed live 2026-08-19: AT+CNUM queried standalone returned a
    # real number while the poller's chain reported sim_phone null.
    # nr5g_mimo_info failing to run at all (because CNUM aborted ahead
    # of it) has the same net effect on its own field as it running and
    # erroring itself — build_mimo_lookup() just sees an empty block
    # either way — so this reordering loses nothing.
    _cnum=$(nth_block "$_blob" 31)
    F_SIM_PHONE=$(json_str "$(printf '%s' "$_cnum" | grep '^+CNUM:' | head -1 | sed 's/^+CNUM: //' | cut -d',' -f2 | tr -d '"\r\n')")
}

collect_registration() {
    F_REG_LTE="null"; F_REG_NR="null"; F_REG_CREG="null"
    _blob="$1"

    _cereg=$(nth_block "$_blob" 9)
    F_REG_LTE=$(json_num "$(printf '%s' "$_cereg" | grep '+CEREG:' | sed 's/+CEREG: //' | cut -d',' -f2 | tr -d ' \r\n')")

    _c5greg=$(nth_block "$_blob" 10)
    F_REG_NR=$(json_num "$(printf '%s' "$_c5greg" | grep '+C5GREG:' | sed 's/+C5GREG: //' | cut -d',' -f2 | tr -d ' \r\n')")

    _creg=$(nth_block "$_blob" 11)
    F_REG_CREG=$(json_num "$(printf '%s' "$_creg" | grep '+CREG:' | sed 's/+CREG: //' | cut -d',' -f2 | tr -d ' \r\n')")
}

# RM520N-GL reports RSRP/RSRQ/SINR with the RAT tag at the END of the
# line (e.g. "+QRSRP: -101,-99,-140,-140,LTE"), confirmed live — not at
# the start, which is the more commonly documented format for other
# Quectel modules.
collect_signal() {
    F_LTE_RSRP="null"; F_LTE_RSRQ="null"; F_LTE_SINR="null"
    F_NR_RSRP="null";  F_NR_RSRQ="null";  F_NR_SINR="null"
    _blob="$1"

    _rsrp=$(nth_block "$_blob" 12)
    F_LTE_RSRP=$(json_num "$(printf '%s' "$_rsrp" | grep '+QRSRP:.*,LTE' | sed 's/+QRSRP: //; s/,LTE$//' | cut -d',' -f1 | tr -d ' \r\n')")
    F_NR_RSRP=$(json_num "$(printf '%s' "$_rsrp" | grep '+QRSRP:.*,NR5G' | sed 's/+QRSRP: //; s/,NR5G$//' | cut -d',' -f1 | tr -d ' \r\n')")

    _rsrq=$(nth_block "$_blob" 13)
    F_LTE_RSRQ=$(json_num "$(printf '%s' "$_rsrq" | grep '+QRSRQ:.*,LTE' | sed 's/+QRSRQ: //; s/,LTE$//' | cut -d',' -f1 | tr -d ' \r\n')")
    F_NR_RSRQ=$(json_num "$(printf '%s' "$_rsrq" | grep '+QRSRQ:.*,NR5G' | sed 's/+QRSRQ: //; s/,NR5G$//' | cut -d',' -f1 | tr -d ' \r\n')")

    _sinr=$(nth_block "$_blob" 14)
    F_LTE_SINR=$(json_num "$(printf '%s' "$_sinr" | grep '+QSINR:.*,LTE' | sed 's/+QSINR: //; s/,LTE$//' | cut -d',' -f1 | tr -d ' \r\n')")
    F_NR_SINR=$(json_num "$(printf '%s' "$_sinr" | grep '+QSINR:.*,NR5G' | sed 's/+QSINR: //; s/,NR5G$//' | cut -d',' -f1 | tr -d ' \r\n')")
}

# The well-established leading QENG "servingcell" fields are parsed
# (state, RAT, duplex, MCC, MNC, cellID, PCID, EARFCN/ARFCN, band, TAC).
# Trailing fields (RSRP/RSRQ/RSSI/SINR/CQI/TA/...) are ambiguous across
# firmware revisions and are skipped here — collect_signal()'s dedicated
# QRSRP/QRSRQ/QSINR commands are the trusted source for those instead.
#
# AT+QENG="servingcell" answers with ONE line while camped on LTE or
# NR5G-SA, but TWO lines while in NR5G-NSA (an "LTE" anchor line — same
# shape/state as pure LTE, since the LTE leg genuinely is the anchor
# cell — followed by a second "NR5G-NSA" line for the secondary NR
# carrier) — so every line in the block is scanned rather than just the
# first, and LTE/NR fields are collected independently into their own
# F_CELL_LTE_*/F_CELL_NR_* sets rather than one shared set, so the LTE
# and 5G NR cards can each show real data for their own leg even while
# NSA has both active simultaneously. The LTE branch's field layout is
# confirmed live (same as before this split). The NR5G-SA/NSA layouts
# below are ported from Quectel's documented QENG field order but are
# NOT independently confirmed against this hardware (this connection
# has never carried an active NR component through this whole project,
# same caveat as collect_carrier_aggregation's NR5G branch) — verify
# once a real 5G session is observed and correct field offsets if wrong.
collect_serving_cell() {
    F_CELL_LTE_ACTIVE="0"; F_CELL_LTE_STATE="null"
    F_CELL_LTE_MCC="null"; F_CELL_LTE_MNC="null"; F_CELL_LTE_ID="null"
    F_CELL_LTE_PCID="null"; F_CELL_LTE_EARFCN="null"; F_CELL_LTE_BAND="null"; F_CELL_LTE_TAC="null"
    F_CELL_LTE_UL_BW_MHZ="null"

    F_CELL_NR_ACTIVE="0"; F_CELL_NR_TYPE="null"; F_CELL_NR_STATE="null"
    F_CELL_NR_MCC="null"; F_CELL_NR_MNC="null"; F_CELL_NR_ID="null"
    F_CELL_NR_PCID="null"; F_CELL_NR_ARFCN="null"; F_CELL_NR_BAND="null"; F_CELL_NR_TAC="null"

    _serv=$(nth_block "$1" 15)
    _lines=$(printf '%s' "$_serv" | grep '^+QENG:.*"servingcell"')
    [ -z "$_lines" ] && return

    _oldifs="$IFS"
    IFS='
'
    for _line in $_lines; do
        if printf '%s' "$_line" | grep -qE '"LTE"'; then
            _state=$(printf '%s' "$_line" | sed 's/.*"servingcell","//' | cut -d'"' -f1)
            F_CELL_LTE_ACTIVE="1"
            F_CELL_LTE_STATE=$(json_str "$_state")

            # Rest of line after the 4th quoted field
            # ("servingcell","STATE","LTE","FDD"/"TDD"):
            # MCC,MNC,cellID,PCID,EARFCN,band,ul_bw,dl_bw,TAC,...
            _rest=$(printf '%s' "$_line" | sed 's/.*"LTE","[A-Z]*",//')
            F_CELL_LTE_MCC=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f1 | tr -d ' \r\n')")
            F_CELL_LTE_MNC=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f2 | tr -d ' \r\n')")
            F_CELL_LTE_ID=$(json_str     "$(printf '%s' "$_rest" | cut -d',' -f3 | tr -d ' \r\n')")
            F_CELL_LTE_PCID=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f4 | tr -d ' \r\n')")
            F_CELL_LTE_EARFCN=$(json_str "$(printf '%s' "$_rest" | cut -d',' -f5 | tr -d ' \r\n')")
            F_CELL_LTE_BAND=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f6 | tr -d ' \r\n')")
            F_CELL_LTE_TAC=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f9 | tr -d ' \r\n')")

            _ul_bw_code=$(printf '%s' "$_rest" | cut -d',' -f7 | tr -d ' \r\n')
            F_CELL_LTE_UL_BW_MHZ=$(json_num "$(qeng_bw_mhz "$_ul_bw_code")")

        elif printf '%s' "$_line" | grep -qE '"NR5G-SA"'; then
            _state=$(printf '%s' "$_line" | sed 's/.*"servingcell","//' | cut -d'"' -f1)
            F_CELL_NR_ACTIVE="1"
            F_CELL_NR_TYPE=$(json_str "NR5G-SA")
            F_CELL_NR_STATE=$(json_str "$_state")

            # UNCONFIRMED layout — after ("servingcell","STATE","NR5G-SA","FDD"/"TDD"):
            # MCC,MNC,cellID,PCID,TAC,ARFCN,band,dl_bw,rsrp,rsrq,sinr,scs
            _rest=$(printf '%s' "$_line" | sed 's/.*"NR5G-SA","[A-Z]*",//')
            F_CELL_NR_MCC=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f1 | tr -d ' \r\n')")
            F_CELL_NR_MNC=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f2 | tr -d ' \r\n')")
            F_CELL_NR_ID=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f3 | tr -d ' \r\n')")
            F_CELL_NR_PCID=$(json_str  "$(printf '%s' "$_rest" | cut -d',' -f4 | tr -d ' \r\n')")
            F_CELL_NR_TAC=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f5 | tr -d ' \r\n')")
            F_CELL_NR_ARFCN=$(json_str "$(printf '%s' "$_rest" | cut -d',' -f6 | tr -d ' \r\n')")
            F_CELL_NR_BAND=$(json_str  "$(printf '%s' "$_rest" | cut -d',' -f7 | tr -d ' \r\n')")

        elif printf '%s' "$_line" | grep -qE '"NR5G-NSA"'; then
            F_CELL_NR_ACTIVE="1"
            F_CELL_NR_TYPE=$(json_str "NR5G-NSA")
            # No own <state> field — NSA's secondary line describes the
            # NR component of a connection whose state is the LTE
            # anchor line's above; leaving F_CELL_NR_STATE null (rather
            # than copying the LTE state) keeps this field honest about
            # what was actually reported for the NR leg itself.

            # UNCONFIRMED layout — no leading state/duplex fields on
            # this line, just: MCC,MNC,PCID,rsrp,sinr,rsrq,ARFCN,band,dl_bw,scs
            _rest=$(printf '%s' "$_line" | sed 's/.*"NR5G-NSA",//')
            F_CELL_NR_MCC=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f1 | tr -d ' \r\n')")
            F_CELL_NR_MNC=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f2 | tr -d ' \r\n')")
            F_CELL_NR_PCID=$(json_str  "$(printf '%s' "$_rest" | cut -d',' -f3 | tr -d ' \r\n')")
            F_CELL_NR_ARFCN=$(json_str "$(printf '%s' "$_rest" | cut -d',' -f7 | tr -d ' \r\n')")
            F_CELL_NR_BAND=$(json_str  "$(printf '%s' "$_rest" | cut -d',' -f8 | tr -d ' \r\n')")
        fi
    done
    IFS="$_oldifs"
}

collect_carrier() {
    F_CARRIER_NAME="null"; F_CARRIER_ACT="null"; F_CARRIER_PLMN="null"
    _blob="$1"

    _cops=$(nth_block "$_blob" 16)
    F_CARRIER_NAME=$(json_str "$(printf '%s' "$_cops" | grep '+COPS:' | cut -d'"' -f2)")
    F_CARRIER_ACT=$(json_num "$(printf '%s' "$_cops" | grep '+COPS:' | awk -F',' '{print $NF}' | tr -d ' \r\n')")

    _qspn=$(nth_block "$_blob" 17)
    F_CARRIER_PLMN=$(json_str "$(printf '%s' "$_qspn" | grep '+QSPN:' | awk -F',' '{print $NF}' | tr -d '" \r\n')")
}

# +QCAINFO: "PCC"|"SCC",earfcn,bandwidth,"LTE BAND N"|"NR5G BAND N",...
# one line per active component carrier. Count > 1 means carrier
# aggregation is active. Field layout past band (pci/rsrp/rsrq, +sinr
# for LTE) ported from QuecControl and confirmed live against this same
# RM520N-GL (2026-08-15, AT&T, 3-CC session: PCC LTE BAND 2 + 2x SCC LTE
# BAND 66) — pci/rsrp/rsrq/sinr and the decoded bw_mhz all matched the
# modem's real QCAINFO output.
#   NR5G line: ...,<pci>,<rsrp>,<rsrq>,...               (no SINR reported)
#   LTE line:  ...,<pci>,<rsrp>,<rsrq>,<rssi>,<sinr>,...  (SINR at field 10)

# AT+QNWCFG="lte_mimo_info" / "nr5g_mimo_info" report one line per active
# component carrier: <PCID>,<freq>,<layers>,<is_pcell> — confirmed live
# for LTE over dozens of samples (idle: PCC mostly 1 with brief spikes to
# 4, SCCs mostly 0; under a sustained ~65-70Mbps download all three CCs
# rose to and held 2 consistently, dropping back once the transfer
# stopped — <is_pcell> stayed rock-solid at 1 on the PCC / 0 on every SCC
# throughout). Neither subcommand is in Quectel's official AT command
# manual for this module family (checked directly — extracted and
# text-searched the real PDF) — found only by querying the live
# AT+QNWCFG=? subcommand list, which the manual doesn't fully match.
# nr5g_mimo_info's shape is assumed identical to lte_mimo_info's but
# UNCONFIRMED — this device had no active NR component carrier to test
# against; it returned ERROR in every attempt this session (expected
# when there's no NR resource to report on, same as QCAINFO/QENG's NR
# fields going empty rather than an actual failure).
# Builds "pci,freq,layers|pci,freq,layers|..." across both subcommands'
# blocks (28 and 32 in ALL_CMD — not adjacent: mode_pref/data_roaming/
# CNUM sit between them, see ALL_CMD's block-number comment) for
# update_mimo_max_cache to fold into its rolling-window per-carrier max
# cache, keyed against each carrier's own pci/earfcn —
# RAT-agnostic since both LTE and NR5G entries in ca_bands already carry
# pci/earfcn fields. Not consumed directly by compute_ca_throughput
# anymore — see update_mimo_max_cache's header comment.
build_mimo_lookup() {
    _out=""
    for _blk in 28 32; do
        _mi=$(nth_block "$1" "$_blk")
        _mi_lines=$(printf '%s' "$_mi" | grep -E '^\+QNWCFG: "(lte|nr5g)_mimo_info"')
        [ -z "$_mi_lines" ] && continue
        _oldifs="$IFS"
        IFS='
'
        for _l in $_mi_lines; do
            _r=$(printf '%s' "$_l" | sed 's/^+QNWCFG: "[a-z0-9]*_mimo_info",//')
            _pci=$(printf '%s' "$_r" | cut -d',' -f1 | tr -d ' \r\n')
            _freq=$(printf '%s' "$_r" | cut -d',' -f2 | tr -d ' \r\n')
            _layers=$(printf '%s' "$_r" | cut -d',' -f3 | tr -d ' \r\n')
            [ -z "$_pci" ] || [ -z "$_freq" ] && continue
            _out="${_out}${_out:+|}${_pci},${_freq},${_layers}"
        done
        IFS="$_oldifs"
    done
    printf '%s' "$_out"
}

# Turns build_mimo_lookup()'s live "pci,freq,layers|..." reading into a
# "pci,freq,max_layers|..." reading of the highest layer count observed
# on each exact carrier (keyed by pci_freq, same key compute_ca_
# throughput's mimo_max lookup uses) within a trailing MIMO_MAX_WINDOW_S
# rolling window, persisted across poll cycles in MIMO_CACHE so neither
# the throughput math nor the CA table's "(NxN)" display are at the mercy
# of a single bouncy live sample (see compute_ca_throughput's header
# comment). Persisted to a file, not a plain shell global like
# _WAN_PREV_RX/TX/T, so the learned max survives a poller restart, not
# just the current process lifetime.
#
# True sliding-window max, not a running high-water mark that only resets
# on total absence: each cache line holds a per-key history of
# "epoch:layers" samples, one appended per cycle the key is seen in the
# live reading. Every cycle, every key's history (seen this cycle or not)
# is pruned of samples older than MIMO_MAX_WINDOW_S (300s / 5min
# default, config/openmodem.conf) and the reported max is taken over
# whatever survives — so a peak fades out of the display this long after
# it was observed even on a carrier that never drops, not just after an
# absence timeout. A key with no samples left after pruning is dropped
# entirely. This also gives a carrier that vanishes from the live reading
# for a while (idle SCC, brief handover away and back to the same cell)
# its last-observed max for free, for as long as that sample is still
# inside the window — no separate "keep it cached across a gap" logic
# needed, since the history simply isn't pruned away yet.
#
# Cache file format: one line per key, "pci_freq<TAB>epoch:layers;epoch:
# layers;...". A stale line in the old "key,layers,last_seen" format
# (no tab) parses as an empty history and is silently dropped on the
# first cycle it's read — no explicit migration needed.
#
# String concatenation below always precomputes the separator into its
# own variable (sep/hsep/nsep) before appending — writing e.g.
# "h = h (h == "" ? "" : ";") ..." instead parses under BusyBox awk as a
# call to an undefined function h(), aborting the program with no visible
# error (confirmed on-device: mimo_max_cache stayed empty despite live
# QNWCFG data). Works fine under GNU awk, so this only surfaces on real
# hardware — don't reintroduce the identifier-space-paren form here.
#
# Input:  $1 = live lookup, build_mimo_lookup()'s output
#         $2 = current cycle's epoch seconds (main loop's $_start)
# Output: "pci,freq,max_layers|..." on stdout, one entry per surviving
#         cache key (same shape as $1, for compute_ca_throughput's layers
#         math — NOT the same as $1's per-cycle live values)
update_mimo_max_cache() {
    [ -f "$MIMO_CACHE" ] || : > "$MIMO_CACHE"
    awk -v live="$1" -v now="$2" -v window="$MIMO_MAX_WINDOW_S" -v tmp_file="${MIMO_CACHE}.tmp" -F'\t' '
    BEGIN {
        printf "" > tmp_file
        close(tmp_file)
        n = split(live, entries, "|")
        for (i = 1; i <= n; i++) {
            if (entries[i] == "") continue
            m = split(entries[i], f, ",")
            if (m < 3 || f[1] == "" || f[2] == "" || f[3] !~ /^[0-9]+$/) continue
            key = f[1] "_" f[2]
            v = f[3] + 0
            if (!(key in live_val) || v > live_val[key]) live_val[key] = v
        }
    }
    NF > 0 {
        key = $1
        hist[key] = (NF >= 2) ? $2 : ""
        have_cache[key] = 1
    }
    END {
        for (key in have_cache) all[key] = 1
        for (key in live_val) all[key] = 1
        out = ""
        for (key in all) {
            h = (key in hist) ? hist[key] : ""
            if (key in live_val) {
                hsep = (h == "" ? "" : ";")
                h = h hsep now ":" live_val[key]
            }
            nh = split(h, samples, ";")
            newh = ""
            maxv = -1
            for (j = 1; j <= nh; j++) {
                if (samples[j] == "") continue
                sm = split(samples[j], sv, ":")
                if (sm < 2) continue
                ts = sv[1] + 0
                v = sv[2] + 0
                if (now - ts > window) continue
                nsep = (newh == "" ? "" : ";")
                newh = newh nsep ts ":" v
                if (v > maxv) maxv = v
            }
            if (newh == "") continue
            print key "\t" newh >> tmp_file
            split(key, kf, "_")
            sep = (out == "" ? "" : "|")
            out = out sep kf[1] "," kf[2] "," maxv
        }
        print out
    }
    ' "$MIMO_CACHE"
    mv "${MIMO_CACHE}.tmp" "$MIMO_CACHE"
}

collect_carrier_aggregation() {
    F_CA_COUNT="0"
    F_CA_BANDS="[]"
    F_CA_TOTAL_BW_MHZ="0"
    F_CA_DL_EST_MBPS="null"
    F_CA_DL_MAX_MBPS="null"

    _now="$2"
    _ca=$(nth_block "$1" 18)
    _lines=$(printf '%s' "$_ca" | grep '^+QCAINFO:')
    [ -z "$_lines" ] && return

    _count=0
    _raw="["
    _first=1
    _oldifs="$IFS"
    IFS='
'
    for _line in $_lines; do
        _r=$(printf '%s' "$_line" | sed 's/^+QCAINFO: //')
        _type=$(printf '%s' "$_r" | cut -d',' -f1 | tr -d '"')
        _band=$(printf '%s' "$_r" | cut -d',' -f4 | tr -d '"')
        [ -z "$_band" ] && continue
        _earfcn=$(printf '%s' "$_r" | cut -d',' -f2)
        _bw_raw=$(printf '%s' "$_r" | cut -d',' -f3)
        _ul_configured=""; _ul_bw_raw=""; _ul_earfcn=""
        if printf '%s' "$_band" | grep -q "NR5G"; then
            _pci=$(printf '%s' "$_r" | cut -d',' -f5)
            _rsrp=$(printf '%s' "$_r" | cut -d',' -f6)
            _rsrq=$(printf '%s' "$_r" | cut -d',' -f7)
            _sinr=""
            # NR5G's own field layout here (state/UL/RSRP positions) is
            # NOT independently confirmed live on this hardware, unlike
            # the LTE branch below (this device has never carried an
            # active NR component carrier through this whole project) —
            # so UL fields are deliberately left unset for NR rather than
            # guessed at an offset nothing has verified.
        else
            _pci=$(printf '%s' "$_r" | cut -d',' -f6)
            _rsrp=$(printf '%s' "$_r" | cut -d',' -f7)
            _rsrq=$(printf '%s' "$_r" | cut -d',' -f8)
            _sinr=$(printf '%s' "$_r" | cut -d',' -f10)
            # Overrides collect_signal()'s AT+QRSRP/QRSRQ/QSINR-sourced
            # F_LTE_RSRP/RSRQ/SINR with this PCC's QCAINFO fields for the
            # Serving Cell card, so LTE's three headline signal numbers all
            # come from one command (matching the CA table's own PCC row,
            # which already used QCAINFO) instead of three separate ones.
            # RSRP's override (added first) has real evidence behind it —
            # confirmed live (2026-08-21) over 5 back-to-back samples that
            # QCAINFO's PCC rsrp and QENG="servingcell"'s trailing rsrp
            # field track each other exactly every cycle while QRSRP sits a
            # consistent ~5-7dB lower with its own uncorrelated wobble, and
            # Teltonika's own gsmctl docs (same Quectel module family) show
            # their serving-cell RSRP sourced from QENG="servingcell", not
            # a QRSRP equivalent. RSRQ/SINR's override (added after) is a
            # consistency call, not a same-strength finding: a parallel
            # live comparison of QRSRQ/QSINR against QCAINFO's PCC rsrq/
            # sinr showed only small, direction-varying differences (±1-3),
            # not RSRP's one-directional ~6dB bias — i.e. neither source
            # looked clearly wrong, so this switch is about giving LTE one
            # signal-data source instead of three, not correcting a bug.
            # Only done for LTE: NR5G's QCAINFO field layout is unconfirmed
            # on this hardware (see this branch's NR5G sibling above, and
            # this device has never carried an active NR component carrier
            # to test against), and QCAINFO's NR5G line never reports SINR
            # at all — so F_NR_RSRP/RSRQ/SINR stay on QRSRP/QRSRQ/QSINR,
            # which must stay in ALL_CMD for NR's sake regardless. If
            # QCAINFO never reports a PCC line this cycle (e.g. briefly out
            # of service), these overrides just don't run and the LTE
            # fields quietly stay whatever collect_signal() already set.
            if [ "$_type" = "PCC" ]; then
                F_LTE_RSRP=$(json_num "$_rsrp")
                F_LTE_RSRQ=$(json_num "$_rsrq")
                F_LTE_SINR=$(json_num "$_sinr")
            fi
            # <UL_configured>,<UL_bandwidth>,<UL_EARFCN> — SCC-only per
            # Quectel's manual (PCC's QCAINFO line never carries them;
            # its real UL bandwidth comes from QENG="servingcell"
            # instead, see F_CELL_LTE_UL_BW_MHZ) and only meaningful when
            # UL_configured=1 — confirmed live: a 3-CC session had one
            # SCC with ul_configured=0 (no uplink grant on that carrier
            # at all, normal with more than 2 active CCs) and another
            # with ul_configured=1 and real ul_bandwidth/ul_earfcn values
            # that cross-checked against QENG's separately-reported PCC
            # bandwidth for the same cycle.
            _ul_configured=$(printf '%s' "$_r" | cut -d',' -f11 | tr -d ' \r\n')
            if [ "$_ul_configured" = "1" ]; then
                _ul_bw_raw=$(printf '%s' "$_r" | cut -d',' -f12 | tr -d ' \r\n')
                _ul_earfcn=$(printf '%s' "$_r" | cut -d',' -f13 | tr -d ' \r\n')
            fi
        fi
        [ "$_first" -eq 1 ] || _raw="${_raw},"
        _raw="${_raw}{\"type\":$(json_str "$_type"),\"band\":$(json_str "$_band"),\"earfcn\":$(json_str "$_earfcn"),\"bandwidth\":$(json_str "$_bw_raw"),\"pci\":$(json_str "$_pci"),\"rsrp\":$(json_num "$_rsrp"),\"rsrq\":$(json_num "$_rsrq"),\"sinr\":$(json_num "$_sinr"),\"ul_bandwidth_raw\":$(json_str "$_ul_bw_raw"),\"ul_earfcn\":$(json_str "$_ul_earfcn")}"
        _first=0
        _count=$(( _count + 1 ))
    done
    IFS="$_oldifs"
    F_CA_COUNT="$_count"
    [ "$_count" -eq 0 ] && return
    _raw="${_raw}]"
    F_CA_BANDS="$_raw"

    _mimo_lookup=$(build_mimo_lookup "$1")
    _mimo_max_lookup=$(update_mimo_max_cache "$_mimo_lookup" "$_now")

    _result=$(compute_ca_throughput "$_raw" "$_mimo_max_lookup")
    [ -z "$_result" ] && return
    F_CA_BANDS=$(printf '%s\n' "$_result" | sed -n '1p')
    F_CA_DL_EST_MBPS=$(printf '%s\n' "$_result" | sed -n '2p')
    F_CA_DL_MAX_MBPS=$(printf '%s\n' "$_result" | sed -n '3p')
    F_CA_TOTAL_BW_MHZ=$(printf '%s\n' "$_result" | sed -n '4p')
    printf '%s' "$F_CA_DL_EST_MBPS" | grep -qE '^[0-9]+$' || F_CA_DL_EST_MBPS="null"
    printf '%s' "$F_CA_DL_MAX_MBPS" | grep -qE '^[0-9]+$' || F_CA_DL_MAX_MBPS="null"
    printf '%s' "$F_CA_TOTAL_BW_MHZ" | grep -qE '^[0-9]+(\.[0-9]+)?$' || F_CA_TOTAL_BW_MHZ="0"
}

# Estimates per-carrier and aggregate downlink throughput from CA data.
# Fixed overhead constants and the SINR->spectral-efficiency tables are
# ported from QuecControl's compute_throughput_estimate (confirmed
# against real hardware there — see SCOPE.md), simplified because this
# project's F_LTE_SINR/F_NR_SINR/F_LTE_RSRQ/F_NR_RSRQ are already single
# scalar values (not QuecControl's per-antenna comma-separated strings),
# so they're used directly as the per-carrier fallback with no antenna
# scan needed. Per-carrier MIMO layer count comes from
# lte_max_layers()/nr_max_layers() — a static per-band table sourced
# from Quectel's own RM520N-GL hardware design doc (see that function's
# header comment) — rather than the live AT+QNWCFG="lte_mimo_info"/
# "nr5g_mimo_info" reading build_mimo_lookup() below still gathers: that
# reading is genuinely bouncy (confirmed live: layers rising and falling
# in real time with actual load), which made both throughput columns
# noisy; the static ceiling trades that live responsiveness for a
# stable, capability-based number, by request. The live reading is still
# surfaced as each carrier's "mimo_layers" JSON field (the CA table's
# "(NxN)" badge) — only the throughput formulas below stopped using it.
#
# Computed here (not in app.js) so any page can bind to
# ca_dl_estimated_mbps / ca_dl_maximum_mbps / ca_total_bw_mhz, or a given
# carrier's dl_estimated_mbps / dl_maximum_mbps, via a plain data-field —
# no per-page throughput math needed.
#
# Input:  $1 = carriers JSON array, as built by collect_carrier_aggregation
#         $2 = mimo lookup, "pci,freq,layers|pci,freq,layers|..." from
#              build_mimo_lookup() — only feeds the "mimo_layers" display
#              field now, not the throughput math (see above)
# Output: 4 lines on stdout —
#   1. carriers JSON array, each object gaining bw_mhz/mimo_layers/
#      ul_bw_mhz/dl_estimated_mbps/dl_maximum_mbps. ul_bw_mhz is real
#      polled data, not assumed equal to bw_mhz: the PCC's comes from
#      F_CELL_LTE_UL_BW_MHZ (AT+QENG="servingcell", passed in as
#      pcc_ul_bw_mhz below since QCAINFO never carries UL fields for
#      the PCC line); each SCC's comes from its own QCAINFO
#      ul_bandwidth_raw field, left null when that SCC has no uplink
#      grant at all (confirmed live: normal with 3+ active carriers).
#   2. aggregate estimated downlink, Mbps — the exact sum of each
#      carrier's own (already-rounded) dl_estimated_mbps above, not a
#      separately-rounded total, so this can never drift from what the
#      per-carrier rows in the CA table add up to. (Previously rounded
#      the raw pre-rounding sum *up* to the nearest 10, which could
#      inflate the aggregate well past the sum of the displayed rows —
#      e.g. a raw total of 61.7 rounding up to 70 while the rows
#      individually rounded to 46+6+10=62 — confirmed live and fixed.)
#   3. aggregate maximum downlink, Mbps — same fix, sum of dl_maximum_mbps
#   4. aggregate bandwidth, MHz
#
# $2 (mimo_max_lookup, from update_mimo_max_cache()) drives both the
# "layers" term in the throughput formula below AND the "mimo_layers"
# JSON field (the CA table's "(NxN)" badge) — the highest layer count
# observed on this exact carrier within the cache's trailing rolling
# window (MIMO_MAX_WINDOW_S, default 5min), still clamped to
# lte_max_layers()/nr_max_layers()'s static per-band ceiling as a
# physical sanity cap (a glitched live reading can't inflate the cached
# max past what the band/modem could ever actually do). The throughput
# math falls back to that static ceiling alone for a carrier with no
# cache entry yet (never observed, or its last sample aged out); the
# JSON field shows null/"—" instead for that same case rather than a
# theoretical ceiling that was never actually observed. This used to be
# build_mimo_lookup()'s raw instantaneous live reading (bounced with
# every idle/loaded transition) — no longer plumbed in here at all,
# since nothing in this function consumed it once the display switched
# to the cached max.
compute_ca_throughput() {
    printf '%s' "$1" | awk \
        -v fb_lte_sinr="${F_LTE_SINR:-null}" \
        -v fb_nr_sinr="${F_NR_SINR:-null}" \
        -v fb_lte_rsrq="${F_LTE_RSRQ:-null}" \
        -v fb_nr_rsrq="${F_NR_RSRQ:-null}" \
        -v mimo_max_lookup="${2:-}" \
        -v pcc_ul_bw_mhz="${F_CELL_LTE_UL_BW_MHZ:-null}" \
    '
    function lte_bw_mhz(rb,    n) {
        n = int(rb)
        if (n == 6)   return 1.4
        if (n == 15)  return 3
        if (n == 25)  return 5
        if (n == 50)  return 10
        if (n == 75)  return 15
        if (n == 100) return 20
        return 0
    }
    function nr_bw_mhz(idx,    n) {
        n = int(idx)
        if (n == 0)  return 5
        if (n == 1)  return 10
        if (n == 2)  return 15
        if (n == 3)  return 20
        if (n == 4)  return 25
        if (n == 5)  return 30
        if (n == 6)  return 40
        if (n == 7)  return 50
        if (n == 8)  return 60
        if (n == 9)  return 70
        if (n == 10) return 80
        if (n == 11) return 90
        if (n == 12) return 100
        if (n == 13) return 200
        if (n == 14) return 400
        if (n == 15) return 35
        if (n == 16) return 45
        return 0
    }
    function lte_se(sinr) {
        if (sinr >= 22) return 5.55
        if (sinr >= 19) return 4.52
        if (sinr >= 16) return 3.90
        if (sinr >= 13) return 3.32
        if (sinr >= 11) return 2.73
        if (sinr >=  9) return 2.41
        if (sinr >=  7) return 1.91
        if (sinr >=  5) return 1.48
        if (sinr >=  3) return 1.18
        if (sinr >=  1) return 0.88
        if (sinr >= -1) return 0.60
        return 0.23
    }
    function nr_se(sinr) {
        if (sinr >= 28) return 7.41
        if (sinr >= 24) return 5.55
        if (sinr >= 21) return 4.52
        if (sinr >= 18) return 3.90
        if (sinr >= 16) return 3.32
        if (sinr >= 14) return 2.73
        if (sinr >= 13) return 2.41
        if (sinr >= 11) return 1.91
        if (sinr >=  9) return 1.48
        if (sinr >=  7) return 1.18
        if (sinr >=  5) return 0.88
        if (sinr >=  3) return 0.60
        return 0.38
    }
    function rsrq_penalty(rsrq) {
        if (rsrq >= -9)  return 1.00
        if (rsrq <= -19) return 0.65
        return 1.00 + (rsrq - (-9)) * 0.035
    }
    function nr_is_tdd(b) {
        if (b==1||b==2||b==3||b==5||b==7||b==8||b==12||b==13||b==14||
            b==18||b==20||b==25||b==26||b==28||b==30||b==65||b==66||
            b==70||b==71||b==74||b==75||b==76) return 0
        return 1
    }
    # The LTE standard band plan puts almost all TDD allocations in the
    # 33-53 block (33-48 already assigned, 50-53 reserved/allocated) —
    # enumerated directly here since it is the minority case for LTE
    # (unlike nr_is_tdd above, which lists the FDD-ish bands and treats
    # everything else as TDD by default, because the NR split runs the
    # other way). Added specifically because it was missing: TDD_DL was
    # only ever applied to NR TDD carriers, silently skipping the same
    # real DL:UL time-domain-sharing derating for LTE TDD bands like 40/
    # 41/48 — several of which are on the lte_max_layers() 4x4 list
    # above, so those carrier estimates were overstated relative to how
    # an equivalent NR TDD carrier on a comparable band is treated.
    function lte_is_tdd(b) {
        if (b>=33 && b<=53) return 1
        return 0
    }
    # Static per-band DL MIMO ceiling for the RM520N-GL specifically —
    # the Quectel-published hardware design doc ("RM520N Series
    # Hardware Design", Table 2: "RM520N-GL Frequency Bands & MIMO &
    # GNSS Systems") lists exactly these bands as DL 4x4-capable; every
    # other band this module supports is 2x2. This is the modem/spec
    # ceiling, not a live per-site reading — it does not know whether
    # the specific tower a device is camped on actually deploys 4
    # antennas (many real macro sites run 2x2 even on a 4x4-capable
    # band).
    #
    # No longer the throughput math layer-count input directly (that
    # was tried — see the update_mimo_max_cache header comment for why
    # the live AT+QNWCFG="lte_mimo_info"/"nr5g_mimo_info" reading alone
    # was too bouncy to use as-is, and this static ceiling too
    # optimistic on sites that do not actually deploy the band max
    # antenna count). Now only a sanity cap on the cached
    # highest-observed live reading (see the ml_key/mimo_max block
    # below) — a glitched live sample cannot inflate a carrier assumed
    # layers past what the band/modem could ever physically support.
    function lte_max_layers(b) {
        if (b==1||b==2||b==3||b==4||b==7||b==25||b==30||b==38||b==40||
            b==41||b==42||b==43||b==48||b==66) return 4
        return 2
    }
    function nr_max_layers(b) {
        if (b==1||b==2||b==3||b==7||b==25||b==30||b==38||b==40||b==41||
            b==48||b==66||b==70||b==77||b==78||b==79) return 4
        return 2
    }
    function numish(v) { return (v != "" && v != "null") }
    function json_field(rec, fname,    pat, pos, end, val, c) {
        pat = "\"" fname "\":"
        pos = index(rec, pat)
        if (pos == 0) return ""
        pos += length(pat)
        if (substr(rec, pos, 1) == "\"") {
            pos++
            end = index(substr(rec, pos), "\"")
            if (end == 0) return ""
            return substr(rec, pos, end - 1)
        }
        val = ""
        while (pos <= length(rec)) {
            c = substr(rec, pos, 1)
            if (c == "," || c == "}" || c == "]") break
            val = val c
            pos++
        }
        return val
    }
    BEGIN {
        # Was SCHED_EFF(0.75) * PROTO_EFF(0.70) = 0.525 combined, ported
        # from QuecControl with no independent ground truth (see
        # SCOPE.md). Replaced with a single factor after real-world
        # validation (2026-08-21): a client behind the modem measured a
        # consistent 133-136Mbps real downlink (proper multi-connection
        # speed test, not curl run directly on the modem AP CPU — that
        # earlier attempt undershot badly, almost certainly CPU/software-
        # bound on the embedded AP itself rather than radio-limited) against
        # this same 3-CC session (SINR ~5-11dB) reading a rock-steady
        # 94-95Mbps estimated across 6 consecutive poll cycles — the two
        # multiplied-together constants were double-derating the same
        # overhead. 134.5/94.2 ~= 1.428, and 0.525*1.428 ~= 0.75, so one
        # combined 0.75 factor replaces both. Still only validated at one
        # location/time/SINR regime — revisit if a future real-world check
        # drifts from this.
        THROUGHPUT_EFF = 0.75
        TDD_DL    = 0.70
        # THROUGHPUT_EFF above models PHY-layer overhead only (reference
        # signals, PDCCH control region, sync signals) — the ~25% loss
        # that is roughly constant regardless of network conditions and
        # well documented industry-wide for an idealized single-user
        # link. It does NOT model scheduler/cell-load sharing: how much
        # of a carrier capacity the network actually grants this device
        # versus other devices on the same cell. That is a separate,
        # much larger, and highly variable loss (deployment measurements
        # cited in industry literature put a single user at roughly half
        # of max throughput at 50% cell utilization and roughly a
        # quarter at 75% utilization) — and it is NOT observable from
        # RSRP/RSRQ/SINR at all, since those describe link quality, not
        # how many other devices the tower is currently serving.
        # Confirmed indirectly (2026-08-21): a real 3-CC session with
        # solid signal on all three carriers and a 189-211Mbps est
        # plateaued at ~124-140Mbps real-world regardless of how many
        # parallel connections a speed test used — consistent with
        # scheduler sharing, not a radio-quality problem this formula
        # could otherwise detect.
        #
        # SCHED_EFF is therefore a separate, explicit assumption (not a
        # measurement) about typical cell loading, applied only to the
        # "estimated" (everyday/realistic) figure — "maximum" is left
        # alone since it is documented elsewhere as a best-case ceiling,
        # not a real-world prediction, so scheduler sharing does not
        # apply to what it claims to represent. 0.55 assumes a
        # moderately shared cell (between the ~1.0 empty-cell and
        # ~0.25-0.5 loaded-cell figures above) — deliberately
        # conservative since no AT command on this modem reports actual
        # PRB utilization/cell load, so this can only ever be a chosen
        # assumption, not something future signal data could refine.
        SCHED_EFF = 0.55
        total_est = 0; total_max = 0; total_bw = 0
        out = "["

        n_mm = split(mimo_max_lookup, mm_entries, "|")
        for (mi = 1; mi <= n_mm; mi++) {
            n_mf = split(mm_entries[mi], mf, ",")
            if (n_mf >= 3 && mf[1] != "" && mf[2] != "" && mf[3] ~ /^[0-9]+$/) {
                mimo_max[mf[1] "_" mf[2]] = mf[3] + 0
            }
        }
    }
    {
        gsub(/^\[/, ""); gsub(/\]$/, "")
        n = split($0, carriers, /\},\{/)
        for (i = 1; i <= n; i++) {
            rec = carriers[i]
            if (substr(rec, 1, 1) != "{") rec = "{" rec
            if (substr(rec, length(rec), 1) != "}") rec = rec "}"

            type_str  = json_field(rec, "type")
            band_str  = json_field(rec, "band")
            earfcn    = json_field(rec, "earfcn")
            bw_raw    = json_field(rec, "bandwidth")
            pci       = json_field(rec, "pci")
            rsrp      = json_field(rec, "rsrp")
            rsrq_f    = json_field(rec, "rsrq")
            sinr_f    = json_field(rec, "sinr")
            ul_bw_raw = json_field(rec, "ul_bandwidth_raw")
            ul_earfcn = json_field(rec, "ul_earfcn")

            is_nr = (index(band_str, "NR5G") > 0)
            bw = is_nr ? nr_bw_mhz(bw_raw) : lte_bw_mhz(bw_raw)

            # Real polled UL bandwidth — never assumed equal to bw. PCC:
            # from AT+QENG="servingcell" (pcc_ul_bw_mhz, already decoded
            # MHz — QCAINFO carries no UL fields for the PCC line at
            # all). SCC: from its own QCAINFO ul_bandwidth_raw field (set
            # only when that SCC actually has an uplink grant — see
            # collect_carrier_aggregation), decoded the same way as bw.
            if (type_str == "PCC") {
                ul_bw = numish(pcc_ul_bw_mhz) ? pcc_ul_bw_mhz + 0 : 0
            } else if (numish(ul_bw_raw)) {
                ul_bw = is_nr ? nr_bw_mhz(ul_bw_raw) : lte_bw_mhz(ul_bw_raw)
            } else {
                ul_bw = 0
            }

            if (numish(sinr_f)) {
                sinr = sinr_f + 0
            } else {
                fb = is_nr ? fb_nr_sinr : fb_lte_sinr
                sinr = numish(fb) ? fb + 0 : 5
            }
            if (numish(rsrq_f)) {
                rsrq = rsrq_f + 0
            } else {
                fb = is_nr ? fb_nr_rsrq : fb_lte_rsrq
                rsrq = numish(fb) ? fb + 0 : -9
            }

            # ml_key/mimo_max_known identify this carrier entry (if any)
            # in the max-observed-layers cache (mimo_max, from
            # update_mimo_max_cache()) — drives both the throughput
            # math below AND the "mimo_layers" JSON field (the CA table
            # "(NxN)" badge), which now shows the highest value observed
            # for this exact carrier within the trailing rolling window
            # instead of the bouncy instantaneous live reading.
            ml_key = pci "_" earfcn
            mimo_max_known = (ml_key in mimo_max) && mimo_max[ml_key] > 0

            band_num = 0; s = band_str
            while (match(s, /[0-9]+/)) {
                band_num = substr(s, RSTART, RLENGTH) + 0
                s = substr(s, RSTART + RLENGTH)
            }
            # Throughput math layer count: the static per-band ceiling
            # (lte_max_layers()/nr_max_layers(), see their header
            # comment) is now only a sanity cap, not the value
            # itself — prefer the cached rolling-window max live reading
            # for this exact carrier when one exists, since
            # that tracks what the site actually deploys rather than
            # what the band/modem could theoretically support. A
            # carrier with no cache entry yet falls back to the static
            # ceiling alone (same as before this cache existed).
            static_layers = is_nr ? nr_max_layers(band_num) : lte_max_layers(band_num)
            if (mimo_max_known) {
                layers = mimo_max[ml_key]
                if (layers > static_layers) layers = static_layers
            } else {
                layers = static_layers
            }

            se_est = is_nr ? nr_se(sinr) : lte_se(sinr)
            se_max = is_nr ? nr_se(35)   : lte_se(30)

            est = 0; max = 0
            if (bw > 0) {
                total_bw += bw
                est = se_est * bw * layers * THROUGHPUT_EFF
                max = se_max * bw * layers * THROUGHPUT_EFF
                is_tdd = is_nr ? nr_is_tdd(band_num) : lte_is_tdd(band_num)
                if (is_tdd) { est = est * TDD_DL; max = max * TDD_DL }
                est = est * rsrq_penalty(rsrq)
                est = est * SCHED_EFF
            }
            c_est = int(est + 0.5)
            c_max = int(max + 0.5)
            total_est += c_est
            total_max += c_max

            if (i > 1) out = out ","
            out = out "{\"type\":\"" type_str "\",\"band\":\"" band_str "\""
            out = out ",\"earfcn\":" (earfcn == "" ? "null" : "\"" earfcn "\"")
            out = out ",\"bandwidth\":" (bw_raw == "" ? "null" : "\"" bw_raw "\"")
            out = out ",\"bw_mhz\":" (bw > 0 ? bw : "null")
            out = out ",\"ul_bw_mhz\":" (ul_bw > 0 ? ul_bw : "null")
            out = out ",\"ul_earfcn\":" (ul_earfcn == "" ? "null" : "\"" ul_earfcn "\"")
            out = out ",\"pci\":" (pci == "" ? "null" : "\"" pci "\"")
            out = out ",\"rsrp\":" (rsrp == "" ? "null" : rsrp)
            out = out ",\"rsrq\":" (rsrq_f == "" ? "null" : rsrq_f)
            out = out ",\"sinr\":" (numish(sinr_f) ? sinr_f : "null")
            out = out ",\"mimo_layers\":" (mimo_max_known ? layers : "null")
            out = out ",\"dl_estimated_mbps\":" c_est
            out = out ",\"dl_maximum_mbps\":" c_max
            out = out "}"
        }
    }
    END {
        out = out "]"
        print out
        if (total_est < 0) total_est = 0
        if (total_max < 0) total_max = 0
        print total_est
        print total_max
        print total_bw
    }
    '
}

collect_band_pref() {
    F_BAND_PREF_LTE="null"; F_BAND_PREF_NR5G="null"
    _blob="$1"

    _lte=$(nth_block "$_blob" 19)
    F_BAND_PREF_LTE=$(json_str "$(printf '%s' "$_lte" | grep '+QNWPREFCFG:' | sed 's/.*"lte_band",//' | tr -d ' \r\n')")

    _nr=$(nth_block "$_blob" 20)
    F_BAND_PREF_NR5G=$(json_str "$(printf '%s' "$_nr" | grep '+QNWPREFCFG:' | sed 's/.*"nr5g_band",//' | tr -d ' \r\n')")
}

# Network Mode (AT+QNWPREFCFG="mode_pref") and Data Roaming
# (AT+QNWCFG="data_roaming") — both confirmed live against this
# hardware (2026-08-17): mode_pref currently reads "AUTO" and accepts a
# colon-separated RAT list the same way lte_band/nr5g_band do (this
# module's own AT+QNWPREFCFG=? lists it as "mode_pref",RAT1:...:RATN);
# data_roaming currently reads 0 and is a plain (0,1) toggle per its own
# AT+QNWCFG=? entry. There is NO "roamservice" QCFG key on this
# firmware (queried live, not present in AT+QCFG=?'s full list) —
# data_roaming is the real roaming control here, not that.
collect_network_prefs() {
    F_NET_MODE_PREF="null"; F_NET_DATA_ROAMING="null"
    _blob="$1"

    _mode=$(nth_block "$_blob" 29)
    F_NET_MODE_PREF=$(json_str "$(printf '%s' "$_mode" | grep '+QNWPREFCFG:' | sed 's/.*"mode_pref",//' | tr -d ' \r\n')")

    _roam=$(nth_block "$_blob" 30)
    F_NET_DATA_ROAMING=$(json_bool "$(printf '%s' "$_roam" | grep '+QNWCFG:' | sed 's/.*"data_roaming",//' | tr -d ' \r\n')")
}

# WAN state for PDP context 1 (the primary/default context on this
# hardware — "broadband" APN, confirmed live). Context 3 ("sos") is
# emergency-only and deliberately not surfaced.
collect_wan() {
    F_WAN_APN="null"; F_WAN_IP="null"; F_WAN_ACTIVE="false"
    F_WAN_IP_TYPE="null"; F_WAN_IPV6="null"
    F_WAN_DATA_TX="null"; F_WAN_DATA_RX="null"
    _blob="$1"

    _dcont=$(nth_block "$_blob" 21)
    _dcont_line=$(printf '%s' "$_dcont" | grep '^+CGDCONT: 1,')
    F_WAN_APN=$(json_str "$(printf '%s' "$_dcont_line" | cut -d',' -f3 | tr -d '"\r\n')")
    F_WAN_IP_TYPE=$(json_str "$(printf '%s' "$_dcont_line" | cut -d',' -f2 | tr -d '"\r\n')")

    _addr=$(nth_block "$_blob" 22)
    _addr_line=$(printf '%s' "$_addr" | grep '^+CGPADDR: 1,')
    F_WAN_IP=$(json_str "$(printf '%s' "$_addr_line" | cut -d',' -f2 | tr -d '"\r\n')")
    F_WAN_IPV6=$(json_str "$(ipv6_from_octets "$(printf '%s' "$_addr_line" | cut -d',' -f3 | tr -d '"\r\n')")")

    _act=$(nth_block "$_blob" 23)
    _stat=$(printf '%s' "$_act" | grep '^+CGACT: 1,' | cut -d',' -f2 | tr -d ' \r\n')
    F_WAN_ACTIVE=$(json_bool "$_stat")

    # +QGDCNT: <tx_bytes>,<rx_bytes> — cumulative since last AT+QGDCNT=0
    # reset (or module boot), confirmed live.
    _gdcnt=$(nth_block "$_blob" 24)
    _gdcnt_line=$(printf '%s' "$_gdcnt" | grep '^+QGDCNT:' | sed 's/+QGDCNT: //')
    F_WAN_DATA_TX=$(json_num "$(printf '%s' "$_gdcnt_line" | cut -d',' -f1 | tr -d ' \r\n')")
    F_WAN_DATA_RX=$(json_num "$(printf '%s' "$_gdcnt_line" | cut -d',' -f2 | tr -d ' \r\n')")
}

# LAN config: DHCP pool/gateway, NAT-vs-passthrough mode, DNS proxy mode —
# all governed by AT+QMAP, same mechanism (and mostly the same query
# forms) as QuecControl's collect_lan(). Unlike QuecControl this isn't a
# separate slow tier: it runs every cycle like everything else, per
# SCOPE.md's single-poll-interval design.
collect_lan() {
    F_LAN_ROUTER_IP="null"; F_LAN_DHCP_START="null"; F_LAN_DHCP_END="null"
    F_LAN_MODE="null"; F_LAN_MPDN_MAC="null"; F_LAN_DNS_MODE="null"
    _blob="$1"

    # Confirmed live: AT+QMAP="LANIP",? returns ERROR on this hardware —
    # the bare form (no ,?), same as MPDN_rule/DHCPV4DNS below, is the
    # actual query. Response: +QMAP: "LANIP",<start>,<end>,<gateway>
    # (no quotes around the IPs, unlike QuecControl's documented example).
    _lanip=$(nth_block "$_blob" 25)
    _lanip_line=$(printf '%s' "$_lanip" | grep '+QMAP: "LANIP"' | head -1 | sed 's/.*"LANIP",//')
    if [ -n "$_lanip_line" ]; then
        F_LAN_DHCP_START=$(json_str "$(printf '%s' "$_lanip_line" | cut -d',' -f1 | tr -d '" \r\n')")
        F_LAN_DHCP_END=$(json_str   "$(printf '%s' "$_lanip_line" | cut -d',' -f2 | tr -d '" \r\n')")
        F_LAN_ROUTER_IP=$(json_str  "$(printf '%s' "$_lanip_line" | cut -d',' -f3 | tr -d '" \r\n')")
    fi

    # +QMAP: "MPDN_rule",<rule>,<profile>,<vlan>,<ippt_mode>,<autoconn>[,"<mac>"]
    _mpdn=$(nth_block "$_blob" 26)
    _mpdn_line=$(printf '%s' "$_mpdn" | grep '^+QMAP: "MPDN_rule",0,' | head -1 | sed 's/.*"MPDN_rule",//')
    _ippt=$(printf '%s' "$_mpdn_line" | cut -d',' -f4 | tr -d ' \r\n')
    case "$_ippt" in
        1) F_LAN_MODE=$(json_str "IP Passthrough")
           F_LAN_MPDN_MAC=$(json_str "$(printf '%s' "$_mpdn_line" | cut -d',' -f6 | tr -d '" \r\n')") ;;
        0) F_LAN_MODE=$(json_str "NAT") ;;
    esac

    _dns=$(nth_block "$_blob" 27)
    _dns_val=$(printf '%s' "$_dns" | grep '+QMAP: "DHCPV4DNS"' | head -1 | sed 's/.*"DHCPV4DNS",//' | tr -d '" \r\n')
    case "$_dns_val" in
        enable)  F_LAN_DNS_MODE=$(json_str "local") ;;
        disable) F_LAN_DNS_MODE=$(json_str "carrier") ;;
    esac
}

write_state() {
    _polled_at="$1"
    _duration="$2"

    _json=$(cat <<EOF
{
  "_polled_at": ${_polled_at},
  "_poll_duration_s": ${_duration},
  "_poll_interval_s": ${POLL_INTERVAL},
  "device_model": ${F_MODEL},
  "device_imei": ${F_IMEI},
  "device_firmware": ${F_FIRMWARE},
  "device_temp_c": ${F_TEMP_C},
  "device_uptime_s": ${F_UPTIME_S},
  "sim_status": ${F_SIM_STATUS},
  "sim_imsi": ${F_SIM_IMSI},
  "sim_iccid": ${F_SIM_ICCID},
  "sim_active_slot": ${F_SIM_ACTIVE_SLOT},
  "sim_phone": ${F_SIM_PHONE},
  "reg_lte": ${F_REG_LTE},
  "reg_nr": ${F_REG_NR},
  "reg_creg": ${F_REG_CREG},
  "signal_lte_rsrp": ${F_LTE_RSRP},
  "signal_lte_rsrq": ${F_LTE_RSRQ},
  "signal_lte_sinr": ${F_LTE_SINR},
  "signal_nr_rsrp": ${F_NR_RSRP},
  "signal_nr_rsrq": ${F_NR_RSRQ},
  "signal_nr_sinr": ${F_NR_SINR},
  "cell_lte_active": $(json_bool "$F_CELL_LTE_ACTIVE"),
  "cell_lte_state": ${F_CELL_LTE_STATE},
  "cell_lte_mcc": ${F_CELL_LTE_MCC},
  "cell_lte_mnc": ${F_CELL_LTE_MNC},
  "cell_lte_id": ${F_CELL_LTE_ID},
  "cell_lte_pcid": ${F_CELL_LTE_PCID},
  "cell_lte_earfcn": ${F_CELL_LTE_EARFCN},
  "cell_lte_band": ${F_CELL_LTE_BAND},
  "cell_lte_tac": ${F_CELL_LTE_TAC},
  "cell_nr_active": $(json_bool "$F_CELL_NR_ACTIVE"),
  "cell_nr_type": ${F_CELL_NR_TYPE},
  "cell_nr_state": ${F_CELL_NR_STATE},
  "cell_nr_mcc": ${F_CELL_NR_MCC},
  "cell_nr_mnc": ${F_CELL_NR_MNC},
  "cell_nr_id": ${F_CELL_NR_ID},
  "cell_nr_pcid": ${F_CELL_NR_PCID},
  "cell_nr_arfcn": ${F_CELL_NR_ARFCN},
  "cell_nr_band": ${F_CELL_NR_BAND},
  "cell_nr_tac": ${F_CELL_NR_TAC},
  "carrier_name": ${F_CARRIER_NAME},
  "carrier_act": ${F_CARRIER_ACT},
  "carrier_plmn": ${F_CARRIER_PLMN},
  "net_mode_pref": ${F_NET_MODE_PREF},
  "net_data_roaming": ${F_NET_DATA_ROAMING},
  "ca_count": ${F_CA_COUNT},
  "ca_bands": ${F_CA_BANDS},
  "ca_total_bw_mhz": ${F_CA_TOTAL_BW_MHZ},
  "ca_dl_estimated_mbps": ${F_CA_DL_EST_MBPS},
  "ca_dl_maximum_mbps": ${F_CA_DL_MAX_MBPS},
  "band_pref_lte": ${F_BAND_PREF_LTE},
  "band_pref_nr5g": ${F_BAND_PREF_NR5G},
  "wan_apn": ${F_WAN_APN},
  "wan_ip": ${F_WAN_IP},
  "wan_ipv6": ${F_WAN_IPV6},
  "wan_ip_type": ${F_WAN_IP_TYPE},
  "wan_active": ${F_WAN_ACTIVE},
  "wan_data_tx": ${F_WAN_DATA_TX},
  "wan_data_rx": ${F_WAN_DATA_RX},
  "wan_tx_mbps": ${F_WAN_TX_MBPS},
  "wan_rx_mbps": ${F_WAN_RX_MBPS},
  "lan_router_ip": ${F_LAN_ROUTER_IP},
  "lan_dhcp_start": ${F_LAN_DHCP_START},
  "lan_dhcp_end": ${F_LAN_DHCP_END},
  "lan_mode": ${F_LAN_MODE},
  "lan_mpdn_mac": ${F_LAN_MPDN_MAC},
  "lan_dns_mode": ${F_LAN_DNS_MODE}
}
EOF
)
    atomic_write "$_json"
}

# -- Wait for the broker's FIFO before starting --
_wait=0
while [ ! -p /tmp/at_request ] && [ "$_wait" -lt 30 ]; do
    sleep 1
    _wait=$(( _wait + 1 ))
done
if [ ! -p /tmp/at_request ]; then
    log_err "Broker FIFO not present after ${_wait}s, giving up"
    exit 1
fi

# Tells systemd (Type=notify) this service is up — otherwise it just waits
# out TimeoutStartSec before deciding startup succeeded anyway. No-op (harmless
# nonzero exit, ignored) when run manually outside systemd, i.e. NOTIFY_SOCKET unset.
systemd-notify --ready 2>/dev/null

log_op "Starting — interval=${POLL_INTERVAL}s log_level=${LOG_LEVEL}"

# Every AT round trip costs ~0.25-0.35s of fixed broker/polling overhead
# regardless of the command's own complexity (confirmed live) — with the
# 28 commands below issued separately, that overhead alone summed to
# ~8.2s of a 10s POLL_INTERVAL. Chaining all of them into one "AT+CMD1;
# +CMD2;..." request (confirmed live: the modem answers the full 28-
# command chain, in order, in ~0.2-0.3s) collapses that to a single
# round trip; nth_block() below then splits the merged response back
# into each field's own block by fixed position. Block numbers, in
# order:
#  1 GSN(imei) 2 QGMR(fw) 3 I/ATI(model) 4 QTEMP(temp)
#  5 CPIN 6 CIMI 7 QCCID 8 QUIMSLOT
#  9 CEREG 10 C5GREG 11 CREG
#  12 QRSRP 13 QRSRQ 14 QSINR
#  15 QENG=servingcell
#  16 COPS 17 QSPN
#  18 QCAINFO
#  19 QNWPREFCFG=lte_band 20 QNWPREFCFG=nr5g_band
#  21 CGDCONT 22 CGPADDR 23 CGACT 24 QGDCNT
#  25 QMAP=LANIP 26 QMAP=MPDN_rule 27 QMAP=DHCPV4DNS
#  28 QNWCFG=lte_mimo_info
#  29 QNWPREFCFG=mode_pref 30 QNWCFG=data_roaming
#  31 CNUM
#  32 QNWCFG=nr5g_mimo_info
# Both CNUM and nr5g_mimo_info are documented to legitimately ERROR —
# CNUM on SIMs without a provisioned MSISDN, nr5g_mimo_info whenever
# there's no active NR component carrier (confirmed LIVE: this is the
# NORMAL state on an LTE-only connection, not an edge case — see
# build_mimo_lookup()'s header comment) — and a chain aborts at the
# first ERROR. Both are placed last, in that order (CNUM ahead of
# nr5g_mimo_info), so each failure only nulls its own field: if CNUM
# ERRORs, nr5g_mimo_info simply never runs, which has the same net
# effect on its field as it running and erroring itself. The reverse
# order was tried first and confirmed live 2026-08-19 to be wrong —
# nr5g_mimo_info's near-permanent failure on this LTE-heavy test
# connection was silently nulling sim_phone even though AT+CNUM queried
# standalone returned a real number. mode_pref and data_roaming
# (confirmed live 2026-08-17 to always answer OK) are ordered right
# after lte_mimo_info, ahead of both risky commands, so neither
# failure can take them out too.
ALL_CMD='AT+GSN;+QGMR;I;+QTEMP;+CPIN?;+CIMI;+QCCID;+QUIMSLOT?;+CEREG?;+C5GREG?;+CREG?;+QRSRP;+QRSRQ;+QSINR;+QENG="servingcell";+COPS?;+QSPN;+QCAINFO;+QNWPREFCFG="lte_band";+QNWPREFCFG="nr5g_band";+CGDCONT?;+CGPADDR;+CGACT?;+QGDCNT?;+QMAP="LANIP";+QMAP="MPDN_rule";+QMAP="DHCPV4DNS";+QNWCFG="lte_mimo_info";+QNWPREFCFG="mode_pref";+QNWCFG="data_roaming";+CNUM;+QNWCFG="nr5g_mimo_info"'

_cycle=0

# -- Main loop ------------------------------------------------------------
while true; do
    _start=$(date +%s)
    _cycle=$(( _cycle + 1 ))
    [ $(( _cycle % 20 )) -eq 0 ] && rotate_log

    _blob=$(run_at "$ALL_CMD" 15)

    # Fed once per cycle, right after the one call that can legitimately
    # block for a while (run_at) — proves the cycle is actually making
    # progress, not just that the loop started. WatchdogSec (set in the
    # systemd unit) must stay comfortably above worst-case cycle time.
    systemd-notify WATCHDOG=1 2>/dev/null

    collect_device "$_blob"
    collect_uptime
    collect_sim "$_blob"
    collect_registration "$_blob"
    collect_signal "$_blob"
    collect_serving_cell "$_blob"
    collect_carrier "$_blob"
    collect_carrier_aggregation "$_blob" "$_start"
    collect_band_pref "$_blob"
    collect_network_prefs "$_blob"
    collect_wan "$_blob"
    compute_wan_rate "$_start"
    collect_lan "$_blob"

    _end=$(date +%s)
    write_state "$_start" "$(( _end - _start ))"
    append_signal_history "$_start"
    append_wan_history "$_start"
    log_dbg "Cycle ${_cycle} done in $(( _end - _start ))s"

    _elapsed=$(( _end - _start ))
    _remaining=$(( POLL_INTERVAL - _elapsed ))
    [ "$_remaining" -lt 1 ] && _remaining=1
    sleep "$_remaining"
done
