#!/bin/sh
# OpenModem Installer
# Downloads and installs from GitHub, replacing any prior QuecControl,
# SimpleAdmin, SimpleFirewall, or OpenModem install on the device.
# Usage: curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/main/installer.sh | sh
#
# Same shape as QuecControl's installer.sh: stop/remove whatever's already
# running, lay down fresh files under INSTALL_DIR, generate systemd units,
# start services. Also used as the "Update" action on the System page —
# re-running this script is how an update happens (see
# www/cgi-bin/update.sh).
#
# REPO defaults to the main branch, but every file this script downloads
# (bin/www/cgi-bin, everything under "Downloading files from GitHub"
# below) comes from REPO — fetching *this script* from a commit-SHA URL
# does NOT pin those, since REPO itself was still hardcoded to main.
# Confirmed live: pinning only installer.sh's own URL kept serving a
# stale main-branch app.js for several minutes after a push, because
# raw.githubusercontent.com's branch URL has its own separate CDN cache
# from the SHA URL. Set OPENMODEM_INSTALL_REF to a full commit-SHA REPO
# URL to actually pin everything and skip that wait — env var has to be
# attached to the `sh` side of the pipe, not the `curl` side, since only
# the process actually running this script needs to see it:
#   curl -fsSL https://raw.githubusercontent.com/anthonysecco/OpenModem/<sha>/installer.sh \
#     | OPENMODEM_INSTALL_REF="https://raw.githubusercontent.com/anthonysecco/OpenModem/<sha>" sh
REPO="${OPENMODEM_INSTALL_REF:-https://raw.githubusercontent.com/anthonysecco/OpenModem/main}"
INSTALL_DIR="/usrdata/openmodem"
CONFIG_DIR="$INSTALL_DIR/config"
CONF_FILE="$CONFIG_DIR/openmodem.conf"

# Everything is downloaded here first and only swapped into INSTALL_DIR
# once every file has arrived successfully (step 4). Both dirs live on
# /usrdata (always-writable UBI volume, confirmed in CLAUDE.md's
# "Development" section), so the swap is a same-filesystem `mv` — a
# single rename(2), not a copy — same atomic write-then-rename pattern
# at_poller.sh/net_poller.sh already use for their own state files.
# Found the hard way: the previous version of this script removed the
# existing install *before* downloading anything, so any download
# failure (or the carrier connection dropping mid-update — a real
# scenario for a cellular modem) left the device with no admin UI and
# no clean way to recover except adb. Staging first means a failed
# download changes nothing observable — the old install keeps running.
STAGING_DIR="/usrdata/openmodem.new"
STAGING_CONFIG_DIR="$STAGING_DIR/config"
STAGING_CONF_FILE="$STAGING_CONFIG_DIR/openmodem.conf"

echo "==============================="
echo "  OpenModem Installer"
echo "==============================="
echo ""

# --- Secure the web UI port before touching any existing firewall ---
# Applied first, before anything else — including before removing
# SimpleFirewall's equivalent rule below — so port 8080 is never briefly
# unprotected mid-install. iptables rules are runtime kernel state, not
# filesystem, so this doesn't need the rw remount that follows. Same
# logic as bin/apply_iptables.sh (which re-applies this after every
# reboot); duplicated here in miniature only because it must run before
# that script even exists on disk. Idempotent (checked with -C before
# -A), safe on a reinstall/update.
echo "[1/7] Securing web UI port..."
for _if in bridge0 eth0 tailscale0; do
    iptables -C INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT 2>/dev/null || \
        iptables -A INPUT -i "$_if" -p tcp --dport 8080 -j ACCEPT
done
iptables -C INPUT -p tcp --dport 8080 -j DROP 2>/dev/null || \
    iptables -A INPUT -p tcp --dport 8080 -j DROP
echo "  Done."

# --- Download everything into a staging directory first ---
# Nothing about the existing install (old or otherwise) is touched in
# this step — a failure here (network drop, GitHub hiccup, a carrier
# connection blip) leaves the running install exactly as it was.
echo "[2/7] Downloading files to staging area..."

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/bin"
mkdir -p "$STAGING_DIR/www/cgi-bin"
mkdir -p "$STAGING_CONFIG_DIR"

# Preserve openmodem.conf across an update: if a config already exists
# from a prior install, copy it straight into staging now (the old
# install directory hasn't been removed yet, so it's still right there)
# rather than downloading a fresh default over an operator's settings.
_conf_preserved=0
if [ -f "$CONF_FILE" ]; then
    cp "$CONF_FILE" "$STAGING_CONF_FILE"
    _conf_preserved=1
fi

