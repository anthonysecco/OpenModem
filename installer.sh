#!/bin/sh
# OpenModem Installer
# Downloads and installs from GitHub, replacing any prior QuecControl,
# SimpleAdmin, or OpenModem install on the device.
# Usage: curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/main/installer.sh | sh
#
# Same shape as QuecControl's installer.sh: stop/remove whatever's already
# running, lay down fresh files under INSTALL_DIR, generate systemd units,
# start services. Also used as the "Update" action on the System page —
# re-running this script is how an update happens (see
# www/cgi-bin/update.sh).

REPO="https://raw.githubusercontent.com/anthonysecco/OpenModem/main"
INSTALL_DIR="/usrdata/openmodem"
CONFIG_DIR="$INSTALL_DIR/config"
CONF_FILE="$CONFIG_DIR/openmodem.conf"

echo "==============================="
echo "  OpenModem Installer"
echo "==============================="
echo ""

# --- Remove other/prior installs ---
# QuecControl and OpenModem service/path names are confirmed (this repo's
# own installer, and QuecControl's, both cleaned up their predecessor).
# The SimpleAdmin names below are a best-effort guess at its conventions
# and have NOT been verified against a real SimpleAdmin install — check
# `systemctl list-units`/`ls /usrdata` on a device that has it installed
# and correct these if they don't match.
echo "[1/6] Removing existing installs (QuecControl, SimpleAdmin, OpenModem)..."

for svc in \
    queccontrol-poller queccontrol-init queccontrol-broker queccontrol-httpd \
    quecmanager-broker quecmanager-httpd \
    simpleadmin-poller simpleadmin-broker simpleadmin-httpd simpleadmin \
    openmodem-poller openmodem-broker openmodem-httpd
do
    systemctl stop "$svc" 2>/dev/null
    systemctl disable "$svc" 2>/dev/null
done

rm -f /etc/systemd/system/queccontrol-*.service
rm -f /etc/systemd/system/quecmanager-*.service
rm -f /etc/systemd/system/simpleadmin*.service
rm -f /etc/systemd/system/openmodem-*.service
rm -f /lib/systemd/system/queccontrol-*.service
rm -f /lib/systemd/system/quecmanager-*.service
rm -f /lib/systemd/system/simpleadmin*.service
rm -f /lib/systemd/system/openmodem-*.service
rm -f /lib/systemd/system/multi-user.target.wants/queccontrol-*.service
rm -f /lib/systemd/system/multi-user.target.wants/quecmanager-*.service
rm -f /lib/systemd/system/multi-user.target.wants/simpleadmin*.service
rm -f /lib/systemd/system/multi-user.target.wants/openmodem-*.service
rm -f /etc/systemd/system/multi-user.target.wants/queccontrol-*.service
rm -f /etc/systemd/system/multi-user.target.wants/quecmanager-*.service
rm -f /etc/systemd/system/multi-user.target.wants/simpleadmin*.service
rm -f /etc/systemd/system/multi-user.target.wants/openmodem-*.service

if [ -f /etc/init.d/queccontrol ]; then
    /etc/init.d/queccontrol stop 2>/dev/null
    rm -f /etc/init.d/queccontrol /etc/rc.d/S99queccontrol /etc/rc.d/K10queccontrol
fi
if [ -f /etc/init.d/simpleadmin ]; then
    /etc/init.d/simpleadmin stop 2>/dev/null
    rm -f /etc/init.d/simpleadmin /etc/rc.d/S99simpleadmin /etc/rc.d/K10simpleadmin
fi

systemctl daemon-reload 2>/dev/null

pkill -f "httpd.*8080"      2>/dev/null
pkill -f "at_broker.sh"     2>/dev/null
pkill -f "at_poller.sh"     2>/dev/null

rm -f  /tmp/at_request
rm -rf /tmp/at_responses
rm -f  /tmp/at_broker.log*
rm -rf /tmp/queccontrol
rm -rf /tmp/simpleadmin
rm -rf /tmp/openmodem

# Preserve openmodem.conf across an update: stash it, restore after the
# fresh directories are created below.
_conf_backup=""
if [ -f "$CONF_FILE" ]; then
    _conf_backup="/tmp/openmodem.conf.preserved"
    cp "$CONF_FILE" "$_conf_backup"
fi

rm -rf "$INSTALL_DIR"
rm -rf "/usrdata/quecmanager"
rm -rf "/usrdata/simpleadmin"

echo "  Done."

# --- Create directories ---
echo "[2/6] Creating directories..."
mkdir -p "$INSTALL_DIR/bin"
mkdir -p "$INSTALL_DIR/www/cgi-bin"
mkdir -p "$CONFIG_DIR"
if [ -n "$_conf_backup" ]; then
    mv "$_conf_backup" "$CONF_FILE"
fi
echo "  Done."

# --- Download files ---
echo "[3/6] Downloading files from GitHub..."

download() {
    _url="$1"
    _dest="$2"
    echo "    $_dest"
    curl -fsSL -o "$_dest" "$_url"
    if [ $? -ne 0 ]; then
        echo "  ERROR: Failed to download $_url"
        return 1
    fi
    return 0
}

FAIL=0

echo "  Downloading bin scripts..."
for script in at_broker.sh at_poller.sh; do
    download "$REPO/bin/$script" "$INSTALL_DIR/bin/$script" || FAIL=1
done

echo "  Downloading web pages..."
for page in style.css app.js index.html cellular.html sim.html wan.html lan.html system.html; do
    download "$REPO/www/$page" "$INSTALL_DIR/www/$page" || FAIL=1
done

