# 나스 도우미 (베셀 연동)

베셀 오픈벨이 “잡아줘” 작업을 쌓아 두면, 집 나스가 주기적으로 가져갑니다.

**지금은 1단계:** 작업 내용만 로그로 남기고, 직접 결제하라고 표시합니다.  
좌석 자동 클릭은 다음 단계입니다. **결제는 절대 자동으로 하지 않습니다.**

---

## 준비 (한 번만)

### A. 베셀에 토큰 넣기

1. [Vercel](https://vercel.com) → openbell 프로젝트 → Settings → Environment Variables
2. 추가:
   - 이름: `NAS_WORKER_TOKEN`
   - 값: 아무 긴 비밀번호 (예: 키보드로 아무거나 20자 이상)
3. Production 에 체크 → Save
4. **Redeploy** 한 번 (환경변수 적용)

> `CRON_SECRET` 이 이미 있으면, 같은 값을 `NAS_WORKER_TOKEN` 으로 써도 됩니다.

### B. 나스에서 워커 켜기

1. 이 `nas/worker` 폴더를 나스에 복사
2. `docker-compose.yml` 열어서:
   - `OPENBELL_URL` → 본인 베셀 주소
   - `NAS_WORKER_TOKEN` → 베셀에 넣은 **같은** 토큰
3. Container Manager → 프로젝트 → 이 compose 로 실행
4. 로그에 `[나스도우미] 시작` 과 `.` 이 보이면 성공

---

## 테스트 (작업 하나 넣어 보기)

PC 터미널에서 (토큰·URL 바꿔서):

```bash
curl -X POST "https://openbell-fawn.vercel.app/api/nas-jobs" \
  -H "Authorization: Bearer 여기에_토큰" \
  -H "Content-Type: application/json" \
  -d '{
    "movieTitle": "테스트영화",
    "theaterId": "cgv_yongsan",
    "playDate": "2026-09-20",
    "startTime": "19:30",
    "hallName": "IMAX관",
    "bookingUrl": "https://cgv.co.kr",
    "seats": 2,
    "zone": "center"
  }'
```

15초 안에 나스 로그에 `[잡 수신]` 이 뜨면 연결 성공입니다.

---

## API 요약

| 하는 일 | 방법 |
|---------|------|
| 작업 넣기 | `POST /api/nas-jobs` + Bearer 토큰 |
| 나스가 가져가기 | `GET /api/nas-jobs?claim=1` |
| 결과 보고 | `PATCH /api/nas-jobs` `{ id, status, resultMessage }` |

status: `done` | `failed` | `need_user` (캡차·직접결제)

---

## 다음 단계 (아직 안 함)

- Playwright 로 예매 URL 열어 좌석 클릭
- 결제 페이지에서 멈춤
- 텔레그램으로 “결제하세요” 알림
