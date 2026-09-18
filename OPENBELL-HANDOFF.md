# 오픈벨 인수인계 — v3.9.58 (2026-09-19)

시크릿(봇 토큰, OAuth, DB URL, KT 쿠키)은 넣지 않습니다.

## 제품

한국 CGV·메가박스 특별관 예매 오픈/잔여석 알림.
GitHub: https://github.com/aerosmissive-design/openbell
Vercel: https://openbell-fawn.vercel.app
브랜치: main

팔레트: #0c0c0d #f4f1ea #9aaa96. 네온/금/보라 금지. 한국어 UI. 요청한 것만.

## 이번 세션에서 확정된 것

### 1. CGV 정밀 예매 URL (빨간 테두리)

KT GetPlayTime XML을 사용자가 직접 캡처하고, URL 6개를 클릭해 검증함.

- 맞음: `ScreenCd` → `scnsNo`, `PlayNum` → `scnSseq` (패딩 없음, `1` 이지 `01` 아님)
- 아님: TAGHTML2 안의 `01`/`24`/`26`
- 코드: `src/lib/cinema/kt.server.ts` 의 `ktCgvBookingUrl()`
- 예: `https://cgv.co.kr/cnm/movieBook/movie?movNo=30001323&scnYmd=20260920&siteNo=0013&siteNm=용산아이파크몰&scnsNo=001&scnSseq=1`

우회조회(mcp.aka.page)는 이 필드를 원래 안 줌. 한계임.

v3.9.58에서 `runScan` 병합을 `byId` 덮어쓰기에서 `mergeShowtimes()`로 바꿈. 같은 회차면 정밀 URL 점수(scnsNo+scnSseq=95, 메가 playSchdlNo=100)가 극장/영화 URL을 이김. 예매 알림 테스트도 정밀 URL 있는 회차를 우선 고름.

### 2. 네이버 복구

이전 세션은 "네이버 구현이 저장소에 없다"고 보류함. 실제로는 함수가 남아 있고 호출만 빠져 있었음.

- `fetchCgvNaver` — `src/lib/cinema/cgv.server.ts`
- `fetchNaverMegabox` — `src/lib/cinema/megabox.server.ts`
- v3.9.58 `runScan`이 fast/full 모두 네이버를 4초 시한으로 다시 호출함.

CGV는 공홈이 막혀 있어서 네이버가 시간표 1차. 메가박스는 공홈이 되면 공홈, 안 되면 네이버.

### 3. 같이 고친 UI 버그

- 코엑스 펼침 경고: 회차가 있으면 "시간표를 못 가져왔습니다"를 숨김. fast 빈 스캔은 실패로 안 찍음.
- 설정 탭 빨간 조회시각: 메가박스 공홈 회차에 `seatSource=official` + `seatCheckedAt`을 붙이고, 화면 회차에서도 시각을 뽑아 설정 표와 합침.
- 잔여석 사라짐: `overlayShows`를 zustand persist에 넣음. 나갔다 와도 직전 회차+잔여석이 남고, 새 스캔이 오면 최신으로 덮음.
- 메가박스 공홈 스캔 날짜를 5일로 캡. 예전엔 daysAhead 전부라 8초 시한에 항상 타임아웃될 수 있었음.

## 아직 안 된 것

- Vercel 화면이 3.9.49에 멈춰 있던 상태였음. 3.9.50~3.9.57이 GitHub에 있어도 production alias가 안 따라간 적이 있음. 이번 푸시 후 https://openbell-fawn.vercel.app 헤더가 **v3.9.58**인지 꼭 확인할 것. 아니면 Vercel 대시보드에서 main 최신 배포를 Production에 연결.
- 네이버 HTML 파서가 위젯 구조를 바꾸면 다시 비게 됨. 그때는 Network 캡처가 필요.
- KT는 용산 클릭 검증됨. 영등포는 같은 API라 적용만 했고 별도 클릭 검증은 없음.
- 실제 예매 오픈 알림에서 빨간 테두리 URL이 가는지는 다음 알림/예매 테스트로 확인.

## 절대 하지 말 것

- 사용자 KT 로그인 쿠키를 코드/깃/로그에 넣지 말 것.
- CAPTCHA 우회, 결제 버튼 자동 클릭 금지.
- GAS 설치 UX 재도입 금지. 메일은 서버가 보냄.
- 브랜드 네온/금/보라 금지.
