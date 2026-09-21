# 오픈벨 (OpenBell) 통합 인수인계서

| 항목 | 값 |
|------|-----|
| 문서 ID | **HANDOFF-MASTER** |
| 대상 | 모든 AI · 웹/감시 · 결제 · 리포터 · 팀장 |
| 저장소 | https://github.com/aerosmissive-design/openbell |
| 프로드 | https://openbell-fawn.vercel.app |
| 전광판 | https://openbell-fawn.vercel.app/board |
| 스냅샷 버전 | **웹 3.9.84** (VERSION / APP_VERSION) |
| 작성·갱신 | 2026-09-21 · 버전 올릴 때마다 이 파일을 같이 갱신한다 |

> **규칙:** 새 버전을 `main`에 올릴 때 `VERSION` · `src/lib/app-version.ts` · **이 문서(HANDOFF.md)** 를 함께 맞춘다.  
> AI는 작업 전 `https://raw.githubusercontent.com/aerosmissive-design/openbell/main/HANDOFF.md` 와 `VERSION` 을 읽는다.

관련 세부 문서(대체하지 않음):

- HANDOFF-URL-1 — 예매 링크·알림·에이전트 URL 계약  
- HANDOFF-SEAT-1 — 3.9.75 잔여석 출처·GAS seatmap (결제파트 인수인계)  
- HANDOFF-2 — 통합(이전)

---

## 0. 한 줄 결론

오픈벨은 **CGV·메가박스 특별관 예매 오픈·잔여석 알림** 웹앱이다.  
감시 화면의 숫자는 **정직해야** 하고, **최종 결제는 사람**이 한다.

| 한다 | 하지 않는다 |
|------|-------------|
| 출처+실제 조회/도착 시각 표시, 없으면 「없음」 | 현재 시각을 「○일 ○○:○○ 기준」으로 위조 |
| GAS·리포터·우회로 잔여석 칠하기 | GAS를 booking API·결제 세션으로 쓰기 |
| 알림은 키 대기 없이 발송 | HARD STOP 해제, 캡차 우회, 비번 자동입력 |
| 프로드 URL 고정 openbell-fawn.vercel.app | 무단 main 머지·시크릿 Git 기록 |

---

## 1. 시스템 지도

```
[사용자 브라우저] 오픈벨 웹 (Vercel / TanStack Start)
       │
       ├─ 감시/설정/알림/별표/전광판 UI
       ├─ scanCinema / pingSeatmap  (서버 함수)
       │     ├─ 공홈 · 네이버 · KT · MKA(mcp.aka.page) · 메가 모바일
       │     ├─ PC/NAS seat-report
       │     └─ GAS /exec?op=status|seatmap|pack  (예비)
       │
       ├─ Neon (app_meta, booking_session)  ← 쿼터 시 API 실패 가능
       │
[집]   ├─ PC Reporter / NAS Reporter → 출처 G_PC / G_DS423+ / G_DS225+
       └─ PC Agent → HARD STOP (결제 버튼 안 누름)

[GAS]  Google Apps Script 웹앱
       · 트리거 checkOpenSeats (1 또는 5 또는 10분 중 하나)
       · liveConfig ← 웹 GUI 동기화 (code.js는 시드)
       · 메일/텔레그램 예비 + seatmap/pack
```

### 출처 칸 의미

| 칸 | 실제 출처 |
|----|-----------|
| 공홈 | 극장 공식 |
| G_PC | 집 PC 리포터 |
| G_DS423+ / G_DS225+ | 시놀로지 NAS 리포터 (기기별) |
| KT 우회 | KT 쇼무비 |
| 메가 모바일우회 | 메가 모바일 API (`mega-mobile`) |
| MKA 우회 | **mcp.aka.page** (메가 공홈·유튜브 아님) |
| 네이버 | 네이버 시간표 |
| 용아맥채널 | 용산 IMAX 채널류 |
| GAS | Apps Script (`gas-cache`) |

같은 회차는 **가장 최근 도착 숫자**를 쓴다.

---

## 2. 버전 스냅샷 (3.9.75 → 3.9.83)

| 버전 | 요지 |
|------|------|
| **3.9.75** | 설정 출처 라벨 복구; GAS seatmap→감시 잔여석; wall-clock 「기준」 금지 방향 |
| **3.9.76–78** | 출처 표·회차 카드 출처+도착시각; seatCheckedAt에 시계 now 금지 |
| **3.9.79** | 출처 표 10칸 분리 (G_DS423+/G_DS225+/MKA/메가모바일/GAS/용아맥 등) |
| **3.9.80** | **GAS 칸 「없음」 수정** — `readGasSourceTimes`가 `op=status`의 `gasLastRun`을 `gas-cache`에 반영. 회차 줄은 **같은 출처** 도착시각 우선 |
| **3.9.82** | GAS `/exec` 기본 GET이 전광판 HTML. 저장만 하고 설치 안 하면 하얀 화면 `openbell` |
| **3.9.83** | 3.9.82 설정 JSX 빌드 실패 수정. 프로드 헤더 3.9.83 |
| **3.9.84** | 리포터→GAS dual-post. G_PC/G_DS 칸 반영. POST 302 유지. 저장 청크 |

### 3.9.80 핵심

