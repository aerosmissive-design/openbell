# 오픈벨 PC 도우미

나스 없이 **내 PC가 켜져 있을 때만** 예매 도우미를 돌립니다.

- 베셀 오픈벨 = 감시·알림 (24시간)
- PC 도우미 = PC 켜져 있을 때만 좌석 시도 → 결제 직전 멈춤 → 텔레그램 안내

PC를 끄면 도우미만 멈추고, **알림은 베셀에서 계속** 옵니다.

---

## 준비 (한 번)

### 0) 베셀 토큰
이미 했다면 건너뛰기.

1. Vercel → openbell → Settings → Environment Variables
2. `NAS_WORKER_TOKEN` = 긴 비밀번호
3. Production 저장 → **Redeploy**

### 1) Node.js 설치
1. https://nodejs.org 에서 **LTS** 설치
2. 설치 후 확인 (터미널):

```bash
node -v
npm -v
```

숫자가 나오면 OK.

### 2) 코드 받기
1. https://github.com/aerosmissive-design/openbell → Code → Download ZIP
2. 압축 풀기
3. 폴더 `openbell-main` (또는 openbell) 위치 기억

### 3) 설정 파일 만들기
1. `pc` 폴더로 이동
2. `env.example` 파일을 복사해서 이름을 **`.env`** 로 변경
3. 메모장으로 `.env` 열고 값 수정:

```env
OPENBELL_URL=https://openbell-fawn.vercel.app
NAS_WORKER_TOKEN=베셀에_넣은_그_비밀번호
TELEGRAM_BOT_TOKEN=텔레그램_봇_토큰
TELEGRAM_CHAT_ID=채팅_ID숫자
```

- URL 끝 `/` 없이
- 텔레그램은 오픈벨 설정에 쓰는 것과 같게 (없으면 비워도 동작, 결제 안내만 안 옴)

### 4) 패키지 설치
터미널에서:

**Windows (PowerShell / CMD)**

```bat
cd 압축푼폴더\nas\worker
npm install
```

**Mac / Linux**

```bash
cd 압축푼폴더/nas/worker
npm install
```

### 5) 극장 로그인 쿠키 (한 번)
PC에서 브라우저 창이 열립니다. 로그인만 하면 됩니다.

**Windows** — `pc` 폴더의 `login-cgv.bat` / `login-megabox.bat` 더블클릭

또는 터미널:

```bat
cd 압축푼폴더\nas\worker
mkdir data 2>nul
set HEADLESS=0
set PLAYWRIGHT_STATE_DIR=./data
node login-setup.mjs cgv
```

로그인 후 터미널에서 **Enter**

메가박스:

```bat
node login-setup.mjs megabox
```

`nas\worker\data\storage-cgv.json` 등이 생기면 성공.

---

## 평소에 켜는 법

PC를 켜 두고 예매 시즌에만:

### Windows
`pc\start.bat` **더블클릭**

창에 `[나스도우미] v3 시작` (이름은 나스용이지만 PC에서도 동일) 이 보이면 OK.  
`.` 점이 찍히면 대기 중.

끄려면 그 검은 창에서 **Ctrl+C** 또는 창 닫기.

### Mac / Linux

```bash
cd 압축푼폴더/pc
chmod +x start.sh
./start.sh
```

---

## 동작 확인

1. PC 도우미 창이 켜진 상태
2. 오픈벨에서 감시 중인 영화 알림이 뜨면
3. 자동으로 잡이 들어가고, PC 창에 `[잡]` 로그
4. 텔레그램에 결제 안내 (토큰 넣었을 때)

PC가 꺼져 있으면: **알림만** 오고 좌석 시도는 안 함 → 직접 예매.

---

## 나스랑 같이 쓰면?

둘 다 켜면 **같은 잡을 서로 가져갈 수 있음**.  
→ **PC 켤 때는 나스 워커 끄기**, 또는 하나만 쓰기.

---

## 문제

| 증상 | 확인 |
|------|------|
| unauthorized | `.env` 토큰 = 베셀과 동일한지, 베셀 Redeploy 했는지 |
| 로그인 필요 | login-setup 다시, `data/storage-*.json` 있는지 |
| 창 바로 꺼짐 | 터미널에서 `start.bat` 실행해 에러 글자 보기 |
