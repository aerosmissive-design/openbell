# 오픈벨 전체 제품 설계도

처음 보는 AI는 이 문서, `HANDOFF.md`, `OpenBell_제품업그레이드제안서.md`, `VERSION` 순서로 읽는다. 시크릿, 결제 페이지 주소, 봇 토큰, 계정 비밀번호는 문서에 넣지 않는다. 현재 웹 버전은 `VERSION` 과 `src/lib/app-version.ts` 가 같다.

저장소: https://github.com/aerosmissive-design/openbell  
운영: https://openbell-fawn.vercel.app  
전광판: https://openbell-fawn.vercel.app/board

## 1. 제품이 하는 일

오픈벨은 CGV와 메가박스 특별관 예매가 열리거나 잔여석이 바뀔 때 알린다. 사용자가 자동예매로 고른 영화는 좌석을 잡아 결제 직전 화면까지 간다. 최종 결제 버튼은 누르지 않는다. 결제는 그 브라우저를 보고 있는 사람이 한다.

극장 네 곳이다.

| id | 극장 |
|----|------|
| cgv_yongsan | CGV 용산아이파크몰 |
| cgv_yeongdeungpo | CGV 영등포 |
| megabox_coex | 메가박스 코엑스 (지점 1351) |
| megabox_namyangju | 메가박스 남양주 |

황금열은 극장마다 고정된 메모다. 코엑스와 남양주는 돌비 관 기준이다. 사용자가 벨 탭에서 고친 값이 아니다.

## 2. 구성

```
브라우저 웹앱 (Vercel, TanStack Start)
  감시 · 차트 · 벨 · 별표 · 설정 · 전광판
  계정 동기화 (Neon user_settings)
        │
        ├─ 서버 감시 runWatchTick  (약 3분, 페이지 또는 GAS/크론이 /api/watch-tick)
        ├─ 자동예매 작업 enqueueNasJob
        │     ├─ Neon app_meta / booking_jobs
        │     └─ 실패해도 GAS 로 같은 작업 전달
        │
집 PC 에이전트 (agent/pc) ── 고정 크롬, 화면이 보이는 세션
집 NAS 에이전트 (agent/nas) ── 컨테이너. 리포터와 다른 프로세스
        │
        └─ 좌석 선택 후 PAYMENT_READY 에서 멈춤
              메일·텔레그램 (결제 URL 없음)

잔여석 리포터 (reporters/pc, reporters/nas)
  G_PC / G_DS225+ / G_DS423+
  예매 에이전트가 아니다. 클릭하지 않는다.

GAS 웹앱
  메일·텔레그램 예비, seatmap, 작업 보관
  op=seat 가 telegram=ok 여도 텔레그램 API 성공은 아니다.
  배포된 메일은 알림이 있으면 제목·한 줄·바로예매만 그린다.
```

Neon이 쿼터(`dbQuota`)나 연결 오류면 작업 목록 조회가 실패할 수 있다. 그 경우에도 새로 넣는 작업은 GAS로 넘긴다. Neon이 설정의 원본이다.

## 3. 화면

벨 탭에 네 칸이 있다.

| 칸 | 저장 | 동작 |
|----|------|------|
| 알림 설정 영화 | 계정 `watchTitles` | 새 회차가 보이면 예매 오픈 알림. 그것만으로는 예매 작업을 만들지 않는다. |
| 자동예매 영화 | 계정 `prefs.autoMovies` | 그 영화의 아직 넣지 않은 회차마다 결제 직전 작업 1건. 지금 떠 있는 회차와 나중에 열리는 회차 모두. |
| 자동예매 회차 | 계정 `prefs.autoShows` | 그 회차가 상영표에 있으면 1건. 잔여석이 바뀌면 다시 1건. |
| 황금열 | 코드 `golden-rows.ts` | 좌석 우선순위 메모 |

이미 작업 키(`autoFired` 또는 브라우저 `openbell-autobook-fired`)가 있는 회차는 영화를 뺐다가 다시 넣어도 다시 넣지 않는다. 지난 날짜 회차는 상영표와 맞지 않아 작업이 되지 않는다.

