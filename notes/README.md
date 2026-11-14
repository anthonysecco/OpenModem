# Exploration notes

Field notes from an on-device exploration of the Quectel RM520N-GL (Qualcomm SDX65 /
sdxlemur) — what data and control the modem exposes beyond AT, and the architecture
decisions that came out of it. These are **notes, not shipped code**: a throwaway Go
collector was used to validate the QMI-over-QRTR data path, but the product deliberately
stays on AT + BusyBox shell (see below).

- **[architecture-decisions.md](architecture-decisions.md)** — the decisions and findings
  in brief: why production stays on **AT + shell** (not QMI/Go), why the web layer stays
  **BusyBox httpd + CGI** (not a Go daemon), plus findings on graduated thermal
  throttling, the DIAG dead-end, MIMO being AT-only, and the QMI control surface. **Start
  here.**
- **[qmi-at-capability-matrix.md](qmi-at-capability-matrix.md)** — every data item and
  control action mapped to its QMI message and AT command, marked **Both / QMI-only /
  AT-only**. The reference for future feature work.
- **[device-capabilities.md](device-capabilities.md)** — the fuller hardware/data/control
  survey: platform, data planes, QMI-over-QRTR validation, deep-RF analysis, and the DIAG
  investigation.

Headline: QMI + sysfs can match (and exceed) OpenModem's AT poller for almost everything,
**except MIMO layers (AT-only) and LAN clients (not QMI)** — but the supportability and
charter case keeps the product on AT/shell regardless.
