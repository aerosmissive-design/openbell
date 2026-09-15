# 나스 도우미 v3 — 할 일 최소

코드는 이미 들어가 있습니다. **아래만** 하면 됩니다.

---

## 1) 베셀 (한 번)

| 환경변수 | 값 |
|----------|-----|
| `NAS_WORKER_TOKEN` | 긴 비밀번호 |

저장 후 **Redeploy**

→ 알림 시 자동으로 나스 잡 등록 (`nasAuto` 기본 ON)

---

## 2) 나스

`docker-compose.yml` 수정:

- `OPENBELL_URL`
- `NAS_WORKER_TOKEN` (위와 동일)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (오픈벨 텔레그램과 같게 → 결제 안내)

Container Manager로 실행. 로그: `[나스도우미] v3 시작`

---

## 3) 로그인 쿠키 (한 번)

```bash
cd nas/worker && npm i
HEADLESS=0 PLAYWRIGHT_STATE_DIR=./data node login-setup.mjs cgv
# 로그인 후 Enter
HEADLESS=0 PLAYWRIGHT_STATE_DIR=./data node login-setup.mjs megabox
```

`data/storage-*.json` 을 컨테이너 `/data` 에 넣기.

---

## 흐름

알림 → 큐 → 나스 좌석 시도 → **결제 직전 STOP** → 텔레그램 “결제하세요”

결제 버튼은 누르지 않습니다.
