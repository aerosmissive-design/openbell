from pathlib import Path
p = Path("src/components/settings-view.tsx")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendKakaoMemo, sendTelegram } from "@/lib/cinema/scan";',
    'import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendKakaoMemo, sendTelegram } from "@/lib/cinema/scan";\nimport { sendReservationTest } from "@/lib/cinema/reservation-test.server";',
    1,
)
if "async function sendReservationChannelTest" not in s:
    marker = "  async function sendTestMail() {"
    helper = '''  async function sendReservationChannelTest(channel: "mail" | "telegram" | "kakao") {
    if (channel === "mail" && !mailEnabled(config)) {
      toast.error("먼저 메일 알림을 켜고 연결하세요.");
      return;
    }
    if (channel === "telegram" && (!config.telegramToken.trim() || !config.telegramChatId.trim())) {
      toast.error("먼저 텔레그램을 연결하세요.");
      return;
    }
    if (channel === "kakao" && (!config.kakaoRestKey.trim() || !config.kakaoRefreshToken.trim())) {
      toast.error("먼저 카카오를 연결하세요.");
      return;
    }
    setSendingTest(true);
    try {
      const result = await sendReservationTest({
        data: {
          channel,
          email: loginEmail || config.email,
          gmailAppPassword: config.gmailAppPassword,
          gasWebUrl: config.gasWebUrl || undefined,
          telegramToken: config.telegramToken,
          telegramChatId: config.telegramChatId,
          kakaoRestKey: config.kakaoRestKey,
          kakaoRefreshToken: config.kakaoRefreshToken,
        },
      });
      const names = result.theaters.map((row) => `${row.movieTitle} ${row.playDate.slice(4, 6)}.${row.playDate.slice(6, 8)} ${row.startTime}`).join(" · ");
      toast.success(`${result.count}개 극장의 실제 상영 회차로 예매 알림을 보냈습니다. ${names}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "예매 알림 테스트 실패");
    } finally {
      setSendingTest(false);
    }
  }

'''
    if marker not in s:
        raise SystemExit("settings marker not found")
    s = s.replace(marker, helper + marker, 1)
s = s.replace('void sendTestMail();', 'void sendReservationChannelTest("mail");', 1)
s = s.replace('{sendingTest ? "보내는 중…" : "테스트 메일 보내기"}', '{sendingTest ? "예매 알림 보내는 중…" : "예매 알림 테스트"}', 1)
old_kakao = '''onClick={async () => {
            try {
              await sendKakaoMemo({
                data: {
                  restKey: config.kakaoRestKey,
                  refreshToken: config.kakaoRefreshToken,
                  text: "오픈벨 카톡 연결 테스트입니다. 예매가 열리면 여기로 옵니다.",
                },
              });
              toast.success("나와의 채팅을 확인해 보세요.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "카톡 테스트 실패");
            }
          }}'''
s = s.replace(old_kakao, 'onClick={() => { void sendReservationChannelTest("kakao"); }}', 1)
s = s.replace("카톡 테스트 보내기", "예매 알림 테스트", 1)
old_tg = '''onClick={async () => {
              try {
                await sendTelegram({
                  data: {
                    token: config.telegramToken,
                    chatId: config.telegramChatId,
                    text: "오픈벨 연결 테스트입니다.",
                  },
                });
                toast.success(
                  "텔레그램 테스트 전송. 감시 탭에서 포스터를 누르면, 새 상영이 열릴 때 여기로 옵니다.",
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "전송 실패");
              }
            }}'''
s = s.replace(old_tg, 'onClick={() => { void sendReservationChannelTest("telegram"); }}', 1)
s = s.replace("텔레그램 테스트", "예매 알림 테스트", 1)
p.write_text(s, encoding="utf-8")
print("patched settings")
