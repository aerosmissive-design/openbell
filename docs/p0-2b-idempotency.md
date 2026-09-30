# P0-2B 알림 위임 — 멱등 설계 (구현 전)

상태: 설계만. GAS가 알림을 대신 보내는 코드는 이 문서 승인 전에는 넣지 않는다.
Neon이 죽으면 지금은 tick이 `degraded`로 끝나고, GAS에는 `op=clock&kind=delegate` 시각만 남긴다. 알림 본문은 보내지 않는다.

## 이벤트 ID

- 생성: Vercel tick. `eventId = sha256(userId + showId + kind + playDate + startTime)`.
- GAS는 받지 만들고, 수신만 한다.
- 같은 eventId는 한 번만 발송.

## 저장

- Neon `app_meta` 키 `alert_claim:{eventId}` = `claim|sent|expired` + 시각.
- GAS Script Properties 키 `alert:{eventId}` = 같은 상태.
- Neon이 죽은 동안에는 GAS 쪽만 쓴다. 복구 후 Vercel이 GAS `op=claims`로 읽어 Neon에 맞춘다.
- dedupe 저장을 Neon만 쓰면 fallback이 무력해지므로 이중이다.

## 전이

1. `claim` — 발송 주체가 lease(`until = now + 2분`)를 잡는다. 이미 `sent`면 중단.
2. `sent` — 채널 전송 성공 후. lease 보유자만 갱신.
3. `expired` — lease가 지났고 `sent`가 아니면 다른 주체가 다시 claim.

## 단일 실행

CGV 폴링은 `runner_lease` 하나로 Vercel 또는 GAS 중 한 쪽만. 이번 라운드에서는 구현하지 않는다.

## 승인 전 금지

- GAS `checkOpenSeats`가 Vercel 알림을 대신 발송
- 양쪽이 같은 예매 오픈을 동시에 메일/텔레그램으로 보냄
