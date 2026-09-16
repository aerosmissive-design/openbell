# 오픈벨 (Openbell) v3.9.27

CGV·메가박스 특별관 예매가 열리거나, 별표한 회차의 잔여석이 변하면 메일·텔레그램·카톡으로 알려 주는 웹앱입니다. 예매를 누르면 좌석을 찍고 결제 화면까지만 가고, 결제는 하지 않습니다.

웹: https://openbell-holdhyun.vercel.app · Vercel: https://openbell-holdhyun.vercel.app  
전광판: https://openbell-holdhyun.vercel.app/board
저장소: https://github.com/aerosmissive-design/openbell

베셀 서버가 알림을 보냅니다. 구글스크립트는 예비이며, 없어도 극장·잔여석 조회는 돌아갑니다.

## v3.9.27에서 달라진 점

- CGV PC/NAS 리포터의 정밀 예매 식별자(`bookingUrl`, `movieNo`, `scnsNo`, `scnSseq`)를 서버 저장 단계에서 보존합니다.
- 극장 선택 설정이 실제 스캔 대상과 전광판에 반영됩니다.
- `/board` 와이드 전광판을 추가했습니다. 로그인 사용자가 큰 화면에서 4열로 볼 수 있습니다.

## 쓰는 법

1. 구글 계정으로 로그인합니다.
2. 감시 탭에서 영화 포스터를 눌러 알림을 켜고, 극장 제목·특별관을 고릅니다.
3. 설정에서 메일·텔레그램·카톡을 켭니다.
4. `/board`를 열면 선택한 극장의 회차·잔여석을 큰 화면으로 볼 수 있습니다.
5. 예매(홀드)를 누르면 좌석을 찍고 결제 화면까지만 갑니다. 결제는 직접 합니다.

## 스택

TanStack Start, React 19, Tailwind v4, Neon/PGLite, Better Auth.
