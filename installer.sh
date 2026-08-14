#!/bin/sh
# OpenModem installer — deploys bin/, config/, www/ onto the modem's
# filesystem and installs services for the broker, poller, and httpd.
#
# TODO: base this on QuecControl's installer.sh pattern once the service
# layout is finalized: create INSTALL_DIR under /usrdata, copy files,
# generate systemd (or init.d) unit files, then start services.

INSTALL_DIR="/usrdata/openmodem"

echo "OpenModem installer: not yet implemented"
exit 1
