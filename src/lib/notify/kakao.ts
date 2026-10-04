/** Alimtalk/friendtalk stays off until a business channel is verified. */
export async function sendKakaoAlimtalk() {
  return {
    ok: false as const,
    skipped: true as const,
    error: "카카오 알림톡은 사업자 등록 확인 전이라 보내지 않습니다.",
  };
}