클라이언트도 `planAutoBook`으로 넣고, 서버 `runWatchTick`도 넣는다. 같은 영화·극장·날짜·시각·상영관에 대기, 진행, 사용자확인 작업이 있으면 두 번째 작업은 만들지 않는다. 서버는 한 주기에 8건까지다.

## 4. 예매가 멈추는 곳

상태 흐름은 회차 확인, 인원, 좌석, 결제 직전(`PAYMENT_READY`), 사용자 대기이다.

하지 않는 일:

- 최종결제, 결제완료, 바로결제, 구매하기, 결제 화면의 금액이 적힌 결제 버튼을 누르지 않는다.
- 캡차를 풀지 않는다. 비밀번호와 OTP를 치지 않는다. 그 값을 저장하거나 출력하지 않는다.
- 알림에 결제 페이지 주소를 넣지 않는다. 링크는 예매 홈만 둔다.
- 카카오 알림톡은 사업자 채널 확인 전에는 보내지 않는다. 로그인된 고정 프로필에서 카카오 로그인 버튼을 누르는 것은 허용된다.

메가박스 좌석 유지는 그 크롬 프로필 안에만 있다. 메일 링크를 다른 기기에서 열면 잡힌 좌석이 따라오지 않는다.

PC 에이전트는 사용자가 보는 고정 프로필 크롬에만 붙는다. 숨은 세션의 크롬이나 일상 크롬을 쓰지 않는다. 메가박스 로그인 쿠키는 그 프로필의 “중단한 위치에서 계속”으로 남는다.

NAS 예매 에이전트 문서상 위치는 저장소의 `agent/nas` 이다. `reporters/nas` 와 `nas/worker` 는 다른 것이다. 문서상 CGV 잡을 처리하고, 메가박스 잡은 실패로 되돌린다. 클릭은 `AGENT_ENABLED=1` 인 한 대만 한다. 실제 나스 디스크 경로는 접속해서 확인하기 전에는 확정하지 않는다. DS423+ 접근 금지가 적힌 유지보수에서는 그 호스트를 탐색하지 않는다.

## 5. 알림

웹앱 테스트 메일·텔레그램은 서버 경로라 실패하면 실패로 보인다. GAS `notify_` 는 텔레그램 API가 거절해도 `telegram=ok` 를 남길 수 있다. 도착 확인은 받은 메시지 또는 텔레그램 API의 `ok:true` 로 한다.

결제 대기 알림은 에이전트가 결제 직전 화면에 도착한 뒤에만 나간다. 제목에 좌석과 금액과 시각이 보이게 한다. 본문에 결제 URL을 넣지 않는다. 배포된 GAS HTML은 긴 본문을 버리고 제목을 이스케이프한다. 색이 있는 메일은 GAS를 고쳐 다시 배포하기 전에는 GAS 경로로 나가지 않는다.

계정 메일은 서로 다른 받은편지함이다. 한 계정에만 보내면 나머지는 받지 못한다.

## 6. 자주 여는 파일

| 경로 | 역할 |
|------|------|
| `VERSION`, `src/lib/app-version.ts`, `HANDOFF.md` | 버전과 인수인계. 같이 맞춘다. |
| `src/lib/cinema/auto-book-run.ts` | 자동예매 계획 |
| `src/components/cinema-app.tsx` | 브라우저에서 계획 실행, 작업 enqueue |
| `src/components/cloud-sync.tsx`, `src/lib/cinema/cloud.ts` | 계정 저장. prefs 병합은 `autoFired` 를 지우지 않는다. |
| `src/lib/cinema/watch-tick.server.ts` | 서버 감시와 자동예매 |
| `src/lib/cinema/nas-jobs.server.ts` | 작업 중복과 GAS 전달 |
| `src/lib/cinema/gas-script.ts` | GAS 템플릿. 고친 뒤 사용자가 다시 배포해야 적용된다. |
| `agent/pc` | PC 예매 에이전트 |
| `agent/nas` | NAS 예매 에이전트 |
| `reporters/` | 잔여석 리포터 |

## 7. 배포

`main` 에 올리면 운영 주소로 배포된다. 배포 전에는 벨 탭 버전이 이전 번호다. 배포 뒤에 새로고침하면 `APP_VERSION` 이 보인다. GAS 템플릿은 깃 배포만으로 구글 스크립트가 바뀌지 않는다.
