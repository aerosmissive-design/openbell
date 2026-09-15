# 오픈벨 집 리포터

CGV 공홈 잔여석(특히 IMAX)을 집 PC 또는 NAS에서 읽어 오픈벨로 보냅니다.
오픈벨은 **공홈 → 집 직접조회 → KT → 우회조회** 순으로 쓰니다.

- `pc/` 어느 PC에서든 `시작.bat` / `시작.command` 더블클릭
- `nas/` 시놀로지 Container Manager에서 폴더 선택 후 생성

베셀 환경변수 `NAS_REPORT_TOKEN`(또는 이미 있는 `NAS_WORKER_TOKEN`)과 리포터의 토큰이 같아야 합니다.
