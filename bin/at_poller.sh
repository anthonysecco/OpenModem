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
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

AT_CMD_BIN="/usrdata/openmodem/bin/at_command.sh"
RUN_DIR="/tmp/openmodem"
LOG_FILE="$RUN_DIR/poller.log"
STATE_FILE="$RUN_DIR/state_merged.json"
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

# -- Collectors ---------------------------------------------------------
# Each sets F_* globals (json-ready strings) from one or more AT commands.
# Missing/unparseable fields are left as "null" rather than guessed.

collect_device() {
    F_MODEL="null"; F_IMEI="null"; F_FIRMWARE="null"
    _gsn=$(run_at "AT+GSN")
    F_IMEI=$(json_str "$(printf '%s' "$_gsn" | grep -E '^[0-9]{10,}$' | tr -d ' \r\n')")

    _gmr=$(run_at "AT+QGMR")
    F_FIRMWARE=$(json_str "$(printf '%s' "$_gmr" | grep -v '^OK$' | grep -v '^$' | head -1 | tr -d '\r')")

    _ati=$(run_at "ATI")
    F_MODEL=$(json_str "$(printf '%s' "$_ati" | grep -E '^RM[0-9A-Z-]+$' | head -1 | tr -d '\r')")

    # +QTEMP:"sensor","value" per line -> [{"sensor":"...","c":N}, ...]
    _qtemp=$(run_at "AT+QTEMP")
    F_TEMPS="[]"
    _lines=$(printf '%s' "$_qtemp" | grep '^+QTEMP:')
    if [ -n "$_lines" ]; then
        _json="["
        _first=1
        _oldifs="$IFS"
        IFS='
'
        for _line in $_lines; do
            _sensor=$(printf '%s' "$_line" | sed 's/^+QTEMP:"//; s/".*//')
            _val=$(printf '%s' "$_line" | sed 's/^[^,]*,"//; s/"$//' | tr -d '\r')
            [ "$_first" -eq 1 ] || _json="${_json},"
            _json="${_json}{\"sensor\":$(json_str "$_sensor"),\"c\":$(json_num "$_val")}"
            _first=0
        done
        IFS="$_oldifs"
        F_TEMPS="${_json}]"
    fi
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

    _cpin=$(run_at "AT+CPIN?")
    F_SIM_STATUS=$(json_str "$(printf '%s' "$_cpin" | grep '+CPIN:' | sed 's/+CPIN: //' | tr -d ' \r\n')")

    _cimi=$(run_at "AT+CIMI")
    F_SIM_IMSI=$(json_str "$(printf '%s' "$_cimi" | grep -E '^[0-9]{10,}$' | tr -d ' \r\n')")

    _ccid=$(run_at "AT+QCCID")
    F_SIM_ICCID=$(json_str "$(printf '%s' "$_ccid" | grep '+QCCID:' | sed 's/+QCCID: //' | tr -d ' \r\n')")

    _slot=$(run_at "AT+QUIMSLOT?")
    F_SIM_ACTIVE_SLOT=$(json_num "$(printf '%s' "$_slot" | grep '+QUIMSLOT:' | sed 's/+QUIMSLOT: //' | tr -d ' \r\n')")

    # +CNUM: [alpha],"<number>",<type> — alpha tag is usually empty; not
    # every carrier/SIM provisions this, ERROR or a bare OK is normal.
    _cnum=$(run_at "AT+CNUM")
    F_SIM_PHONE=$(json_str "$(printf '%s' "$_cnum" | grep '^+CNUM:' | head -1 | sed 's/^+CNUM: //' | cut -d',' -f2 | tr -d '"\r\n')")
}

collect_registration() {
    F_REG_LTE="null"; F_REG_NR="null"; F_REG_CREG="null"
    _cereg=$(run_at "AT+CEREG?")
    F_REG_LTE=$(json_num "$(printf '%s' "$_cereg" | grep '+CEREG:' | sed 's/+CEREG: //' | cut -d',' -f2 | tr -d ' \r\n')")

    _c5greg=$(run_at "AT+C5GREG?")
    F_REG_NR=$(json_num "$(printf '%s' "$_c5greg" | grep '+C5GREG:' | sed 's/+C5GREG: //' | cut -d',' -f2 | tr -d ' \r\n')")

    _creg=$(run_at "AT+CREG?")
    F_REG_CREG=$(json_num "$(printf '%s' "$_creg" | grep '+CREG:' | sed 's/+CREG: //' | cut -d',' -f2 | tr -d ' \r\n')")
}

# RM520N-GL reports RSRP/RSRQ/SINR with the RAT tag at the END of the
# line (e.g. "+QRSRP: -101,-99,-140,-140,LTE"), confirmed live — not at
# the start, which is the more commonly documented format for other
# Quectel modules.
collect_signal() {
    F_LTE_RSRP="null"; F_LTE_RSRQ="null"; F_LTE_SINR="null"
    F_NR_RSRP="null";  F_NR_RSRQ="null";  F_NR_SINR="null"

    _rsrp=$(run_at "AT+QRSRP")
    F_LTE_RSRP=$(json_num "$(printf '%s' "$_rsrp" | grep '+QRSRP:.*,LTE' | sed 's/+QRSRP: //; s/,LTE$//' | cut -d',' -f1 | tr -d ' \r\n')")
    F_NR_RSRP=$(json_num "$(printf '%s' "$_rsrp" | grep '+QRSRP:.*,NR5G' | sed 's/+QRSRP: //; s/,NR5G$//' | cut -d',' -f1 | tr -d ' \r\n')")

    _rsrq=$(run_at "AT+QRSRQ")
    F_LTE_RSRQ=$(json_num "$(printf '%s' "$_rsrq" | grep '+QRSRQ:.*,LTE' | sed 's/+QRSRQ: //; s/,LTE$//' | cut -d',' -f1 | tr -d ' \r\n')")
    F_NR_RSRQ=$(json_num "$(printf '%s' "$_rsrq" | grep '+QRSRQ:.*,NR5G' | sed 's/+QRSRQ: //; s/,NR5G$//' | cut -d',' -f1 | tr -d ' \r\n')")

    _sinr=$(run_at "AT+QSINR")
    F_LTE_SINR=$(json_num "$(printf '%s' "$_sinr" | grep '+QSINR:.*,LTE' | sed 's/+QSINR: //; s/,LTE$//' | cut -d',' -f1 | tr -d ' \r\n')")
    F_NR_SINR=$(json_num "$(printf '%s' "$_sinr" | grep '+QSINR:.*,NR5G' | sed 's/+QSINR: //; s/,NR5G$//' | cut -d',' -f1 | tr -d ' \r\n')")
}

# Only the well-established leading QENG "servingcell" fields are parsed
# (state, RAT, duplex, MCC, MNC, cellID, PCID, EARFCN, band, TAC).
# Trailing fields (RSRP/RSRQ/RSSI/SINR/CQI/TA/...) are ambiguous across
# firmware revisions and are skipped here — collect_signal()'s dedicated
# QRSRP/QRSRQ/QSINR commands are the trusted source for those instead.
collect_serving_cell() {
    F_CELL_STATE="null"; F_CELL_RAT="null"
    F_CELL_MCC="null"; F_CELL_MNC="null"; F_CELL_ID="null"
    F_CELL_PCID="null"; F_CELL_EARFCN="null"; F_CELL_BAND="null"; F_CELL_TAC="null"

    _serv=$(run_at 'AT+QENG="servingcell"')
    _line=$(printf '%s' "$_serv" | grep '+QENG:.*"servingcell"' | head -1)
    [ -z "$_line" ] && return

    _state=$(printf '%s' "$_line" | sed 's/.*"servingcell","//' | cut -d'"' -f1)
    F_CELL_STATE=$(json_str "$_state")

    _rat=""
    if printf '%s' "$_line" | grep -qE '"NR5G-SA"'; then _rat="NR5G-SA"
    elif printf '%s' "$_line" | grep -qE '"NR5G-NSA"|"NR5G"'; then _rat="NR5G-NSA"
    elif printf '%s' "$_line" | grep -qE '"LTE"'; then _rat="LTE"
    fi
    F_CELL_RAT=$(json_str "$_rat")

    [ "$_rat" = "LTE" ] || return

    # Rest of line after the 4th quoted field ("servingcell","STATE","LTE","FDD"/"TDD"):
    # MCC,MNC,cellID,PCID,EARFCN,band,ul_bw,dl_bw,TAC,...
    _rest=$(printf '%s' "$_line" | sed 's/.*"LTE","[A-Z]*",//')
    F_CELL_MCC=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f1 | tr -d ' \r\n')")
    F_CELL_MNC=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f2 | tr -d ' \r\n')")
    F_CELL_ID=$(json_str     "$(printf '%s' "$_rest" | cut -d',' -f3 | tr -d ' \r\n')")
    F_CELL_PCID=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f4 | tr -d ' \r\n')")
    F_CELL_EARFCN=$(json_str "$(printf '%s' "$_rest" | cut -d',' -f5 | tr -d ' \r\n')")
    F_CELL_BAND=$(json_str   "$(printf '%s' "$_rest" | cut -d',' -f6 | tr -d ' \r\n')")
    F_CELL_TAC=$(json_str    "$(printf '%s' "$_rest" | cut -d',' -f9 | tr -d ' \r\n')")
}

