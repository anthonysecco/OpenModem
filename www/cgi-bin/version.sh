#!/bin/sh
# version.sh — serve the installer-recorded deployed-commit info as JSON.
#
# GET /cgi-bin/version.sh
#
# VERSION is a KEY=value file written fresh by installer.sh's "Resolving
# deployed commit info" step on every install/update (see its header
# comment) — static between updates, so this is its own one-shot
# endpoint the front end fetches once on page load, not a
# state_merged.json field re-read every poll cycle for data that only
# ever changes when installer.sh itself runs.
#
# Parsed with grep/cut rather than sourced (`.`) even though
# installer.sh writes this file itself — the values ultimately trace
# back to GitHub's API response, so this stays consistent with treating
# anything that traces back to an external source as untrusted (see
# CLAUDE.md's QUERY_STRING guidance) rather than handing it straight to
# the shell.

VERSION_FILE="/usrdata/openmodem/VERSION"

echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo ""

COMMIT_SHA=""
COMMIT_DATE=""
if [ -f "$VERSION_FILE" ]; then
    COMMIT_SHA=$(grep '^COMMIT_SHA=' "$VERSION_FILE" | head -1 | cut -d= -f2-)
    COMMIT_DATE=$(grep '^COMMIT_DATE=' "$VERSION_FILE" | head -1 | cut -d= -f2-)
fi
[ -z "$COMMIT_SHA" ] && COMMIT_SHA="unknown"
[ -z "$COMMIT_DATE" ] && COMMIT_DATE="unknown"

printf '{"commit_sha":"%s","commit_date":"%s"}\n' "$COMMIT_SHA" "$COMMIT_DATE"
