/** Apps Script accepts the POST, then 302s to a GET-only result page. */
export async function postGasJson(url: string, payload: unknown, timeoutMs = 8000): Promise<{ status: number; text: string }> {
  const body = JSON.stringify(payload);
  const headers = { "content-type": "application/json" };
  let res = await fetch(url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      res = await fetch(new URL(loc, url), {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
  }
  return { status: res.status, text: await res.text() };
}
