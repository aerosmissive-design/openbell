# 오픈벨 인수인계 — v3.9.60 (2026-09-19 17:47 KST)

시크릿(봇 토큰, OAuth, DB URL, KT 쿠키, Neon URL)은 넣지 않습니다.

## 제품

한국 CGV·메가박스 특별관 예매 오픈/잔여석 알림.
- GitHub: https://github.com/aerosmissive-design/openbell (`main`)
- Vercel Production: https://openbell-fawn.vercel.app
- 프로젝트: `openbell` (`prj_Gsr0EPNyd5ylbrVd4Emt5bUCMnq1`, team holdhyun)
- 스택: TanStack Start + React 19 + Tailwind v4 + Zustand + Better Auth
- 감시: `/api/watch-tick` (GitHub Actions `vercel-watch` 5분 + Vercel cron)
- 팔레트: `#0c0c0d` `#f4f1ea` `#9aaa96`. 네온/금/보라 금지. 한국어 UI. 요청한 것만.

## 현재 배포 (검증됨)

| 항목 | 값 |
|---|---|
| 라이브 헤더 | **v3.9.60** |
| GitHub HEAD | `14bfe34` |
| Vercel | READY, alias `openbell-fawn.vercel.app` |
| 직전 실패 | v3.9.59 (`6692027`, `bf38215`) — 앱 빌드 성공, `db:migrate` Neon 쿼터 `53000`으로 exit 1 |

## 이번 세션에서 한 일

클로드 세션에서 KT XML 매핑(`ScreenCd`→`scnsNo`, `PlayNum`→`scnSseq`, 패딩 없음)을 사용자 클릭으로 확정한 뒤 이어서 처리.

### 1) 원래 4개 버그 (v3.9.58, `1d766bd`)

사용자가 라이브에서 본 것:

1. 메가박스 공홈에 잔여석이 보이는데 앱에는 안 붙는 것처럼 보임 → 분석 + `toShowtime`에 `seatSource=official` / `seatCheckedAt` 연결, 메가 조회 일수 5일로 캡.
2. 빨간 조회시각이 회차엔 있는데 설정 탭 현황엔 없음 → overlay + `timesFromShowtimes`를 `seatSourceTimes`에 합침.
3. 코엑스 펼치면 시간표가 있는데도 「시간표를 못 가져왔습니다」 → 회차가 있으면 경고 숨김. 네이버는 함수가 살아 있고 `runScan` 호출만 빠져 있었음 → 재연결.
4. 잔여석이 떠 있다가 화면 나갔다 오면 사라짐 → `overlayShows`를 zustand persist에 넣음 (극장당 450개 캡).

추가로: 알림 URL이 `byId` 덮어쓰기로 KT 정밀 URL을 잃을 수 있어서 `runScan` 병합을 `mergeShowtimes`로 바꿈 (점수: Megabox playSchdlNo 100 > CGV scnsNo+scnSseq 95 > 영화 URL 75 > 극장 fallback 20).

### 2) 용산 잔여석 「없음」 (v3.9.59, `6692027`)

실측 (이 샌드박스에서):
- 메가박스 `schedulePage.do` → 잔여석 있음 (코엑스 샘플 47회차).
- KT `GetMovieTitle` → 쿠키 없이 XML 200.
- mcp.aka.page → 302.
- 네이버 placeId **용산 `12298207`** HTML에 `MovieTime`/`rtime` 있음. 잘못된 ID는 껍데기만.

구멍: `pingSeatmap`(극장 새로고침)이 공홈 → relay → NAS만 보고 **KT를 안 봄**. 용산 공홈이 막히면 출처 없음.

조치:
- 새로고침에 KT(오늘·내일, 8초) + 네이버 시간표 병렬.
- fast 스캔에도 KT 5초.
- 네이버 파서: `\"` 이스케이프 해제 후 `"__typename":"MovieTime"` 분할.

### 3) 배포가 안 따라옴 (v3.9.60, `14bfe34`)

v3.9.59 vite/nitro 빌드는 성공. 실패 원인:

```
[migrate] failed: Your account or project has exceeded the quota.
[migrate]   code: 53000
Error: Command "npm run build" exited with 1
```

`npm run build` = `vite build && npm run db:migrate`. 스키마는 이미 있는데 Neon 쿼터가 배포를 죽임.

조치: `scripts/migrate.mjs`에서 `53000` / quota / compute time / too many connections 이면 경고만 하고 exit 0.

라이브 헤더 **v3.9.60** 확인 완료 (2026-09-19 17:36 UTC 배포 READY).

## 소스 우선순위 (의도)

시간표: 네이버 → relay → KT → 공홈 → NAS (나중 레이어가 덮어씀, URL은 점수 높은 쪽이 승).
잔여석 맵: relay → KT → 공홈 → 메가 → NAS. 빈 맵은 키를 안 덮음.
출처 표시: `latestSeatSourceTimes`가 맵 timestamp 기준. 공홈 히트가 있으면 official이 먼저 보임.

## 아직 / 다음 AI가 확인할 것

1. **사용자 실클릭**
   - 용산 펼침 → 새로고침 → 잔여석이 KT로 뜨는지.
   - 영등포 「바로 예매」 빨간 테두리 (`scnsNo`+`scnSseq`). 용산만 클릭 검증됨.
   - 예매 알림 테스트 메일/텔레그램 링크에 정밀 URL이 가는지.
2. **watch-alive** 지금 `lastRunAt: 0`, `alive: false`. 콜드스타트이거나 `/api/watch-tick`이 500. GitHub `vercel-watch`가 이전에 watch-tick 500으로 실패했음. 알림이 안 오면 크론/Neon부터.
3. **Neon 쿼터** — 배포는 우회했지만 DB 쓰기가 막혀 있으면 로그인·알림 기록이 깨질 수 있음. 플랜/컴퓨트 리셋 필요할 수 있음.
4. **네이버** Vercel IP가 봇 페이지를 주면 시간표 안전망이 다시 빔. placeId: 용산 12298207, 영등포 13141635, 코엑스 12307868, 남양주 1542146675.
5. **mcp 우회** 현재 302. 기대하지 말 것.
6. 다른 브랜치 `pc-agent-v2`가 같은 Vercel 프로젝트에 preview를 올림. main 웹앱과 섞지 말 것.

## 파일 지도 (이번 수정)

- `src/lib/cinema/scan-impl.server.ts` — runScan 네이버+mergeShowtimes, pingSeatmap에 KT/네이버, fast KT
- `src/lib/cinema/kt.server.ts` — ScreenCd/PlayNum → 정밀 URL (클로드 dc58fbf)
- `src/lib/cinema/cgv.server.ts` / `megabox.server.ts` — 네이버 파서 이스케이프, 메가 seatSource
- `src/lib/store.ts` — overlayShows persist
- `src/components/watch-view.tsx` — 회차 있으면 시간표 에러 숨김
- `src/components/cinema-app.tsx` — 설정 탭 조회시각 병합
- `scripts/migrate.mjs` — Neon 쿼터 fail-open
- `VERSION` / `src/lib/app-version.ts` — 3.9.60

## 절대 하지 말 것

- 사용자 KT 로그인 쿠키를 코드/깃/로그에 넣지 말 것.
- CAPTCHA 우회, 결제 버튼 자동 클릭 금지. 결제 직전 STOP.
- GAS 설치 UX 재도입 금지. 메일은 서버가 보냄.
- 큰 개편 금지. 요청한 것만.
- 무비차트 9개 3×3, 알림 카드 기본 접힘, 메일 주소 입력란 없음, 아이폰 Notification 토스트 금지.
