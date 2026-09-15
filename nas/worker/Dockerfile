# 나스 도우미 — Chromium + 가상화면 + noVNC
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs book.mjs login-setup.mjs start.sh ./
RUN chmod +x start.sh

ENV DISPLAY=:99
ENV HEADLESS=0
ENV POLL_SECONDS=15
ENV HOLD_MINUTES=10
ENV PLAYWRIGHT_STATE_DIR=/data

EXPOSE 6080

CMD ["./start.sh"]
