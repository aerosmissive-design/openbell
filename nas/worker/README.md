# 나스 도우미 v2 (Playwright)

베셀 작업을 받아 브라우저로 예매를 시도하고, **결제 직전에서 멈춥니다.**

---

## 준비되면 할 일

### 베셀
1. `NAS_WORKER_TOKEN` 환경변수 추가
2. Redeploy ( `/api/nas-jobs` 포함된 최신 배포 )

### 나스 (DS423+ 권장, RAM 여유)
1. `nas/worker` 폴더 업로드
2. `docker-compose.yml` 토큰·URL 수정
3. Container Manager로 빌드·실행 (첫 빌드 김)
4. 로그: `[나스도우미] v2 시작`

### 테스트
```bash
curl -X POST "$URL/api/nas-jobs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"movieTitle":"테스트","theaterId":"cgv_yongsan","playDate":"2026-09-20","startTime":"19:30","bookingUrl":"https://실제_예매_URL","seats":2,"zone":"center","preferredSeats":["G8","G9"]}'
```

---

## 동작 요약

| 상황 | 결과 status |
|------|-------------|
| 결제 화면 근처까지 감 | `done` (결제 클릭 안 함) |
| 캡차·로그인 필요 | `need_user` |
| 좌석 UI 못 찾음 | `need_user` |
| 오류 | `failed` |

결제하기/결제완료 버튼은 페이지 스크립트로 **클릭 차단**합니다.

---

## 한계

- 사이트 UI 변경 시 `book.mjs` 셀렉터 수정 필요
- 로그인 쿠키 없으면 대부분 로그인 화면에서 멈춤 (연동은 이후)
- 예매 URL이 좌석 화면에 가까울수록 유리

---

## 파일

- `index.mjs` — 폴링
- `book.mjs` — Playwright + STOP
- `Dockerfile` / `docker-compose.yml`
