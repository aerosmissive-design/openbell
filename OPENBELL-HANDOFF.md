# 오픈벨 인수인계 — v3.9.59 (2026-09-19)

시크릿(봇 토큰, OAuth, DB URL, KT 쿠키)은 넣지 않습니다.

## 제품

한국 CGV·메가박스 특별관 예매 오픈/잔여석 알림.
GitHub: https://github.com/aerosmissive-design/openbell
Vercel: https://openbell-fawn.vercel.app
브랜치: main

팔레트: #0c0c0d #f4f1ea #9aaa96. 네온/금/보라 금지. 한국어 UI. 요청한 것만.

## 이번 세션

### v3.9.58
- 네이버 함수는 저장소에 있었고 `runScan` 호출만 빠져 있었음. 재연결.
- KT `ScreenCd`→`scnsNo`, `PlayNum`→`scnSseq`(패딩 없음) 정밀 URL이 알림까지 가도록 `mergeShowtimes` 병합.
- 회차 있으면 시간표 실패 경고 숨김. overlayShows persist. 메가박스 공홈 `seatSource=official`.

### v3.9.59
- 확인: 메가박스 공홈 schedulePage는 잔여석을 줌. KT GetMovieTitle은 쿠키 없이 응답. mcp.aka.page는 302.
- 네이버 올바른 placeId(용산 12298207) HTML에는 `MovieTime`/`rtime`이 살아 있음. 잘못된 ID는 껍데기 HTML만 옴.
- **구멍:** `pingSeatmap`(극장 새로고침)에 KT가 없어서 용산 공홈이 막히면 잔여석 출처가 없음으로 남음.
- 조치: 새로고침에 KT(오늘·내일, 8초) + 네이버 시간표 병렬. fast 스캔에도 KT 5초.

## 아직
- 영등포 빨간 테두리 클릭 확인은 사용자 쪽.
- 예매 알림 테스트에서 `scnsNo`/`scnSseq`가 실제로 가는지 확인 필요.
- Vercel IP에서 네이버가 봇 페이지를 주면 시간표 안전망은 다시 빔.
- watch-alive `lastRunAt: 0`은 콜드스타트/크론 미실행일 수 있음. 알림이 안 오면 `/api/watch-tick` 크론부터.

## 절대 하지 말 것
- 사용자 KT 로그인 쿠키를 코드/깃/로그에 넣지 말 것.
- CAPTCHA 우회, 결제 버튼 자동 클릭 금지.
- GAS 설치 UX 재도입 금지.
