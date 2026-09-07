const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function postFormJson<T>(
  url: string,
  body: Record<string, string>,
  opts?: { timeoutMs?: number; attempts?: number },
): Promise<T> {
  const attempts = Math.min(Math.max(opts?.attempts ?? 2, 1), 3);
  const timeoutMs = opts?.timeoutMs ?? 10000;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": UA,
          "x-requested-with": "XMLHttpRequest",
          accept: "application/json, text/javascript, */*; q=0.01",
          referer: "https://www.megabox.co.kr/",
          origin: "https://www.megabox.co.kr",
          "accept-language": "ko-KR,ko;q=0.9",
        },
        body: new URLSearchParams(body).toString(),
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`요청 실패 ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      last = err;
      if (attempt + 1 < attempts) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  }
  const raw = last instanceof Error ? last.message : "메가박스 조회 실패";
  throw new Error(
    /fetch failed|abort|timeout|network/i.test(raw)
      ? "메가박스에 연결하지 못했습니다."
      : raw,
  );
}