echo "  Downloading CGI scripts..."
for cgi in state.sh update.sh; do
    download "$REPO/www/cgi-bin/$cgi" "$INSTALL_DIR/www/cgi-bin/$cgi" || FAIL=1
done

echo "  Downloading config files..."
# Only download openmodem.conf if one does not already exist (preserved
# above) — an existing file means this is an update, keep the operator's
# settings.
if [ -f "$CONF_FILE" ]; then
    echo "    Preserved existing $CONF_FILE"
else
    download "$REPO/config/openmodem.conf" "$CONF_FILE" || FAIL=1
fi

download "$REPO/installer.sh" "$INSTALL_DIR/installer.sh" || FAIL=1

if [ "$FAIL" = "1" ]; then
    echo ""
    echo "ERROR: One or more required files failed to download."
    echo "Check your internet connection and try again."
    exit 1
fi

echo "  Setting permissions..."
chmod +x "$INSTALL_DIR/bin/"*.sh
chmod +x "$INSTALL_DIR/www/cgi-bin/"*.sh
chmod +x "$INSTALL_DIR/installer.sh"
chmod 755 "$INSTALL_DIR/www/cgi-bin"
echo "  Done."

# --- Create systemd service files ---
echo "[4/6] Creating systemd service files..."

cat > /tmp/openmodem-broker.service << 'EOF'
[Unit]
Description=OpenModem AT Command Broker
After=local-fs.target network.target

[Service]
Type=simple
ExecStart=/bin/sh /usrdata/openmodem/bin/at_broker.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /tmp/openmodem-poller.service << 'EOF'
[Unit]
Description=OpenModem AT State Poller
After=openmodem-broker.service
Requires=openmodem-broker.service

[Service]
Type=simple
ExecStartPre=/bin/sh -c '\
    i=0; \
    while [ ! -p /tmp/at_request ] && [ "$i" -lt 20 ]; do \
        sleep 1; i=$((i+1)); \
    done; \
    [ -p /tmp/at_request ] || { echo "OpenModem poller: broker FIFO timeout"; exit 1; }'
ExecStart=/bin/sh /usrdata/openmodem/bin/at_poller.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /tmp/openmodem-httpd.service << 'EOF'
[Unit]
Description=OpenModem Web Server
After=openmodem-poller.service network.target
Requires=openmodem-broker.service

[Service]
Type=simple
ExecStart=/bin/busybox httpd -f -p 8080 -h /usrdata/openmodem/www
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "  Service files created."

# --- Install systemd services ---
echo "[5/6] Installing systemd autostart..."

echo "  Remounting / as read-write..."
mount -o remount,rw /

echo "  Installing service files to /lib/systemd/system/..."
cp /tmp/openmodem-broker.service /lib/systemd/system/
cp /tmp/openmodem-poller.service /lib/systemd/system/
cp /tmp/openmodem-httpd.service  /lib/systemd/system/

systemctl daemon-reload

echo "  Creating autostart symlinks..."
ln -sf /lib/systemd/system/openmodem-broker.service /lib/systemd/system/multi-user.target.wants/
ln -sf /lib/systemd/system/openmodem-poller.service /lib/systemd/system/multi-user.target.wants/
ln -sf /lib/systemd/system/openmodem-httpd.service  /lib/systemd/system/multi-user.target.wants/

echo "  Remounting / as read-only..."
mount -o remount,ro /

rm -f /tmp/openmodem-broker.service
rm -f /tmp/openmodem-poller.service
rm -f /tmp/openmodem-httpd.service

# --- Start services ---
echo "[6/6] Starting services..."

systemctl start openmodem-broker.service

echo "  Waiting for AT broker FIFO..."
i=0
while [ ! -p /tmp/at_request ] && [ "$i" -lt 15 ]; do
    sleep 1
    i=$(( i + 1 ))
done
if [ -p /tmp/at_request ]; then
    echo "  AT broker ready."
else
    echo "  WARNING: AT broker FIFO not detected."
fi

systemctl start openmodem-poller.service

echo "  Waiting for poller to seed initial state..."
i=0
while [ ! -f /tmp/openmodem/state_merged.json ] && [ "$i" -lt 30 ]; do
    sleep 1
    i=$(( i + 1 ))
done
if [ -f /tmp/openmodem/state_merged.json ]; then
    echo "  Poller ready."
else
    echo "  WARNING: Poller state not ready — httpd will start anyway."
fi

systemctl start openmodem-httpd.service
echo "  Done."

# --- Verify ---
echo ""
echo "==============================="
echo "  Installation Complete"
echo "==============================="
echo ""
echo "  Web UI: http://192.168.225.1:8080"
echo ""

sleep 2

if netstat -tlnp 2>/dev/null | grep -q ":8080" || systemctl is-active --quiet openmodem-httpd.service; then
    echo "  OK Web UI:  RUNNING"
else
    echo "  FAIL Web UI: FAILED"
fi

if pgrep -f "at_broker.sh" > /dev/null; then
    echo "  OK Broker:  RUNNING"
else
    echo "  FAIL Broker: FAILED"
fi

if pgrep -f "at_poller.sh" > /dev/null; then
    echo "  OK Poller:  RUNNING"
else
    echo "  FAIL Poller: FAILED"
fi

echo ""
echo "  Start:   systemctl start openmodem-broker.service openmodem-poller.service openmodem-httpd.service"
echo "  Stop:    systemctl stop openmodem-httpd.service openmodem-poller.service openmodem-broker.service"
echo "  Restart: systemctl restart openmodem-broker.service openmodem-poller.service openmodem-httpd.service"
echo "  Status:  systemctl status openmodem-broker.service openmodem-poller.service openmodem-httpd.service"