# Capture any existing SimpleFirewall TTL value before it's removed
# further down, so switching mechanisms doesn't silently reset an
# operator's TTL spoofing back to disabled. Read-only, so it's safe to
# do this early — applied to the staged openmodem.conf below.
_migrated_ttl=""
if [ -f /usrdata/simplefirewall/ttlvalue ]; then
    _migrated_ttl=$(grep -o '[0-9]\{1,3\}' /usrdata/simplefirewall/ttlvalue | head -1)
    echo "$_migrated_ttl" | grep -qE '^[0-9]+$' || _migrated_ttl=""
fi

download() {
    _url="$1"
    _dest="$2"
    echo "    $_dest"
    # -4: force IPv4. Confirmed live (2026-08-17, after a modem reset)
    # that this device's cellular WAN can reach raw.githubusercontent.com
    # over IPv4 in ~0.3-5s but times out over IPv6 (curl's default
    # Happy-Eyeballs racing doesn't fall back fast enough within a
    # single download's window) — github.com and objects.githubusercontent.com
    # both answered fine meanwhile, so this isn't a general outage, just
    # a broken/blackholed IPv6 path to Fastly's raw.githubusercontent.com
    # range specifically over this carrier connection. Forcing IPv4
    # sidesteps it rather than depending on Happy-Eyeballs recovering in time.
    # --max-time 30: a stalled/hung connection (not an outright refusal,
    # which -fsSL already handles) would otherwise block the rest of the
    # install indefinitely — bound each file to a generous but finite wait.
    curl -4 -fsSL --max-time 30 -o "$_dest" "$_url"
    if [ $? -ne 0 ]; then
        echo "  ERROR: Failed to download $_url"
        return 1
    fi
    return 0
}

FAIL=0

echo "  Downloading bin scripts..."
for script in at_broker.sh at_command.sh at_poller.sh apply_iptables.sh net_poller.sh; do
    download "$REPO/bin/$script" "$STAGING_DIR/bin/$script" || FAIL=1
done

echo "  Downloading web pages..."
for page in style.css app.js index.html cellular.html sim.html wan.html lan.html system.html; do
    download "$REPO/www/$page" "$STAGING_DIR/www/$page" || FAIL=1
done

echo "  Downloading CGI scripts..."
for cgi in state.sh update.sh at_cmd.sh band_lock.sh carrier_scan.sh lan_action.sh wan_action.sh internet_info.sh sim_action.sh network_action.sh net_state.sh history_signal.sh history_net.sh history_wan.sh ha_state.sh; do
    download "$REPO/www/cgi-bin/$cgi" "$STAGING_DIR/www/cgi-bin/$cgi" || FAIL=1
done

echo "  Downloading config files..."
if [ "$_conf_preserved" = "1" ]; then
    echo "    Preserved existing $CONF_FILE"
else
    download "$REPO/config/openmodem.conf" "$STAGING_CONF_FILE" || FAIL=1
fi

if [ -n "$_migrated_ttl" ] && [ "$_migrated_ttl" -gt 0 ]; then
    echo "    Migrating TTL value from SimpleFirewall ($_migrated_ttl)..."
    grep -v '^TTL_VALUE=' "$STAGING_CONF_FILE" > "${STAGING_CONF_FILE}.tmp" 2>/dev/null
    echo "TTL_VALUE=${_migrated_ttl}" >> "${STAGING_CONF_FILE}.tmp"
    mv "${STAGING_CONF_FILE}.tmp" "$STAGING_CONF_FILE"
fi

download "$REPO/installer.sh" "$STAGING_DIR/installer.sh" || FAIL=1

if [ "$FAIL" = "1" ]; then
    echo ""
    echo "ERROR: One or more required files failed to download."
    echo "Check your internet connection and try again."
    echo "Nothing on the device has been changed — the existing install is still running."
    rm -rf "$STAGING_DIR"
    exit 1
fi

echo "  Setting permissions..."
chmod +x "$STAGING_DIR/bin/"*.sh
chmod +x "$STAGING_DIR/www/cgi-bin/"*.sh
chmod +x "$STAGING_DIR/installer.sh"
chmod 755 "$STAGING_DIR/www/cgi-bin"
echo "  Done."

