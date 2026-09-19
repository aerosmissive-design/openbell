# Changelog — OpenBell PC Agent

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
