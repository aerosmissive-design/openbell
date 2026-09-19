# OpenBell PC CGV Booking Agent (v2)

Windows PC 전용 **독립 패키지**입니다. 웹앱 루트의 `npm install` 없이 `agent/pc` 안에서만 설치·실행합니다.

결제(결제하기 / 최종결제 / purchase / order)는 **절대 클릭하지 않습니다**.  
`PAYMENT_READY` 에서 HARD STOP 하며, 세션 TTL은 서버 기준 **10분**입니다.

CAPTCHA / 보안문자는 **절대 우회하지 않습니다**. 감지 시 중단하고 보고합니다.

> **미완료 / 주의:** CGV DOM 셀렉터는 실제 E2E로 검증되지 않았습니다.  
> 무인 운영 전에 headed 모드로 회차·좌석 맵을 직접 확인하세요. “검증 완료”를 주장하지 않습니다.

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
| `BOOKING_URL` | CGV **정확 회차** URL. 설정 시 영화/날짜/시간 클릭을 건너뛰고 바로 연다 |
| `BOOKING_SEAT_IDS` | 지정 좌석 (예: `E5,E6`). 비우면 연속 좌석 자동 선택 |
| `OPENBELL_URL` + `NAS_WORKER_TOKEN` | 둘 다 있으면 OpenBell API 콜백. **없으면 dry-run** |
| `BOOKING_SESSION_ID` | 기존 세션 ID. 비우고 콜백 ON이면 `POST /api/booking/create` 로 생성 |
| `PAYMENT_HOLD_BROWSER` | `true`(기본): 결제 직전 브라우저를 열어 두고 수동 결제 대기 |
| `PAYMENT_HARD_STOP` | 항상 true로 취급 — 최종결제 자동화 없음 |

### BOOKING_URL 규칙 (필수 쿼리)

- `https://cgv.co.kr/cnm/movieBook/movie` (또는 `www.cgv.co.kr`)
- 쿼리 **전부** 존재: `movNo`, `scnYmd`, `scnsNo`, `scnSseq`

토큰·쿠키·`storageState` 파일은 Git에 커밋하지 마세요. 시크릿을 문서에 넣지 마세요.

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

`routeTree.gen.ts` 에 booking 이 안 보이면 서버 라우트 재생성/재배포가 필요할 수 있습니다. 소스 파일은 존재합니다.

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
    seat-ranker.ts   # 인라인 연속좌석 랭커 (../../src 비의존)
    cgv-agent.ts
    run.ts
  README.md
  CHANGELOG.md
```

```bat
npm run typecheck
npm start
```

CGV 진입점: `https://cgv.co.kr/cnm/movieBook/movie`
