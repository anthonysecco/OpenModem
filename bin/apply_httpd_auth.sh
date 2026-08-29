#!/bin/sh
# apply_httpd_auth.sh — generates BusyBox httpd's Basic Auth config
# (/usrdata/openmodem/httpd_auth.conf) from openmodem.conf's WEB_AUTH_USER/
# WEB_AUTH_HASH, gating the entire web UI behind a login. Runs via
# openmodem-httpd.service's ExecStartPre (every boot/restart, before httpd
# itself starts) and is also called directly by www/cgi-bin/auth_action.sh
# right after a password change, before that script triggers httpd's
# restart — BusyBox httpd's -c config is read once at startup, no
# hot-reload (confirmed live), so a changed hash has no effect until httpd
# actually restarts.
#
# Auth line format (`/path:user:password-or-crypt-hash`) and `busybox
# httpd -m STRING` (MD5-crypt with a random salt) both confirmed live
# against this hardware's BusyBox 1.31.1 via a disposable httpd instance
# on a spare port before this was wired into the real service — getting
# this wrong risks locking out the web UI entirely.
#
# Default credentials (admin/admin) are lazily migrated into
# openmodem.conf itself the first time this runs on a device whose
# openmodem.conf predates this feature — same approach installer.sh
# already uses for SimpleFirewall's ttlvalue -> TTL_VALUE. WEB_AUTH_HASH
# below is the MD5-crypt of "admin" specifically (computed once via
# `busybox httpd -m admin` on real hardware and hardcoded here) rather
# than generated fresh each time — a hash of a known default password
# gains nothing from a random salt, and hardcoding keeps this script
# idempotent without writing a new hash (and re-triggering a restart
# loop) on every single boot.
#
# WEB_AUTH_HASH's value MUST be single-quoted wherever it's written into
# openmodem.conf: it contains literal "$1$...$..." — since openmodem.conf
# is dot-sourced as real shell by every daemon that reads it, an unquoted
# "$1"/"$8" etc. is parsed as positional-parameter expansion and silently
# strips those segments out (confirmed live: corrupts the hash into
# garbage that matches no password at all, single-quoting fixes it).

CONF_FILE="/usrdata/openmodem/config/openmodem.conf"
AUTH_CONF="/usrdata/openmodem/httpd_auth.conf"
DEFAULT_USER="admin"
DEFAULT_HASH='$1$7hA583Y.$8LUI.2IJF2h2Wys9YfH9F0'

WEB_AUTH_USER=""
WEB_AUTH_HASH=""
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

if [ -z "$WEB_AUTH_HASH" ]; then
    WEB_AUTH_USER="$DEFAULT_USER"
    WEB_AUTH_HASH="$DEFAULT_HASH"

    mkdir -p "$(dirname "$CONF_FILE")"
    _tmp="${CONF_FILE}.tmp"
    if [ -f "$CONF_FILE" ]; then
        grep -vE '^WEB_AUTH_(USER|HASH|IS_DEFAULT)=' "$CONF_FILE" > "$_tmp"
    else
        : > "$_tmp"
    fi
    {
        echo "WEB_AUTH_USER=${WEB_AUTH_USER}"
        echo "WEB_AUTH_HASH='${WEB_AUTH_HASH}'"
        echo "WEB_AUTH_IS_DEFAULT=1"
    } >> "$_tmp"
    mv "$_tmp" "$CONF_FILE"
fi
[ -z "$WEB_AUTH_USER" ] && WEB_AUTH_USER="$DEFAULT_USER"

mkdir -p "$(dirname "$AUTH_CONF")"
printf '/:%s:%s\n' "$WEB_AUTH_USER" "$WEB_AUTH_HASH" > "$AUTH_CONF"
