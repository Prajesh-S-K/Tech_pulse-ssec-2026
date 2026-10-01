#!/bin/bash
# Double-click (macOS): the full version — private HTTPS for phones + certificate QR codes
# (+ Firebase when configured). Stops older Tech Pulse processes from this folder first.
cd "$(dirname "$0")" || exit 1
source scripts/find-node.sh || exit 1
node scripts/full.js "$@"
status=$?
if [ $status -ne 0 ]; then echo; read -r -p "Something needs attention (see above). Press Enter to close..." _; fi
exit $status
