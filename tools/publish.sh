#!/bin/bash
# Merge one updates file into data.json and push it, holding a lock so the automatic loop and manual updates
# never write data.json at the same time. Prints apply.js's report. Usage: tools/publish.sh updates/<file>.json
set -u
cd "$(dirname "$0")/.." || exit 1
upd="$1"
lock=updates/.lock
for _ in $(seq 1 60); do mkdir "$lock" 2>/dev/null && break; sleep 2; done
[ -d "$lock" ] || { echo "publish: could not get the lock" >&2; exit 1; }
trap 'rmdir "$lock"' EXIT

node tools/apply.js "$upd" || exit 1
if ! git diff --quiet -- data.json; then
  git add data.json
  git commit -q -m "Tsunami watch: sample $(date '+%H:%M')" -- data.json
  git push -q origin main || { echo "publish: push failed" >&2; exit 1; }
fi
