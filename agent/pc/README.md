# OpenBell PC CGV Booking Agent (v2.0.12)

Windows PC 전용 **독립 패키지**입니다. **먼저 `START.txt` 를 읽으세요.** 웹앱 루트의 `npm install` 없이 `agent/pc` 안에서만 설치·실행합니다.

결제(결제하기 / 최종결제 / purchase / order)는 **절대 클릭하지 않습니다**.  
`PAYMENT_READY` 에서 HARD STOP 하며, 세션 TTL은 서버 기준 **10분**입니다.

CAPTCHA / 보안문자는 **절대 우회하지 않습니다**. 감지 시 중단·보고합니다.

> **미완료 / 주의:** CGV DOM 셀렉터는 실제 E2E로 검증되지 않았습니다.  
> 무인 운영 전에 headed 모드로 회차·좌석 맵을 직접 확인하세요. “검증 완료”를 주장하지 않습니다.

### v2.0.12 notes

- `5-open-config.cmd`. `1-install.cmd` ASCII-only arrows. TTL env is display-only.

### v2.0.10 notes

- Telegram/OpenBell callback will not receive a payment-page URL. Pay on the PC browser.

### v2.0.9 notes

- `START.txt` one-pager. `2-run.cmd` always pauses. Date/showtime calendar aliases.

### v2.0.8 notes

- CLI is `src/cli.ts` (`2-run.cmd` / `npm start`). `run.ts` is library-only.
- OpenBell payment-ready **401 is never retried** (unit-tested).

### v2.0.7 notes

- `PAYMENT_HARD_STOP=false` is ignored. Payment-ready screenshot in `logs/`.
- Shared env parser. Booking-info fill searches iframes.

### v2.0.6 notes

- `4-save-login.cmd`: 사용자가 CGV에 **직접** 로그인한 뒤 세션만 저장. 비밀번호 입력 없음. 결제 클릭 없음.
- `CGV_STORAGE_STATE=cgv-storage.json` (gitignore). 파일이 없으면 doctor/preflight가 경고.

### v2.0.5 notes

- Login page stop (`LOGIN_REQUIRED`). Age-gate/닫기 dismiss only (no 결제).
- Doctor: date/showtime format + official OpenBell host warning.

### v2.0.4 notes

- Restored 인원 count (skip if seat map visible; no bare number clicks).
- CAPTCHA screenshot + linked `FAILED` state. Doctor does not import Playwright.

### v2.0.3 notes

- CAPTCHA: visible text + captcha iframe URL only (no full-HTML `cloudflare` false positive).
- Payment STAGE tightened; `결제하기` still never clicked.
- HARD STOP 이후 OpenBell 콜백 실패해도 headed 브라우저를 닫지 않음.
- Seat-map 실패 시 `logs/seat-map-*.png`. `config.env` gitignore.
- **Windows headed E2E still unverified.**

### v2.0.2 notes

- Seat map: same-origin **iframe** search + failure diagnostics (no secrets).
- Ranker: `preferredRowDistance` hard-filter empty → fallback (distance as score only); aisle/edge still apply.
- `payment-ready` retries (network/5xx, not 401) + preflight banner (no tokens).
- `2-run.cmd` refreshes Node PATH like `1-install.cmd`.

---

## STEP 1 — 설치

`1-install.cmd` 를 한 번 실행하세요. (**ASCII 전용** — 한글 `설치.bat` 은 Windows에서 `5001` 오류를 유발할 수 있어 사용하지 마세요.)

하는 일:

1. Node.js LTS 확인 (없으면 winget으로 설치)
2. **이 폴더에서만** `npm install` (`playwright` + `typescript` + `tsx`) — 웹앱 루트 전체 install 금지
3. Playwright Chromium 설치
4. `config.env.example` → `config.env` 복사 (없을 때)

구버전 호환: `install.cmd` → `1-install.cmd` 래퍼.

---

## STEP 2 — 설정

`config.env` 를 편집합니다.

| 변수 | 설명 |
|------|------|
| `BOOKING_MOVIE` / `BOOKING_DATE` / `BOOKING_SHOWTIME` | 예매 대상 (필수) |
| `BOOKING_SEAT_COUNT` | 좌석 수 |
| `BOOKING_URL` | CGV **정확 회차** URL. 설정 시 영화/날짜/시간 클릭을 건너뛰고 바로 열다 |
| `BOOKING_SEAT_IDS` | 지정 좌석 (예: `E5,E6`). 비우면 연속 좌석 자동 선택 |
| `OPENBELL_URL` + `NAS_WORKER_TOKEN` | 둘 다 있으면 OpenBell API 콜백. **없으면 dry-run** |
| `BOOKING_SESSION_ID` | 기존 세션 ID. 비우고 콜백 ON이면 `POST /api/booking/create` 로 생성 |
| `PAYMENT_HOLD_BROWSER` | `true`(기본): 결제 직전 브라우저를 열어 두고 수동 결제 대기 |
| `SEAT_PREFERRED_ROW` / `SEAT_PREFERRED_ROW_DISTANCE` | 선호 열과 허용 거리 (하드 필터 결과가 0이면 거리 페널티만 남기고 fallback) |
| `PAYMENT_HARD_STOP` | 항상 true로 취급 — 최종결제 자동화 없음 |

### BOOKING_URL 규칙 (필수 쿼리)

- `https://cgv.co.kr/cnm/movieBook/movie` (또는 `www.cgv.co.kr`)
- 쿼리 **전부** 존재: `movNo`, `scnYmd`, `scnsNo`, `scnSseq`

토큰·쿠키·`storageState` 파일은 Git에 커밋하지 마세요. 시크릿을 문서에 넣지 마세요.

---

