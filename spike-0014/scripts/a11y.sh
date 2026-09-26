#!/bin/bash
# Dump the accessibility tree uiautomator sees, one node a line, to $1.
set -eu
cd "$(dirname "$0")"
./adbt shell uiautomator dump ${UIA_FLAGS:-} /sdcard/ui.xml >/dev/null
./adbt shell cat /sdcard/ui.xml > "$1.xml"
./adbt shell rm /sdcard/ui.xml
python3 - "$1.xml" <<'EOF' | tee "$1.txt"
import re, sys
s = open(sys.argv[1]).read()
for m in re.finditer(r'<node [^>]*>', s):
    n = m.group(0)
    g = lambda k: re.search(k + r'="([^"]*)"', n).group(1)
    print(g('class'), repr(g('text')[:40]), repr(g('content-desc')[:40]), g('bounds'), 'clickable' if g('clickable') == 'true' else '')
EOF
