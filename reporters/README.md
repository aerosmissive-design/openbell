# 오픈벨 집 리포터

CGV 공홈 잔여석(특히 IMAX)을 집 PC 또는 NAS에서 읽어 **베셀**과 **GAS 웹앱**으로 보냅니다.
오픈벨은 **공홈 → 집 직접조회(G_PC/G_DS*) → KT → 우회조회** 순으로 쓭니다.

- `pc/` 어느 PC에서든 시작 스크립트 실행
- `nas/` 시놀로지 Container Manager에서 폴더 선택 후 생성

## 환경변수

| 키 | 설명 |
|----|------|
| `OPENBELL_URL` | 베셀 주소 (기본 openbell-fawn.vercel.app) |
| `NAS_REPORT_TOKEN` | 베셀 `NAS_REPORT_TOKEN` / `NAS_WORKER_TOKEN` 과 동일 |
| `GAS_WEB_URLS` | GAS `/exec` 주소 **여러 개** (쉼표·줄바꿈·세미콜론 구분) |
| `GAS_WEB_URL` | 단일 URL 하위호환 |
| `GAS_SYNC_KEY` | 오픈벨 설정 `gasSyncKey` 와 동일 (GAS에 키가 있으면 필수) |
| `REPORT_SOURCE` | `pc` / `nas423` / `nas225` — 출처 칸 구분 |

GAS는 POST body `{ theaterId, mode, source, showtimes, key? }` 를 받아  
`handleSeatReport_` → 전광판·showcache에 G_PC / G_DS423+ / G_DS225+ 로 반영합니다.

베셀 환경변수 토큰과 리포터 토큰이 같아야 Vercel 전송이 됩니다.


## GUI 패키지 (실제로 쓰는 zip) v11.26

- `gui-pc/` Windows 원클릭 + Edge 화면 수집. 출처 고정 G_PC.
- `gui-nas/` 시놀로지. `REPORT_SOURCE=nas423` 또는 `nas225`.

GUI 상단에 GAS `/exec` 주소를 붙여넣으면 베셀과 동시에 보냅니다.
Apps Script는 **저장 후 설치(새 배포)** 가 되어 있어야 합니다. 하얀 화면 `openbell` 만 보이면 설치 전입니다.
