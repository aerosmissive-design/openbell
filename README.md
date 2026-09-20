# 오픈벨 (Openbell) v3.9.74

CGV·메가박스 특별관 예매 오픈·잔여석 알림 웹앱입니다.

웹: https://openbell-fawn.vercel.app  
전광판: https://openbell-fawn.vercel.app/board
저장소: https://github.com/aerosmissive-design/openbell

## v3.9.74에서 달라진 점

- 알림은 회차 키를 기다리지 않습니다. 먼저 온 출처(KT·네이버·공홈)로 바로 보냅니다.
- CGV 링크에 scnsNo·scnSseq가 있으면 빨간 테두리까지, 메가박스는 playSchdlNo가 있으면 좌석화면까지 갑니다. 키가 없으면 영화/극장 페이지로 보냅니다.
- PC·NAS 부킹에이전트는 키가 없어도 중단하지 않습니다. 날짜·회차를 눌러 같은 화면까지 이어갑니다.

## v3.9.73에서 달라진 점

- 알림은 빠른 경로(KT·네이버)를 먼저 쓰니다. 빨간 테두리 키를 기다리느라 알림을 늦추지 않습니다.
- CGV 빨간 테두리는 KT GetPlayTime의 ScreenCd/PlayNum이 있을 때 붙습니다.
- 부킹에이전트는 scnsNo/scnSseq가 없어도 멈추지 않고, 영화 페이지에서 날짜·회차를 클릭해 이어갑니다.