# --- Remove other/prior installs ---
# Every download above succeeded, so it's now safe to actually disturb
# the running system. QuecControl and OpenModem service/path names are
# confirmed. SimpleAdmin's were verified against a real
# iamromulan/quectel-rgmii-toolkit install: it runs simpleadmin_httpd.service
# + simpleadmin_generate_status.service out of /usrdata/simpleadmin, plus a
# separate socat-at-bridge toolkit (socat-smd11*/socat-smd7* units out of
# /usrdata/socat-at-bridge) that bridges /dev/smd11 to pty pairs for it.
# The socat bridge has to go too, not just simpleadmin itself — it and our
# own at_broker.sh would otherwise both try to own /dev/smd11 at once.
#
# SimpleFirewall (also part of that toolkit — simplefirewall.service +
# ttl-override.service, out of /usrdata/simplefirewall) is fully removed
# too, not left alone: it independently managed the exact iptables rules
# OpenModem now owns itself (TTL spoofing, and separately, the port-8080
# protection just applied above), and two independent managers of the
# same rules silently conflict — confirmed live: the TTL target doesn't
# stop rule processing, so whichever rule sits later in the chain wins
# regardless of which tool applied it last. Removing it also drops the
# project's only bash dependency (SimpleFirewall's scripts are #!/bin/bash;
# everything OpenModem owns is POSIX ash). Tailscale is still left alone —
# unrelated, no overlap with anything here.
echo "[3/7] Removing existing installs (QuecControl, SimpleAdmin, SimpleFirewall, OpenModem)..."

# /lib/systemd/system lives on the root filesystem, which is read-only by
# default (confirmed UBIFS on real hardware) — remount rw before touching
# it. Stays rw through step 6's autostart install, then gets remounted ro
# at the end of that step. Note: /etc/systemd/system and /usrdata are on a
# separate, always-writable volume, so this doesn't affect the
# /etc/systemd/system rm's below.
echo "  Remounting / as read-write..."
mount -o remount,rw /

for svc in \
    queccontrol-poller queccontrol-init queccontrol-broker queccontrol-httpd \
    quecmanager-broker quecmanager-httpd \
    simpleadmin_httpd simpleadmin_generate_status \
    socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN \
    socat-smd7 socat-smd7-to-ttyIN2 socat-smd7-from-ttyIN2 socat-killsmd7bridge \
    simplefirewall ttl-override \
    openmodem-poller openmodem-broker openmodem-httpd openmodem-iptables openmodem-netpoller
do
    systemctl stop "$svc" 2>/dev/null
    systemctl disable "$svc" 2>/dev/null
done

rm -f /etc/systemd/system/queccontrol-*.service
rm -f /etc/systemd/system/quecmanager-*.service
rm -f /etc/systemd/system/simpleadmin*.service
rm -f /etc/systemd/system/socat-*.service
rm -f /etc/systemd/system/simplefirewall.service
rm -f /etc/systemd/system/ttl-override.service
rm -f /etc/systemd/system/openmodem-*.service
rm -f /lib/systemd/system/queccontrol-*.service
rm -f /lib/systemd/system/quecmanager-*.service
rm -f /lib/systemd/system/simpleadmin*.service
rm -f /lib/systemd/system/socat-*.service
rm -f /lib/systemd/system/simplefirewall.service
rm -f /lib/systemd/system/ttl-override.service
rm -f /lib/systemd/system/openmodem-*.service
rm -f /lib/systemd/system/multi-user.target.wants/queccontrol-*.service
rm -f /lib/systemd/system/multi-user.target.wants/quecmanager-*.service
rm -f /lib/systemd/system/multi-user.target.wants/simpleadmin*.service
rm -f /lib/systemd/system/multi-user.target.wants/socat-*.service
rm -f /lib/systemd/system/multi-user.target.wants/simplefirewall.service
rm -f /lib/systemd/system/multi-user.target.wants/ttl-override.service
rm -f /lib/systemd/system/multi-user.target.wants/openmodem-*.service
rm -f /etc/systemd/system/multi-user.target.wants/queccontrol-*.service
rm -f /etc/systemd/system/multi-user.target.wants/quecmanager-*.service
rm -f /etc/systemd/system/multi-user.target.wants/simpleadmin*.service
rm -f /etc/systemd/system/multi-user.target.wants/socat-*.service
rm -f /etc/systemd/system/multi-user.target.wants/simplefirewall.service
rm -f /etc/systemd/system/multi-user.target.wants/ttl-override.service
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

pkill -f "httpd.*8080"        2>/dev/null
pkill -f "at_broker.sh"       2>/dev/null
pkill -f "at_poller.sh"       2>/dev/null
pkill -f "net_poller.sh"      2>/dev/null
pkill -f "socat-armel-static" 2>/dev/null
pkill -f "build_modem_status" 2>/dev/null

rm -f  /tmp/at_request
rm -rf /tmp/at_responses
rm -f  /tmp/at_broker.log*
rm -rf /tmp/queccontrol
rm -rf /tmp/simpleadmin
rm -rf /tmp/openmodem

