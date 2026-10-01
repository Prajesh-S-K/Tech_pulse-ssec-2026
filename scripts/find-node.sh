# Sourced by the .command launchers: puts a Node >= 22.12 (and an npm) on PATH, or explains.
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
  echo
  echo "Node.js 22.12 or newer is needed once (free)."
  echo "1. Open https://nodejs.org/  2. Download the LTS installer  3. Install it  4. Double-click this file again."
  read -r -p "Press Enter to close..." _; exit 1
fi
NPM_DIR=""
for d in "$NODE_DIR" "${dirs[@]}"; do [ -x "$d/npm" ] && NPM_DIR="$d" && break; done
export PATH="$NODE_DIR:${NPM_DIR:-$NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "Using Node $(node -v)"
