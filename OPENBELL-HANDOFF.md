# 오픈벨 인수인계 — v3.9.61 (2026-09-19 18:03 KST)

시크릿은 넣지 않습니다.

## 지금

- 라이브 목표: https://openbell-fawn.vercel.app **v3.9.61**
- GitHub `main`
- 알림이 안 가는 **진짜 원인: Neon DB 쿼터 `53000`**. 코드 우회 불가. 로그인·user_settings·watch-tick 전부 Neon.

확인됨:
```
GET /api/watch-tick → 500 "Your account or project has exceeded the quota."
Better Auth findSession → 같은 쿼터
```

v3.9.61: 설정 → 알림 경로에 「DB 쿼터」표시. tick은 쿼터면 500 대신 skipped+dbQuota.

사용자가 해야 할 것: Neon 콘솔에서 컴퓨트 한도 상향 또는 월 쿼터 리셋 대기. 새 DB를 만들면 기존 계정·설정이 날아감.

## 직전 세션 (v3.9.58~60)

- 4개 UI/스캔 버그 + KT 정밀 URL mergeShowtimes
- pingSeatmap에 KT 빠져 용산 「없음」 → 새로고침/fast에 KT
- 배포 실패는 vite가 아니라 `db:migrate` Neon 쿼터. migrate fail-open.

## 하지 말 것

KT 쿠키 저장, CAPTCHA 우회, 결제 자동 클릭, GAS 설치 UX, 큰 개편.