## STEP 2.5 — CGV 로그인 세션 (선택)

CGV가 로그인 화면을 띄우면 에이전트는 중단합니다 (`LOGIN_REQUIRED`). 비밀번호를 넣지 않습니다.

1. `4-save-login.cmd` 실행
2. 열린 창에서 **직접** 로그인
3. 이 검은 창으로 돌아와 Enter → `cgv-storage.json` 저장
4. `config.env` 의 `CGV_STORAGE_STATE=cgv-storage.json` (example 기본값)
5. `3-doctor.cmd` 로 파일 존재 확인 후 `2-run.cmd`

---

## STEP 3 — 실행

`2-run.cmd` 실행. (구버전: `run-agent.cmd` → `2-run.cmd`)

기본 headed (`PLAYWRIGHT_HEADLESS=false`).

상태 흐름 (OpenBell 세션):

```
IDLE → WATCHING → SEAT_FOUND → BOOKING → MOVIE_SELECTED → SHOWTIME_SELECTED
  → SEAT_SELECTED → BOOKING_INFO → PAYMENT_READY → WAITING_USER
```

- `PAYMENT_READY` = **HARD STOP** (자동화 종료). 서버 TTL **10분**.
- `WAITING_USER` = 브라우저를 열어 두고 사용자가 직접 결제.
- Telegram 알림은 **서버**가 `POST /api/booking/payment-ready` 수신 후 보냅니다. PC 에이전트는 봇 토큰을 갖지 않습니다.

---

## STEP 4 — 결과 코드 (운영자용)

| 코드 | 의미 | 조치 |
|------|------|------|
| **A** | `PAYMENT_READY` — HARD STOP 성공. 좌석 확보, 결제 미클릭. (콜백 ON이면 OpenBell+Telegram 서버 통지) | 열린 브라우저에서 **직접** 결제. 10분 내 완료 |
| **B** | Dry-run 성공 — API 콜백 없이 동일 HARD STOP | 로컬만 확인. 연동 시 `OPENBELL_URL`+`NAS_WORKER_TOKEN` 설정 |
| **C** | `CAPTCHA_DETECTED` — CAPTCHA/보안문자 감지, 우회 안 함 | 수동 해결 후 재시도. 자동화로 우회하지 말 것 |
| **D** | 대상/좌석/URL/단계 실패 (`INVALID_BOOKING_URL`, `CGV_SEAT_*`, `CGV_*_NOT_FOUND` 등) | `BOOKING_URL`·좌석·회차 확인. DOM은 E2E 미검증 |
| **E** | OpenBell API 실패 (`OPENBELL_*_FAILED`, 401 등) | 워커 토큰·URL·세션 ID 확인. dry-run으로 브라우저만 검증 가능 |

콘솔에 `PAYMENT_READY - AUTOMATION HARD STOP` 이 보이면 **A/B** 계열입니다. 최종결제는 클릭되지 않았습니다.

---

## 안전 규칙 (HARD STOP)

- `결제하기`, `최종결제`, `purchase`, `order`, `pay now` 등 **결제/구매 버튼 클릭 금지**
- 결제 단계 URL/본문 키워드 감지 시 자동화 즉시 중단
- CAPTCHA / reCAPTCHA / 보안문자 감지 시 `CAPTCHA_DETECTED` 로 중단·보고 (우회 없음)
- 로그인·페이지 구조 변경으로 대상을 못 찾으면 중단

---

## OpenBell Booking API

Authorization: `Bearer <NAS_WORKER_TOKEN>` (서버: `NAS_WORKER_TOKEN` / `NAS_REPORT_TOKEN` / `CRON_SECRET`).

파일: `src/routes/api/booking/*.ts`

| Method | Path | Body / Query | 응답 요지 |
|--------|------|--------------|-----------|
| `POST` | `/api/booking/create` | `theaterId`, `movieTitle`, `playDate`, `showtime`, `hall`, `requestedSeatCount`, optional `bookingUrl`, `agent` | `{ ok, session }` |
| `POST` | `/api/booking/state` | `id`, `state` | `{ ok, session }` |
| `POST` | `/api/booking/payment-ready` | `id`, `browserAccessUrl`, `selectedSeats` | `{ ok, hardStop, session, telegram }` — **Telegram은 서버에서 발송** |
| `GET` | `/api/booking/session?id=` | — | `{ ok, session }` |
| `POST` | `/api/booking/session` | create와 유사 (레거시) | `{ ok, session }` |

`routeTree.gen.ts` 에 booking 경로가 안 보여도, 프로덕션 `https://openbell-fawn.vercel.app/api/booking/create|state|payment-ready` 는 **인증 없이 401**로 살아 있음 (2026-09-19 확인). 무단 머지/재배포하지 말 것.

---

## Dry-run vs 연동

| 모드 | 조건 | 동작 |
|------|------|------|
| **Dry-run (B)** | `OPENBELL_URL` 또는 `NAS_WORKER_TOKEN` 미설정 | 브라우저만. API 없음 |
| **연동 (A)** | 둘 다 설정 | create / state / payment-ready |

---

## 패키지 구조

```
agent/pc/
  1-install.cmd      # ASCII 설치
  2-run.cmd          # 실행
  install.cmd        # → 1-install.cmd
  run-agent.cmd      # → 2-run.cmd
  package.json       # 로컬 전용
  tsconfig.json
  config.env.example
  src/
    safety.ts
    safety.test.ts
    seat-ranker.ts   # 인라인 연속좌석 랭커 (../../src 비의존)
    cgv-agent.ts
    run.ts
  README.md
  CHANGELOG.md
```

```bat
npm run typecheck
npm test
npm start
```

CGV 진입점: `https://cgv.co.kr/cnm/movieBook/movie`
