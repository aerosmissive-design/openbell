#!/usr/bin/env bash
# 가상 화면 + VNC + noVNC + 예매 도우미
set -e

export DISPLAY="${DISPLAY:-:99}"
export HEADLESS="${HEADLESS:-0}"
export HOLD_MINUTES="${HOLD_MINUTES:-10}"

echo "[start] Xvfb ${DISPLAY}"
Xvfb "$DISPLAY" -screen 0 1280x900x24 -ac +
extension RANDR >/tmp/xvfb.log 2>&1 &
sleep 1

echo "[start] x11vnc :5900"
x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -nopw -listen 0.0.0.0 \
  >/tmp/x11vnc.log 2>&1 &

echo "[start] noVNC :6080"
# websockify: 브라우저 → VNC
websockify --web=/usr/share/novnc/ 6080 localhost:5900 \
  >/tmp/novnc.log 2>&1 &

echo "[start] worker HEADLESS=${HEADLESS} HOLD_MINUTES=${HOLD_MINUTES}"
exec node index.mjs
