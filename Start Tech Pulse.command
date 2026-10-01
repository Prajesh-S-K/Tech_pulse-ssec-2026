#!/bin/bash
# Double-click me (macOS). Stops older Tech Pulse processes, then starts the full
# version: Firebase (if configured) + private HTTPS for phones + phone certificate in Downloads.
cd "$(dirname "$0")" || exit 1

# --- find a Node >= 22.12 (and an npm) without any manual PATH work ---------------
ok_node() { # $1 = directory containing node
  [ -x "$1/node" ] || return 1
  "$1/node" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null
}
dirs=()
for d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$d" ] && dirs+=("$d"); done
dirs=($(printf '%s\n' "${dirs[@]}" | sort -rV))
dirs+=(/opt/homebrew/bin /usr/local/bin "$(dirname "$(command -v node 2>/dev/null)")")
NODE_DIR=""
for d in "${dirs[@]}"; do ok_node "$d" && NODE_DIR="$d" && break; done
if [ -z "$NODE_DIR" ]; then
  echo "Node 22.12 or newer was not found."
  echo "Install Node 24 from https://nodejs.org/ then double-click this file again."
  read -r -p "Press Enter to close..." _; exit 1
fi
NPM_DIR=""
for d in "$NODE_DIR" "${dirs[@]}"; do [ -x "$d/npm" ] && NPM_DIR="$d" && break; done
export PATH="$NODE_DIR:${NPM_DIR:-$NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "Using Node $(node -v) from $NODE_DIR"

node scripts/full.js "$@"
status=$?
if [ $status -ne 0 ]; then echo; read -r -p "Something needs attention (see above). Press Enter to close..." _; fi
exit $status
