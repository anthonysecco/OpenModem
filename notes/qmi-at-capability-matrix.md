# RM520N-GL capability matrix — QMI vs AT

Every data item and control action, mapped to its QMI message and its AT command, and
marked by which transport can reach it: **Both**, **QMI-only**, or **AT-only**.

- **R/W**: `R` read/query (safe) · `W` state-changing write · `A` action.
- **Validated**: confirmed live on this unit = the signal in Notes; otherwise the row is
  from libqmi / Quectel's AT manual and needs on-device confirmation.
- `⚠` = disruptive or destructive (re-registration, data drop, persistent, irreversible).
- QMI runs over QRTR (AF_QIPCRTR), services on node 3: NAS=3, WDS=1, DMS=2, QoS=4.
  Message framing: u8 flags, u16 txn LE, u16 msg-id LE, u16 tlv-len LE, then TLVs.

## Device identity & health

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| IMEI | DMS Get IDs 0x25 | AT+GSN | Both | R | AT validated |
| Firmware revision | DMS Get Revision 0x23 | AT+QGMR / ATI | Both | R | AT validated |
| Manufacturer / model | DMS 0x21 / 0x22 | ATI | Both | R | AT validated |
| Own number (MSISDN) | DMS Get MSISDN 0x24 | AT+CNUM | Both | R | often empty (SIM EF-MSISDN) |
| Supported bands | DMS Get Band Caps 0x45 | AT+QNWPREFCFG="policy_band" | Both | R | source for a band-lock UI's allowed set |
| Modem temperature | — | AT+QTEMP | AT-only | R | AP thermal zones also in sysfs |
| Thermal throttle state | — | — | sysfs (AP) | R | cooling devices + CPU freq cap; see architecture-decisions.md Finding A |
| Modem clock / net time | DMS Get Time 0x2F | AT+CCLK? / AT+QLTS | Both | R | |
| Supported-message introspection | Get Supported Messages 0x1E | — | QMI-only | R | run per service before trusting a QMI row |

## SIM

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| SIM / PIN state | UIM Get Card Status 0x2F | AT+CPIN? | Both | R | AT validated |
| IMSI | UIM Read Transparent 0x20 (EF 6F07) | AT+CIMI | Both | R | AT validated |
| ICCID | UIM Read Transparent 0x20 (EF 2FE2) | AT+QCCID | Both | R | AT validated |
| Active SIM slot (read) | UIM Get Slot Status 0x46 | AT+QUIMSLOT? | Both | R | AT validated |
| Switch SIM slot | UIM Switch Slot 0x45 | AT+QUIMSLOT=n | Both | A | ⚠ drops service, re-registers; empty slot = no service |
| Enter PIN | UIM Verify PIN 0x26 | AT+CPIN=pin | Both | W | ⚠ 3 wrong = PUK lock; never auto-retry |
| Enable / change PIN | UIM 0x25 / 0x28 | AT+CLCK / AT+CPWD | Both | W | ⚠ SIM-persistent; retry risk |
| PIN retry counters | UIM Get Card Status 0x2F | AT+QPINC? | Both | R | |
| Raw SIM file access | UIM Read Transparent/Record 0x20/0x21 | AT+CRSM | Both | R | ⚠ write variants can corrupt card files |

## Registration · operator · signal · cells

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| Registration state (LTE/NR/CS) | NAS Serving System 0x24 / System Info 0x4D | AT+CEREG? / C5GREG? / CREG? | Both | R | QMI+AT validated; 0x4D richer per-RAT |
| PLMN + operator name | NAS 0x24 TLV 0x12 | AT+COPS? | Both | R | QMI+AT validated |
| Service provider name (SPN) | NAS Get Operator Name 0x39 | AT+QSPN | Both | R | AT validated |
| Roaming indicator | NAS 0x24 TLV 0x10 | AT+CEREG? (stat 5) | Both | R | QMI+AT validated |
| Signal RSRP/RSRQ/SINR/RSSI | NAS Get Signal Info 0x4F | AT+QRSRP / QRSRQ / QSINR | Both | R | QMI = 1/RAT; AT = per-antenna. Both validated |
| Per-antenna RX power | NAS Get Tx/Rx Info 0x5A | AT+QRSRP | Both | R | verify 0x5A accepts NR iface |
| Serving cell (PCI/EARFCN/TAC/cellid/band) | NAS Cell Location 0x43 / RF Band 0x31 | AT+QENG="servingcell" | Both | R | QMI+AT validated; 0x31 uses a QMI band enum |
| Neighbour cells | NAS 0x43 intra/inter-freq arrays | AT+QENG="neighbourcell" | Both | R | QMI validated |
| LTE CA per-SCC (PCI/EARFCN/BW/state) | NAS Get LTE CPHY CA 0xAC | AT+QCAINFO | Both | R | QMI+AT validated. **0x4D is NOT CA info** |
| NR carrier aggregation / NR SCCs | — | AT+QCAINFO | AT-only | R | AT validated; no QMI msg found |
| MIMO layers per CC | — | AT+QNWCFG="lte_mimo_info" / "nr5g_mimo_info" | AT-only | R | AT validated; proprietary; true rank DIAG-only |
| ENDC / NSA availability | NAS System Info 0x4D (NR TLVs) | AT+QENDC | Both | R | NR TLV numbers uncertain |
| LTE timing advance | NAS 0x43 TLV 0x1E | AT+QNWCFG="lte_time_advance" | Both | R | AT name uncertain |
| CQI / CSI (RI, PMI) | — | AT+QNWCFG="lte_csi" / "nr5g_csi" | AT-only | R | uncertain; test read-only first |
| Access tech / band summary | NAS RF Band Info 0x31 | AT+QNWINFO | Both | R | |
| Data-system status (NSA/SA/CA flags) | DSD Get System Status | — | QMI-only | R | uncertain; see libqmi dsd.json |
| Change push notifications | NAS/WDS/DMS indications | URCs (+CEREG:, +QIND:) | Both | R | QMI indications cleaner than the brokered /dev/smd11 |

