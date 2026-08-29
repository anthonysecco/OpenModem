#!/bin/sh
# version_check.sh — checks GitHub for whether a newer commit exists
# than what's currently installed, for the System page's Update card's
# "Update Available" row.
#
# GET /cgi-bin/version_check.sh
#   {"installed_sha":"<sha-or-unknown>","latest_sha":"<sha>","update_available":true|false}
#   latest_sha is null (and update_available always false) if GitHub's
#   API couldn't be reached (rate-limited, no signal, etc.) — an
#   unresolved lookup is never reported as "update available", same
#   reasoning installer.sh itself already applies to this exact lookup.
#
# Queries the same GitHub commits API installer.sh's own "Checking for
# updates" step uses (curl by the modem itself, over its own WAN
# connection — see DEPENDENCIES.md), just read-only here: this never
# triggers a real install by itself, only the button/confirm flow does.

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

VERSION_FILE="/usrdata/openmodem/VERSION"
OWNER_REPO="anthonysecco/OpenModem"
GITHUB_REF="main"

INSTALLED_SHA=""
if [ -f "$VERSION_FILE" ]; then
    INSTALLED_SHA=$(grep '^COMMIT_SHA=' "$VERSION_FILE" | head -1 | cut -d= -f2-)
fi
[ -z "$INSTALLED_SHA" ] && INSTALLED_SHA="unknown"

API_JSON=$(curl -4 -fsS --max-time 10 "https://api.github.com/repos/${OWNER_REPO}/commits/${GITHUB_REF}" 2>/dev/null)
LATEST_SHA=$(printf '%s' "$API_JSON" | sed -n 's/.*"sha": *"\([0-9a-f]\{40\}\)".*/\1/p' | head -1)

if [ -z "$LATEST_SHA" ]; then
    printf '{"installed_sha":"%s","latest_sha":null,"update_available":false}\n' "$INSTALLED_SHA"
    exit 0
fi

if [ "$INSTALLED_SHA" != "unknown" ] && [ "$INSTALLED_SHA" != "$LATEST_SHA" ]; then
    AVAILABLE="true"
else
    AVAILABLE="false"
fi

printf '{"installed_sha":"%s","latest_sha":"%s","update_available":%s}\n' "$INSTALLED_SHA" "$LATEST_SHA" "$AVAILABLE"
