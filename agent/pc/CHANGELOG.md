# Changelog — OpenBell PC Agent

## 2.0.3 — 2026-09-19

### Fixes (no E2E claim)

- CAPTCHA: scan **visible text + captcha iframe URL only**. Do not grep full HTML for `cloudflare` / `recaptcha` (CDN false positive → bogus result C).
- Payment STAGE: require `/payment` URL or form words (`최종결제금액`, `결제수단`, …). A lone `결제하기` or English `order`/`border` is **not** a payment page. Forbidden-click blacklist unchanged (`결제하기` still never clicked).
- After HARD STOP, a failed OpenBell callback **does not close** the headed browser (manual payment window preserved).
- `launch()` no longer loads the generic movie-book page before `BOOKING_URL`.
- `clickSafeNext` also searches same-origin frames.
- Seat-map failure saves `logs/seat-map-*.png` (no secrets).
- `config.env`, `logs/`, storageState gitignored (root + `agent/pc`).
- Preflight warns when `BOOKING_URL` is empty.
- Unit tests for URL / captcha / payment-stage helpers.

Safety unchanged: no payment click, no CAPTCHA bypass, HARD STOP at PAYMENT_READY. **Windows headed E2E still unverified.**

## 2.0.2 — 2026-09-19

### Improvements

- CGV seat-map: search **same-origin iframes** (`page.frames()`) when waiting / reading / finding seats; prefer the frame with `SEAT_MAP_SELECTOR` count > 0. On failure, log safe diagnostics (URL, frame count, sample data-seat*/data-row/aria-label attrs, payment-stage word note) — no secrets.
- Seat ranker: if `preferredRow` + `preferredRowDistance` hard filter yields zero blocks, **fall back** without the hard cutoff (row distance remains a score penalty). `autoSelectSeats` logs a one-line warning when fallback is used. Unit tests cover fallback + aisle/edge still respected.
- `payment-ready`: retry up to 3 times with backoff (~500ms, ~1500ms) on network errors / 5xx; **never** retry 401. Log brief `hardStop` / `telegram` from response JSON when present.
- Preflight banner before browser launch: dry-run vs linked, movie/date/showtime, seat count, BOOKING_URL yes/no (never prints tokens).
- `2-run.cmd`: same Program Files / LocalAppData nodejs PATH refresh as `1-install.cmd` before `where node`.

Safety unchanged: no payment click, no CAPTCHA bypass, HARD STOP at PAYMENT_READY.

## 2.0.1 — 2026-09-19

### Improvements

- `preferredRowDistance` now filters out rows farther than the configured distance (was loaded but unused).
- CGV seat-map locators: broader data-*/role/seatmap fallbacks (still **not** Windows E2E verified).
- `1-install.cmd`: refresh PATH for Program Files and LocalAppData Node installs; clearer retry messaging.
- `npm test` unit tests for seat-ranker (node:test via tsx).
- BOOKING_URL: `siteNo` optional; still requires movNo,scnYmd,scnsNo,scnSseq.

Safety unchanged: no payment click, no CAPTCHA bypass, HARD STOP at PAYMENT_READY.

## 2.0.0 — 2026-09-19

인수인계서(2026-09-18) 기준 재작성.

### Breaking / rebuild

- `agent/pc` 를 **독립 npm 패키지**로 재작성. 웹앱 루트 `npm install` 불필요.
- 엔트리: `1-install.cmd` / `2-run.cmd` (ASCII only). 한글 `설치.bat` 폐기 권고 (Windows 5001).
- 구 `install.cmd` / `run-agent.cmd` 는 thin wrapper.
- 소스: `src/cgv-agent.ts`, `src/run.ts`, `src/seat-ranker.ts` (인라인 랭커).
- 실행: `npx tsx src/run.ts`.

### Safety (인수인계)

- 상태: IDLE→…→PAYMENT_READY→WAITING_USER. HARD STOP at PAYMENT_READY (서버 TTL 10분).
- 최종결제 버튼 절대 클릭 금지. CAPTCHA 우회 금지.
- `PAYMENT_HOLD_BROWSER=true` 기본 — 브라우저 유지 후 수동 결제.
- Telegram은 서버가 `payment-ready` 콜백 이후 발송 (PC에 봇 시크릿 없음).

### OpenBell APIs

- `POST /api/booking/create`, `/api/booking/state`, `/api/booking/payment-ready` + Bearer worker token.
- 토큰 없으면 dry-run 허용.

### Docs

- 한국어 README: STEP 설치→설정→실행→결과코드 A/B/C/D/E.
- CGV DOM은 E2E 미검증으로 명시.

## 1.x (legacy)

- ChatGPT-era flat scripts + 웹앱 seat-ranker import.