## Network selection control

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| Network mode / RAT (read) | NAS Get SSP 0x34 TLV 0x11 | AT+QNWPREFCFG="mode_pref" | Both | R | mask: UMTS 0x08, LTE 0x10, NR 0x40 |
| Network mode / RAT (set) | NAS Set SSP 0x33 TLV 0x11 | AT+QNWPREFCFG="mode_pref",… | Both | W | ⚠ re-reg, data drop; QMI TLV 0x17=0 = non-persistent |
| LTE band lock | NAS Set SSP 0x33 TLV 0x15 | AT+QNWPREFCFG="lte_band",… | Both | W | ⚠ re-reg; B66/B71 need the extended TLV |
| NR band lock (SA/NSA) | NAS Set SSP 0x33 (NR band TLVs) | AT+QNWPREFCFG="nr5g_band" / "nsa_nr5g_band" | Both | W | ⚠ QMI TLV numbers uncertain |
| Disable SA or NSA | — | AT+QNWPREFCFG="nr5g_disable_mode" | AT-only | W | ⚠ 1=disable SA, 2=disable NSA; re-reg |
| Data roaming | NAS SSP 0x33/0x34 TLV 0x14 (or WDS profile) | AT+QNWCFG="data_roaming" / roam_pref | Both | W | ⚠ QMI↔AT mapping unverified; SSP 0x14 gates registration (broader) |
| Manual operator select | NAS SSP 0x33 TLV 0x16 / Init Net Reg 0x22 | AT+COPS=1,2,"plmn" | Both | A | ⚠ no service on a bad/forbidden PLMN |
| Operator scan | NAS Network Scan 0x21 | AT+COPS=? | Both | A | ~130 s; data stalls |
| Cell lock (PCI+EARFCN) | — | AT+QNWLOCK="common/4g" / "common/5g" | AT-only | W | ⚠ no service if the locked cell disappears |
| RAT acquisition order | NAS SSP 0x33 TLV 0x1E | AT+QNWPREFCFG="rat_acq_order" | Both | W | may trigger a re-scan |
| Service domain / usage | NAS SSP 0x33 TLV 0x18 / 0x22 | AT+QNWPREFCFG="srv_domain" / "ue_usage_setting" | Both | W | ⚠ PS detach drops data |
| PS attach / detach | NAS Attach Detach 0x23 | AT+CGATT=0/1 | Both | A | ⚠ detach drops all data |

## Operating mode & power

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| Read operating mode | DMS Get Operating Mode 0x2D | AT+CFUN? | Both | R | |
| Airplane mode on / off | DMS Set Operating Mode 0x2E (1 / 0) | AT+CFUN=4 / AT+CFUN=1 | Both | W | ⚠ drops all service; CFUN=0 also powers SIM down |
| Modem reset | DMS 0x2E (4) | AT+CFUN=1,1 | Both | A | ⚠ reboots the whole module + the on-board Linux + this UI |
| Power down | DMS 0x2E (5) | AT+QPOWD | Both | A | ⚠ may need a host-side power cycle |
| Factory reset | DMS Restore Factory Defaults 0x3A | AT&F / AT+QPRTPARA | Both | A | ⚠ destructive; the two don't reset the same things |

