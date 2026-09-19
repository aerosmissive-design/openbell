# 오픈벨 인수인계 — v3.9.62 (2026-09-19)

시크릿은 넣지 않습니다. 라이브: https://openbell-fawn.vercel.app

## 지금

Neon 무료 CU 쿼터 `53000`으로 로그인·알림 정지. 데이터는 살아 있음. 결제일(~10/1 또는 프로젝트 만든 9/10 기준 ~10/10)에 리셋.

v3.9.62: 감시 주기(5분, 공홈/NAS/KT/릴레이/네이버 병렬)는 유지. Neon 절약:
- watch-alive: create table·select 1·키별 조회 제거 → app_meta 한 방
- 설정 폴링 20초 → 3분, 중복 fetch 제거
- user_settings ALTER는 프로세스당 1회
- 같은 app_meta 값은 재기록 안 함

## 하지 말 것

KT 쿠키 저장, CAPTCHA 우회, 결제 자동, GAS 설치 UX, 큰 개편, 쿼터 중에 새 DB로 계정 이전(못 읽음).
