#!/bin/sh
# at_poller.sh — periodically issues AT commands through at_broker.sh and
# writes merged state as JSON for the front end to read.
#
# Single POLL_INTERVAL (see config/openmodem.conf), not tiered — see
# SCOPE.md for what's actually polled and why.
#
# TODO: implement the poll loop and write merged state to
# /tmp/openmodem/state_merged.json.

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

echo "at_poller.sh: not yet implemented" >&2
exit 1