rm -rf "$INSTALL_DIR"
rm -rf "/usrdata/quecmanager"
rm -rf "/usrdata/simpleadmin"
rm -rf "/usrdata/socat-at-bridge"
rm -rf "/usrdata/simplefirewall"

echo "  Done."

# --- Install downloaded files ---
# Staging directory already has everything — config preserved/migrated,
# permissions set. This is the one step that actually changes what's on
# disk for OpenModem itself, and it's a single same-filesystem rename.
echo "[4/7] Installing downloaded files..."
mv "$STAGING_DIR" "$INSTALL_DIR"
echo "  Done."

# --- Create systemd service files ---
echo "[5/7] Creating systemd service files..."

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
ExecStart=/usr/sbin/httpd -f -h /usrdata/openmodem/www -p 8080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /tmp/openmodem-iptables.service << 'EOF'
[Unit]
Description=OpenModem Firewall/TTL Rules
After=network.target
DefaultDependencies=no

[Service]
Type=oneshot
ExecStart=/bin/sh /usrdata/openmodem/bin/apply_iptables.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

cat > /tmp/openmodem-netpoller.service << 'EOF'
[Unit]
Description=OpenModem Connectivity Poller (ICMP + 204 check)
After=network.target

[Service]
Type=simple
ExecStart=/bin/sh /usrdata/openmodem/bin/net_poller.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "  Service files created."

# --- Install systemd services ---
echo "[6/7] Installing systemd autostart..."

# Still read-write from step 3's remount.
echo "  Installing service files to /lib/systemd/system/..."
cp /tmp/openmodem-broker.service    /lib/systemd/system/
cp /tmp/openmodem-poller.service    /lib/systemd/system/
cp /tmp/openmodem-httpd.service     /lib/systemd/system/
cp /tmp/openmodem-iptables.service  /lib/systemd/system/
cp /tmp/openmodem-netpoller.service /lib/systemd/system/

systemctl daemon-reload

echo "  Creating autostart symlinks..."
ln -sf /lib/systemd/system/openmodem-broker.service    /lib/systemd/system/multi-user.target.wants/
ln -sf /lib/systemd/system/openmodem-poller.service    /lib/systemd/system/multi-user.target.wants/
ln -sf /lib/systemd/system/openmodem-httpd.service     /lib/systemd/system/multi-user.target.wants/
ln -sf /lib/systemd/system/openmodem-iptables.service  /lib/systemd/system/multi-user.target.wants/
ln -sf /lib/systemd/system/openmodem-netpoller.service /lib/systemd/system/multi-user.target.wants/

echo "  Remounting / as read-only..."
mount -o remount,ro /

rm -f /tmp/openmodem-broker.service
rm -f /tmp/openmodem-poller.service
rm -f /tmp/openmodem-httpd.service
rm -f /tmp/openmodem-iptables.service
rm -f /tmp/openmodem-netpoller.service

# --- Start services ---
echo "[7/7] Starting services..."

systemctl start openmodem-iptables.service

systemctl start openmodem-netpoller.service

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

# httpd Requires=openmodem-broker.service, so it can flap in step with the
# broker while at_broker.sh is still a stub — check a few times rather
# than once so a mid-flap sample doesn't produce a false FAILED here.
_web_ok=0
i=0
while [ "$i" -lt 5 ]; do
    if netstat -tlnp 2>/dev/null | grep -q ":8080" || systemctl is-active --quiet openmodem-httpd.service; then
        _web_ok=1
        break
    fi
    sleep 1
    i=$(( i + 1 ))
done

if [ "$_web_ok" = "1" ]; then
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

if systemctl is-active --quiet openmodem-iptables.service; then
    echo "  OK Firewall/TTL rules: APPLIED"
else
    echo "  FAIL Firewall/TTL rules: FAILED"
fi

if pgrep -f "net_poller.sh" > /dev/null; then
    echo "  OK Connectivity poller: RUNNING"
else
    echo "  FAIL Connectivity poller: FAILED"
fi

echo ""
echo "  Start:   systemctl start openmodem-broker.service openmodem-poller.service openmodem-httpd.service openmodem-iptables.service openmodem-netpoller.service"
echo "  Stop:    systemctl stop openmodem-httpd.service openmodem-poller.service openmodem-broker.service openmodem-iptables.service openmodem-netpoller.service"
echo "  Restart: systemctl restart openmodem-broker.service openmodem-poller.service openmodem-httpd.service openmodem-iptables.service openmodem-netpoller.service"
echo "  Status:  systemctl status openmodem-broker.service openmodem-poller.service openmodem-httpd.service openmodem-iptables.service openmodem-netpoller.service"
