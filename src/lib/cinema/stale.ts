/** 좌석 숫자가 이보다 오래되면 알림·잡 생성에 쓰지 않는다. 화면 표시는 허용. */
export const STALE_MS = 15 * 60 * 1000;

export function seatAgeMs(seatCheckedAt?: string | null, now = Date.now()): number | null {
  if (!seatCheckedAt) return null;
  const at = Date.parse(seatCheckedAt);
  if (!Number.isFinite(at)) return null;
  return now - at;
}

export function isStaleSeat(seatCheckedAt?: string | null, now = Date.now()): boolean {
  const age = seatAgeMs(seatCheckedAt, now);
  return age != null && age > STALE_MS;
}
