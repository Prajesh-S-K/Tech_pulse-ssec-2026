#!/bin/bash
# Double-click me to stop every Tech Pulse process started from this folder.
cd "$(dirname "$0")" || exit 1
for d in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do [ -x "$d/node" ] && export PATH="$d:$PATH" && break; done
node scripts/stop.js
read -r -p "Press Enter to close..." _
