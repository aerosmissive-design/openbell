# 오픈벨 (Openbell) v3.9.87

CGV·메가박스 특별관 예매 오픈·잔여석 알림 웹앱입니다.

웹: https://openbell-fawn.vercel.app  
전광판: https://openbell-fawn.vercel.app/board  
저장소: https://github.com/aerosmissive-design/openbell

**모든 AI·개발자 인수인계:** [HANDOFF.md](./HANDOFF.md) (버전 올릴 때마다 함께 갱신)

## v3.9.87에서 달라진 점

- 설정 예매 전광판을 배경(라이트/다크/시스템) 바로 위로 옮겼습니다.
- 출처 표 아래에 서버 status를 다시 둡니다. 베셀(메인서버) / GAS(예비서버)로 나눝니다.
- 깨움은 깃허브 · 외부 크론 · GAS 깨움 · 베셀 크론을 따로 찍습니다. `src=external`을 GAS로 넣지 않습니다.
- 잘린 seats.ts를 복구해 배포가 다시 빌드되게 합니다.