collect_carrier() {
    F_CARRIER_NAME="null"; F_CARRIER_ACT="null"; F_CARRIER_PLMN="null"
    _cops=$(run_at "AT+COPS?")
    F_CARRIER_NAME=$(json_str "$(printf '%s' "$_cops" | grep '+COPS:' | cut -d'"' -f2)")
    F_CARRIER_ACT=$(json_num "$(printf '%s' "$_cops" | grep '+COPS:' | awk -F',' '{print $NF}' | tr -d ' \r\n')")

    _qspn=$(run_at "AT+QSPN")
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
collect_carrier_aggregation() {
    F_CA_COUNT="0"
    F_CA_BANDS="[]"
    F_CA_TOTAL_BW_MHZ="0"
    F_CA_DL_EST_MBPS="null"
    F_CA_DL_MAX_MBPS="null"

    _ca=$(run_at "AT+QCAINFO")
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
        if printf '%s' "$_band" | grep -q "NR5G"; then
            _pci=$(printf '%s' "$_r" | cut -d',' -f5)
            _rsrp=$(printf '%s' "$_r" | cut -d',' -f6)
            _rsrq=$(printf '%s' "$_r" | cut -d',' -f7)
            _sinr=""
        else
            _pci=$(printf '%s' "$_r" | cut -d',' -f6)
            _rsrp=$(printf '%s' "$_r" | cut -d',' -f7)
            _rsrq=$(printf '%s' "$_r" | cut -d',' -f8)
            _sinr=$(printf '%s' "$_r" | cut -d',' -f10)
        fi
        [ "$_first" -eq 1 ] || _raw="${_raw},"
        _raw="${_raw}{\"type\":$(json_str "$_type"),\"band\":$(json_str "$_band"),\"earfcn\":$(json_str "$_earfcn"),\"bandwidth\":$(json_str "$_bw_raw"),\"pci\":$(json_str "$_pci"),\"rsrp\":$(json_num "$_rsrp"),\"rsrq\":$(json_num "$_rsrq"),\"sinr\":$(json_num "$_sinr")}"
        _first=0
        _count=$(( _count + 1 ))
    done
    IFS="$_oldifs"
    F_CA_COUNT="$_count"
    [ "$_count" -eq 0 ] && return
    _raw="${_raw}]"
    F_CA_BANDS="$_raw"

    _result=$(compute_ca_throughput "$_raw")
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
# scan needed. MIMO layer count isn't polled here either — QuecControl
# hardcodes 2 layers regardless of detected MIMO, so this does too.
#
# Computed here (not in app.js) so any page can bind to
# ca_dl_estimated_mbps / ca_dl_maximum_mbps / ca_total_bw_mhz, or a given
# carrier's dl_estimated_mbps / dl_maximum_mbps, via a plain data-field —
# no per-page throughput math needed.
#
# Input:  $1 = carriers JSON array, as built by collect_carrier_aggregation
# Output: 4 lines on stdout —
#   1. carriers JSON array, each object gaining bw_mhz/dl_estimated_mbps/
#      dl_maximum_mbps
#   2. aggregate estimated downlink, Mbps, rounded up to the nearest 10
#   3. aggregate maximum downlink, Mbps, rounded up to the nearest 10
#   4. aggregate bandwidth, MHz
compute_ca_throughput() {
    printf '%s' "$1" | awk \
        -v fb_lte_sinr="${F_LTE_SINR:-null}" \
        -v fb_nr_sinr="${F_NR_SINR:-null}" \
        -v fb_lte_rsrq="${F_LTE_RSRQ:-null}" \
        -v fb_nr_rsrq="${F_NR_RSRQ:-null}" \
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
        SCHED_EFF = 0.75
        PROTO_EFF = 0.70
        TDD_DL    = 0.70
        total_est = 0; total_max = 0; total_bw = 0
        out = "["
    }
    {
        gsub(/^\[/, ""); gsub(/\]$/, "")
        n = split($0, carriers, /\},\{/)
        for (i = 1; i <= n; i++) {
            rec = carriers[i]
            if (substr(rec, 1, 1) != "{") rec = "{" rec
            if (substr(rec, length(rec), 1) != "}") rec = rec "}"

            type_str = json_field(rec, "type")
            band_str = json_field(rec, "band")
            earfcn   = json_field(rec, "earfcn")
            bw_raw   = json_field(rec, "bandwidth")
            pci      = json_field(rec, "pci")
            rsrp     = json_field(rec, "rsrp")
            rsrq_f   = json_field(rec, "rsrq")
            sinr_f   = json_field(rec, "sinr")

            is_nr = (index(band_str, "NR5G") > 0)
            bw = is_nr ? nr_bw_mhz(bw_raw) : lte_bw_mhz(bw_raw)

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

            layers = 2
            se_est = is_nr ? nr_se(sinr) : lte_se(sinr)
            se_max = is_nr ? nr_se(35)   : lte_se(30)

            est = 0; max = 0
            if (bw > 0) {
                est = se_est * bw * layers * SCHED_EFF * PROTO_EFF
                max = se_max * bw * layers * SCHED_EFF * PROTO_EFF
                if (is_nr) {
                    band_num = 0; s = band_str
                    while (match(s, /[0-9]+/)) {
                        band_num = substr(s, RSTART, RLENGTH) + 0
                        s = substr(s, RSTART + RLENGTH)
                    }
                    if (nr_is_tdd(band_num)) { est = est * TDD_DL; max = max * TDD_DL }
                }
                est = est * rsrq_penalty(rsrq)
                total_bw += bw
            }
            total_est += est
            total_max += max
            c_est = int(est + 0.5)
            c_max = int(max + 0.5)

            if (i > 1) out = out ","
            out = out "{\"type\":\"" type_str "\",\"band\":\"" band_str "\""
            out = out ",\"earfcn\":" (earfcn == "" ? "null" : "\"" earfcn "\"")
            out = out ",\"bandwidth\":" (bw_raw == "" ? "null" : "\"" bw_raw "\"")
            out = out ",\"bw_mhz\":" (bw > 0 ? bw : "null")
            out = out ",\"pci\":" (pci == "" ? "null" : "\"" pci "\"")
            out = out ",\"rsrp\":" (rsrp == "" ? "null" : rsrp)
            out = out ",\"rsrq\":" (rsrq_f == "" ? "null" : rsrq_f)
            out = out ",\"sinr\":" (numish(sinr_f) ? sinr_f : "null")
            out = out ",\"dl_estimated_mbps\":" c_est
            out = out ",\"dl_maximum_mbps\":" c_max
            out = out "}"
        }
    }
    END {
        out = out "]"
        print out
        est10 = int((total_est + 9.999) / 10) * 10
        max10 = int((total_max + 9.999) / 10) * 10
        if (est10 < 0) est10 = 0
        if (max10 < 0) max10 = 0
        print est10
        print max10
        print total_bw
    }
    '
}

collect_band_pref() {
    F_BAND_PREF_LTE="null"; F_BAND_PREF_NR5G="null"
    _lte=$(run_at 'AT+QNWPREFCFG="lte_band"')
    F_BAND_PREF_LTE=$(json_str "$(printf '%s' "$_lte" | grep '+QNWPREFCFG:' | sed 's/.*"lte_band",//' | tr -d ' \r\n')")

    _nr=$(run_at 'AT+QNWPREFCFG="nr5g_band"')
    F_BAND_PREF_NR5G=$(json_str "$(printf '%s' "$_nr" | grep '+QNWPREFCFG:' | sed 's/.*"nr5g_band",//' | tr -d ' \r\n')")
}

# WAN state for PDP context 1 (the primary/default context on this
# hardware — "broadband" APN, confirmed live). Context 3 ("sos") is
# emergency-only and deliberately not surfaced.
collect_wan() {
    F_WAN_APN="null"; F_WAN_IP="null"; F_WAN_ACTIVE="false"
    F_WAN_IP_TYPE="null"; F_WAN_IPV6="null"
    F_WAN_DATA_TX="null"; F_WAN_DATA_RX="null"

    _dcont=$(run_at "AT+CGDCONT?")
    _dcont_line=$(printf '%s' "$_dcont" | grep '^+CGDCONT: 1,')
    F_WAN_APN=$(json_str "$(printf '%s' "$_dcont_line" | cut -d',' -f3 | tr -d '"\r\n')")
    F_WAN_IP_TYPE=$(json_str "$(printf '%s' "$_dcont_line" | cut -d',' -f2 | tr -d '"\r\n')")

    _addr=$(run_at "AT+CGPADDR")
    _addr_line=$(printf '%s' "$_addr" | grep '^+CGPADDR: 1,')
    F_WAN_IP=$(json_str "$(printf '%s' "$_addr_line" | cut -d',' -f2 | tr -d '"\r\n')")
    F_WAN_IPV6=$(json_str "$(ipv6_from_octets "$(printf '%s' "$_addr_line" | cut -d',' -f3 | tr -d '"\r\n')")")

    _act=$(run_at "AT+CGACT?")
    _stat=$(printf '%s' "$_act" | grep '^+CGACT: 1,' | cut -d',' -f2 | tr -d ' \r\n')
    F_WAN_ACTIVE=$(json_bool "$_stat")

    # +QGDCNT: <tx_bytes>,<rx_bytes> — cumulative since last AT+QGDCNT=0
    # reset (or module boot), confirmed live.
    _gdcnt=$(run_at "AT+QGDCNT?")
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

    # Confirmed live: AT+QMAP="LANIP",? returns ERROR on this hardware —
    # the bare form (no ,?), same as MPDN_rule/DHCPV4DNS below, is the
    # actual query. Response: +QMAP: "LANIP",<start>,<end>,<gateway>
    # (no quotes around the IPs, unlike QuecControl's documented example).
    _lanip=$(run_at 'AT+QMAP="LANIP"')
    _lanip_line=$(printf '%s' "$_lanip" | grep '+QMAP: "LANIP"' | head -1 | sed 's/.*"LANIP",//')
    if [ -n "$_lanip_line" ]; then
        F_LAN_DHCP_START=$(json_str "$(printf '%s' "$_lanip_line" | cut -d',' -f1 | tr -d '" \r\n')")
        F_LAN_DHCP_END=$(json_str   "$(printf '%s' "$_lanip_line" | cut -d',' -f2 | tr -d '" \r\n')")
        F_LAN_ROUTER_IP=$(json_str  "$(printf '%s' "$_lanip_line" | cut -d',' -f3 | tr -d '" \r\n')")
    fi

    # +QMAP: "MPDN_rule",<rule>,<profile>,<vlan>,<ippt_mode>,<autoconn>[,"<mac>"]
    _mpdn=$(run_at 'AT+QMAP="MPDN_rule"')
    _mpdn_line=$(printf '%s' "$_mpdn" | grep '^+QMAP: "MPDN_rule",0,' | head -1 | sed 's/.*"MPDN_rule",//')
    _ippt=$(printf '%s' "$_mpdn_line" | cut -d',' -f4 | tr -d ' \r\n')
    case "$_ippt" in
        1) F_LAN_MODE=$(json_str "IP Passthrough")
           F_LAN_MPDN_MAC=$(json_str "$(printf '%s' "$_mpdn_line" | cut -d',' -f6 | tr -d '" \r\n')") ;;
        0) F_LAN_MODE=$(json_str "NAT") ;;
    esac

    _dns=$(run_at 'AT+QMAP="DHCPV4DNS"')
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
  "device_temps": ${F_TEMPS},
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
  "cell_state": ${F_CELL_STATE},
  "cell_rat": ${F_CELL_RAT},
  "cell_mcc": ${F_CELL_MCC},
  "cell_mnc": ${F_CELL_MNC},
  "cell_id": ${F_CELL_ID},
  "cell_pcid": ${F_CELL_PCID},
  "cell_earfcn": ${F_CELL_EARFCN},
  "cell_band": ${F_CELL_BAND},
  "cell_tac": ${F_CELL_TAC},
  "carrier_name": ${F_CARRIER_NAME},
  "carrier_act": ${F_CARRIER_ACT},
  "carrier_plmn": ${F_CARRIER_PLMN},
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

log_op "Starting — interval=${POLL_INTERVAL}s log_level=${LOG_LEVEL}"

_cycle=0

# -- Main loop ------------------------------------------------------------
while true; do
    _start=$(date +%s)
    _cycle=$(( _cycle + 1 ))
    [ $(( _cycle % 20 )) -eq 0 ] && rotate_log

    collect_device
    collect_sim
    collect_registration
    collect_signal
    collect_serving_cell
    collect_carrier
    collect_carrier_aggregation
    collect_band_pref
    collect_wan
    collect_lan

    _end=$(date +%s)
    write_state "$_start" "$(( _end - _start ))"
    log_dbg "Cycle ${_cycle} done in $(( _end - _start ))s"

    _elapsed=$(( _end - _start ))
    _remaining=$(( POLL_INTERVAL - _elapsed ))
    [ "$_remaining" -lt 1 ] && _remaining=1
    sleep "$_remaining"
done
