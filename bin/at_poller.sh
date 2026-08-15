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

# +QCAINFO: "PCC"|"SCC",earfcn,bandwidth,"LTE BAND N",...  one line per
# active component carrier. Count > 1 means carrier aggregation is active.
collect_carrier_aggregation() {
    F_CA_COUNT="0"
    F_CA_BANDS="[]"
    _ca=$(run_at "AT+QCAINFO")
    _lines=$(printf '%s' "$_ca" | grep '^+QCAINFO:')
    [ -z "$_lines" ] && return

    _count=0
    _json="["
    _first=1
    _oldifs="$IFS"
    IFS='
'
    for _line in $_lines; do
        _band=$(printf '%s' "$_line" | grep -oE '"LTE BAND [0-9]+"' | tr -d '"')
        [ -z "$_band" ] && continue
        # First quoted field on the line is the component type, "PCC" or
        # "SCC" (primary/secondary component carrier).
        _type=$(printf '%s' "$_line" | sed 's/^+QCAINFO: "//; s/".*//')
        [ "$_first" -eq 1 ] || _json="${_json},"
        _json="${_json}{\"type\":$(json_str "$_type"),\"band\":$(json_str "$_band")}"
        _first=0
        _count=$(( _count + 1 ))
    done
    IFS="$_oldifs"
    F_CA_COUNT="$_count"
    F_CA_BANDS="${_json}]"
}

# +QENG: "neighbourcell intra"|"neighbourcell inter","LTE",<earfcn>,
# <pcid>,<rsrq>,<rsrp>,<rssi>,<sinr>,... — no band field, only EARFCN
# (band/nominal-frequency label is computed client-side in app.js, same
# split as every other display-only formatting in this project). On
# this hardware "inter" (different-frequency) neighbors commonly report
# "-" for every field but EARFCN — confirmed live — so entries are kept
# only when RSRP actually parses as a number, same filter QuecControl's
# own poller uses for the same reason.
collect_neighbor_cells() {
    F_NEIGHBOR_CELLS="[]"
    _nb=$(run_at 'AT+QENG="neighbourcell"')
    _lines=$(printf '%s' "$_nb" | grep '^+QENG: "neighbourcell')
    [ -z "$_lines" ] && return

    _json="["
    _first=1
    _oldifs="$IFS"
    IFS='
'
    for _line in $_lines; do
        _fields=$(printf '%s' "$_line" | sed 's/.*"LTE",//')
        _earfcn=$(printf '%s' "$_fields" | cut -d',' -f1 | tr -d ' \r\n')
        _pcid=$(printf '%s'   "$_fields" | cut -d',' -f2 | tr -d ' \r\n')
        _rsrq=$(printf '%s'   "$_fields" | cut -d',' -f3 | tr -d ' \r\n')
        _rsrp=$(printf '%s'   "$_fields" | cut -d',' -f4 | tr -d ' \r\n')

        printf '%s' "$_rsrp" | grep -qE '^-?[0-9]+$' || continue

        [ "$_first" -eq 1 ] || _json="${_json},"
        _json="${_json}{\"earfcn\":$(json_str "$_earfcn"),\"pcid\":$(json_str "$_pcid"),\"rsrq\":$(json_num "$_rsrq"),\"rsrp\":$(json_num "$_rsrp")}"
        _first=0
    done
    IFS="$_oldifs"
    F_NEIGHBOR_CELLS="${_json}]"
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
  "neighbor_cells": ${F_NEIGHBOR_CELLS},
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
    collect_neighbor_cells
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
