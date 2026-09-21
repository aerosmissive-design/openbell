# 오픈벨 (Openbell) v3.9.79

CGV·메가박스 특별관 예매 오픈·잔여석 알림 웹앱입니다.

웹: https://openbell-fawn.vercel.app  
전광판: https://openbell-fawn.vercel.app/board
저장소: https://github.com/aerosmissive-design/openbell

## v3.9.79에서 달라진 점

- 잔여석 현황 출처 표를 공홈 / G_PC / G_DS423+ / G_DS225+ / KT 우회 / 메가 모바일우회 / MKA 우회 / 네이버 / 용아맥채널 / GAS 로 나눔니다.
- G_NAS 한 칸은 쓰지 않습니다. DS423+와 DS225+가 따로 베셀에 잔여석을 올립니다.
- MKA는 mcp.aka.page CGV 우회입니다. 메가 모바일우회와 KT 우회를 한 칸에 섞지 않습니다.
- 표에 나온 경로는 실제로 베셀 회차에 잔여석을 넘깁니다. 같은 회차는 가장 최근 도착 숫자를 쓰니다.

## v3.9.78에서 달라진 점

- 감시 회차 카드는 출처를 항상 적습니다. 없으면 「없음」.
- 「N.NN일 HH:MM 기준」은 버그입니다. 우회경로가 베셀에 도착한 조회시각 + 출처만 쓰니다.
- 현재 시계를 seatCheckedAt에 찍지 않습니다.