1. GAS가 살아도 예전엔 `gas-cache: map: {}` 고정 → 표 전부 「없음」. **GAS 미동작이 아니라 베셀 미연결.**
2. 설정에 **GAS /exec URL** 필요.
3. 트리거 1·5·10은 **동시 3개가 아니라 선택 1개**.
4. `voidNasJobs` 소스에 없음 → `void enqueueNasFromAlert(...)`.

---

## 3. GAS

- `CONFIG` in code.js = 배포 시 시드. 실행 시 `liveConfig`가 덮어씀.
- GUI 영화 변경 → liveConfig → 다음 스캔부터 적용.
- `checkOpenSeats` + `ensureTrigger_()` (주기 하나).
- 3.9.80: 베셀이 `gasLastRun`을 표 GAS 칸에 표시.
- 3.9.82: `/exec` 또는 `?op=board` → GAS 전광판. 저장 후 **설치** 실행 필요.
- GAS ≠ booking API. 숫자 보여도 세션 생존 신호 아님.

---

## 4. 감시 UI · 잔여석

| 표시 | 의미 |
|------|------|
| `9.21일 15:30 조회 · KT 우회조회` | 출처 도착/조회 시각 |
| `잔여석 출처 없음` | 히트·시각 없음 → Agent 빈좌석 확정 금지 |
| (금지) `N.NN일 HH:MM 기준` | 현재시계 위조 |

`seatStatusLine`: seatCheckedAt → 동일 출처 theaterTimes → 최후 latest.  
`scan-impl`: 출처 map + `readGasSourceTimes(gasWebUrl)`.

회차 있는데 「시간표를 못 가져왔습니다」: fast/full 병합 시 error 잔존 가능 → showtimes 있으면 error null.

---

## 5. 결제 · HARD STOP (유지)

- 최종결제/purchase 클릭 금지. CAPTCHA 금지. 비번 자동입력 금지.
- 프로드 URL: openbell-fawn.vercel.app 만.
- 메가박스 ≠ CGV Agent.
- 상태: … → BOOKING_INFO → PAYMENT_READY → WAITING_USER.
- URL 계약: HANDOFF-URL-1 / 3.9.74 유지.

---

## 6. 리포터

G_PC / G_DS423+ / G_DS225+. 리포터 ≠ 예매 Agent. NAS_WORKER_TOKEN PC/NAS 패키지 혼동 주의.

v11.26부터 베셀 `/api/seat-report` 와 붙여넣은 GAS `/exec`(여러 개, `GAS_WEB_URLS`)에 **같이** 보낸다.
GAS POST는 302에서도 POST를 유지. 로그 `[GAS 저장] {ok:true}` 가 정상. HTML이면 설치(새 배포) 전.
웹 3.9.84 템플릿이 있어야 GAS 전광판 G_PC/G_DS 칸이 채워진다. 설정 → 구글스크립트 설치.

---

## 7. 자주 만지는 파일

| 경로 | 역할 |
|------|------|
| `VERSION`, `src/lib/app-version.ts` | 화면 버전 |
| `HANDOFF.md` | 이 문서 |
| `src/lib/cinema/scan-impl.server.ts` | runScan, GAS 시각 |
| `src/lib/cinema/seats.ts` | seatStatusLine |
| `src/lib/cinema/types.ts` | SEAT_SOURCE_COLUMNS, DEFAULT_HOLD |
| `src/lib/cinema/gas-script.ts` | GAS 템플릿 |
| `src/components/cinema-app.tsx` | 스캔 병합, NAS enqueue |
| `src/components/watch-view.tsx` / `theater-picks.tsx` | 감시·출처 표 |

**금지:** 파일을 `PLACEHOLDER` 한 줄로 덮어쓰기.

---

## 8. AI 체크리스트

시작 전: VERSION + 이 HANDOFF.md 읽기. HARD STOP/프로드 URL 함부로 변경 금지.

커밋 시: 기능 → VERSION/APP_VERSION → **HANDOFF.md 갱신** → 배포 READY → 빌드/PLACEHOLDER 확인.

스모크: 설정 GAS 칸 · 회차 출처 줄 · GAS op=status · booking≠GAS · 결제 클릭 로그 없음.

---

## 9. 전달 문장

**감시:** 3.9.80까지 출처 표 정직화. GAS 돌면 GAS 칸에 gasLastRun. 회차 줄은 출처 시각이지 지금 시계가 아님.

**결제:** 화면 잔여석 ≠ Neon booking. GAS는 숫자·메일 예비. HARD STOP·URL 계약 유지. 잔여석 보인다고 실예매 가능이라 쓰지 말 것.

---

## 10. 팀장 미결

얎은 URL vs 키 필수 · 감시→잡 자동 vs 수동 · Neon 장애 시 GAS만으로 Agent 상시 가동(웹 권장: 반대).

---

## 11. 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-09-21 | 3.9.84 | 리포터 GAS dual-post · G_DS 라벨 · POST 302 유지 · 속성 청크 · 보드 G_PC/G_DS 표시 |
| 2026-09-21 | 3.9.80 | HANDOFF-MASTER 초판. GAS 칸·seatStatusLine·HARD STOP·SEAT-1 통합 |

**END HANDOFF-MASTER**
