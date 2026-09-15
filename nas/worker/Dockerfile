# 나스 도우미 — 브라우저 포함
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs book.mjs ./

ENV HEADLESS=1
ENV POLL_SECONDS=15

CMD ["node", "index.mjs"]
