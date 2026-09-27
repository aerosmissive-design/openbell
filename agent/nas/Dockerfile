FROM mcr.microsoft.com/playwright:v1.62.0-jammy

USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openbell/pc
COPY pc/package.json pc/tsconfig.json ./
COPY pc/src ./src
RUN npm install

COPY nas/entry.sh /entry.sh
COPY nas/poll.mjs /opt/openbell/nas/poll.mjs
RUN chmod +x /entry.sh

ENV DISPLAY=:99
ENV PLAYWRIGHT_HEADLESS=false
ENV PAYMENT_HOLD_BROWSER=true
EXPOSE 6080
ENTRYPOINT ["/entry.sh"]
