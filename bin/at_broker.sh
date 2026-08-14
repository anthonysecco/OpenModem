#!/bin/sh
# at_broker.sh — serializes AT command access to the modem's AT device.
#
# /dev/smd11 (or equivalent) is a raw character device, not a tty, so only
# one process may safely read/write it at a time. This daemon owns that
# device and serializes access for the poller and CGI scripts through a
# request/response FIFO:
#
#   Request  -> echo "req_id|timeout_s|AT+COMMAND" > /tmp/at_request
#   Response <- appears at /tmp/at_responses/<req_id>
#
# TODO: implement the read/write loop against AT_DEVICE (see
# config/openmodem.conf) and the request FIFO protocol described above.

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

echo "at_broker.sh: not yet implemented" >&2
exit 1