## Data connection · profiles · LAN

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| APN / profile list (read) | WDS Get Profile 0x2B / Get Profile List 0x2A | AT+CGDCONT? | Both | R | QMI+AT validated; QMI also returns auth/username |
| Change APN / IP type / auth | WDS Modify Profile 0x28 | AT+CGDCONT=… / AT+QICSGP | Both | W | ⚠ persistent; attach/active profile change = re-attach + data drop |
| Create / delete profile | WDS 0x27 / 0x29 | AT+CGDCONT=… | Both | W | ⚠ don't delete cid 1 or IMS/SOS contexts |
| WAN IP / DNS / MTU | WDS Get Current Settings 0x2D | AT+CGPADDR / AT+CGCONTRDP | Both | R | QMI needs WDS Bind Mux Data Port 0xA2 first (else error 15) |
| Data call / PDP state | WDS Get Packet Service Status 0x22 | AT+CGACT? | Both | R | AT validated |
| Connect / disconnect data | WDS Start/Stop Network 0x20/0x21 | AT+CGACT= / AT+QMAP="connect" | Both | A | ⚠ competes with Quectel's on-device connection manager |
| Byte counters | WDS Get Packet Statistics 0x24 | AT+QGDCNT? (=0 resets) | Both | R | QMI = current call; QGDCNT = cumulative |
| Channel rates / dormancy | WDS 0x23 / 0x30 | — | QMI-only | R | rates often nominal maxima |
| Bearer QoS (QCI / 5QI) | QoS service (ids uncertain) | AT+CGEQOSRDP / C5GQOSRDP | Both | R | live QCI needs mux bind; no dedicated bearer here (default QCI 9) |
| LAN IP / DHCP / DNS | — | AT+QMAP="LANIP" / "DHCPV4DNS" | AT-only | W | ⚠ no QMI; writes can cut the session in use |
| LAN clients | — | — (dnsmasq leases on AP) | AT-only | R | no QMI; needs its own on-device collector |
| Multi-PDN routing | — | AT+QMAP="MPDN_rule" | AT-only | W | ⚠ re-plumbs which PDN serves the LAN |
| Host interface mode | — | AT+QCFG="usbnet" / AT+QETH="rgmii" | AT-only | W | ⚠ changes how the host reaches the modem; reboot |
| Data-path format (QMAP aggregation) | WDA Get/Set Data Format 0x21/0x20 | — | QMI-only | W | ⚠ Set can break the data plane until reboot |
| Carrier MBN configuration | PDC service | AT+QMBNCFG | Both | W | ⚠ activating restarts the modem stack; changes provisioning |

## SMS & GNSS

| Capability | QMI | AT | Avail | R/W | Notes |
|---|---|---|---|---|---|
| List / read SMS | WMS List 0x31 / Raw Read 0x22 | AT+CMGL / CMGR | Both | R | check SCOPE.md before building on it |
| Send SMS | WMS Raw Send 0x20 | AT+CMGS | Both | A | ⚠ real, billable message |
| Delete SMS | WMS Delete 0x24 | AT+CMGD | Both | W | ⚠ irreversible; both have delete-all forms |
| SMSC address | WMS 0x34 / 0x35 | AT+CSCA | Both | W | ⚠ a wrong value breaks sending |
| Enable / disable GNSS | LOC service | AT+QGPS=1 / AT+QGPSEND | Both | A | LOC and Quectel's GPS engine may fight over ownership |
| GNSS position | LOC position-report indications | AT+QGPSLOC=mode | Both | R | errors until a fix exists |

## Classification summary

- **AT-only:** MIMO layers per CC · NR carrier aggregation · CSI/CQI · modem temperature
  (practically) · LAN IP/DHCP/clients/multi-PDN · host interface mode · cell lock ·
  SA/NSA disable.
- **QMI-only:** supported-message introspection (0x1E) · channel rates / dormancy ·
  data-path format (WDA) · data-system status (DSD) · non-persistent preference changes
  (SSP TLV 0x17=0 has no AT equivalent).
- **Both (QMI side validated here):** signal · serving/neighbour cells · LTE CA ·
  registration · PLMN/operator name · mode preference & band lock (message IDs) · profile
  read · WAN IP settings.
- **Neither (sysfs / on-device):** thermal throttling state · LAN client leases (dnsmasq).

## Caveats

Rows without a "validated" note are from libqmi / Quectel's AT manual, recalled rather
than re-checked — confirm each against `qmi-service-<svc>.json` and the on-device
`Get Supported Messages (0x1E)` bitmap (QMI) or a live query (AT) before relying on it.
Uncertain specifically: SSP TLV numbers for extended-LTE and NR band masks; which QMI
object `AT+QNWCFG="data_roaming"` maps to; the DSD and QoS message sets; several AT
sub-command names. Every `W`/`A` row changes modem state and most are persistent across
reboot — read the current value and write it back as a first test, and gate any control
action behind read-back-and-confirm.
