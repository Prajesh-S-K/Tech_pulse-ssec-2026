#!/bin/bash
# Double-click (macOS): the fast start. Runs the demo on this computer only
# (no Firebase, no phone setup, no ESP32) and opens it in your browser.
cd "$(dirname "$0")" || exit 1
source scripts/find-node.sh || exit 1
node scripts/stop.js >/dev/null 2>&1   # stop an older copy of this program first
node scripts/demo.js "$@"
status=$?
if [ $status -ne 0 ]; then echo; read -r -p "Something needs attention (see above). Press Enter to close..." _; fi
exit $status
