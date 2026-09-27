#!/bin/bash
set -eu
export DISPLAY="${DISPLAY:-:99}"
mkdir -p /storage /tmp
Xvfb "$DISPLAY" -screen 0 1400x900x24 -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
sleep 0.4
x11vnc -display "$DISPLAY" -nopw -listen 0.0.0.0 -rfbport 5900 -forever -shared >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &
echo "noVNC http://<nas>:6080/vnc.html"
echo "Final payment is never clicked. CAPTCHA is never bypassed."
exec node /opt/openbell/nas/poll.mjs
