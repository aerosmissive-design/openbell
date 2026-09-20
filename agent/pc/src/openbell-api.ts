/** OpenBell booking API client. Never prints tokens. */

export type FetchLike = typeof fetch;

export type OpenBellDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_BACKOFF_MS = [500, 1500] as const;

export function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const cause = (error as Error & { cause?: { code?: string } }).cause;
  const code = String(cause?.code || "").toLowerCase();
  return (
    /fetch failed|network|econnreset|econnrefused|etimedout|enotfound|socket|aborted/.test(msg) ||
    /econnreset|econnrefused|etimedout|enotfound|und_err/.test(code)
  );
}

function shouldRetryOpenBellError(error: unknown, failPrefix: string): boolean {
  if (isRetryableNetworkError(error)) return true;
  if (!(error instanceof Error)) return false;
  if (error.message.includes(":401:")) return false;
  return new RegExp(`${failPrefix}:5\\d\\d`).test(error.message);
}

export async function createSession(
  input: {
    openbellUrl: string;
    workerToken: string;
    theaterId: string;
    movieTitle: string;
    playDate: string;
    showtime: string;
    hall: string;
    requestedSeatCount: number;
    bookingUrl?: string;
  },
  deps: OpenBellDeps = {},
) {
  const doFetch = deps.fetch ?? fetch;
  const doSleep = deps.sleep ?? sleep;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await doFetch(`${input.openbellUrl}/api/booking/create`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.workerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          theaterId: input.theaterId,
          movieTitle: input.movieTitle,
          playDate: input.playDate,
          showtime: input.showtime,
          hall: input.hall,
          requestedSeatCount: input.requestedSeatCount,
          bookingUrl: input.bookingUrl || undefined,
          agent: "pc",
        }),
      });

      if (response.status === 401) {
        const text = await response.text();
        throw new Error(`OPENBELL_SESSION_CREATE_FAILED:401:${text.slice(0, 500)}`);
      }

      if (response.status >= 500) {
        const text = await response.text();
        lastError = new Error(`OPENBELL_SESSION_CREATE_FAILED:${response.status}:${text.slice(0, 500)}`);
        if (attempt < 3) {
          const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1500;
          console.warn(`[create-session] ${response.status} on attempt ${attempt}/3; retry in ${wait}ms`);
          await doSleep(wait);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OPENBELL_SESSION_CREATE_FAILED:${response.status}:${text.slice(0, 500)}`);
      }
      const data = (await response.json()) as { ok?: boolean; session?: { id?: string } };
      if (!data.ok || !data.session?.id) throw new Error("OPENBELL_SESSION_CREATE_INVALID_RESPONSE");
      return data.session.id;
    } catch (error) {
      if (error instanceof Error && error.message.includes(":401:")) throw error;
      if (error instanceof Error && error.message === "OPENBELL_SESSION_CREATE_INVALID_RESPONSE") throw error;
      if (
        !shouldRetryOpenBellError(error, "OPENBELL_SESSION_CREATE_FAILED") &&
        !(error instanceof Error && /OPENBELL_SESSION_CREATE_FAILED:5\d\d/.test(error.message))
      ) {
        if (error instanceof Error && error.message.startsWith("OPENBELL_SESSION_CREATE_FAILED:")) throw error;
        if (!isRetryableNetworkError(error)) throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1500;
        console.warn(`[create-session] network/5xx on attempt ${attempt}/3; retry in ${wait}ms`);
        await doSleep(wait);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("OPENBELL_SESSION_CREATE_FAILED:unknown");
}

export async function updateState(
  input: {
    openbellUrl: string;
    workerToken: string;
    sessionId: string;
    state: string;
  },
  deps: OpenBellDeps = {},
) {
  const doFetch = deps.fetch ?? fetch;
  const doSleep = deps.sleep ?? sleep;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await doFetch(`${input.openbellUrl}/api/booking/state`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.workerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: input.sessionId, state: input.state }),
      });

      if (response.status === 401) {
        const text = await response.text();
        throw new Error(`OPENBELL_STATE_UPDATE_FAILED:401:${text.slice(0, 500)}`);
      }

      if (response.status >= 500) {
        const text = await response.text();
        lastError = new Error(`OPENBELL_STATE_UPDATE_FAILED:${response.status}:${text.slice(0, 500)}`);
        if (attempt < 3) {
          const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1500;
          console.warn(`[state] ${response.status} on attempt ${attempt}/3; retry in ${wait}ms`);
          await doSleep(wait);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OPENBELL_STATE_UPDATE_FAILED:${response.status}:${text.slice(0, 500)}`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes(":401:")) throw error;
      if (
        !shouldRetryOpenBellError(error, "OPENBELL_STATE_UPDATE_FAILED") &&
        !(error instanceof Error && /OPENBELL_STATE_UPDATE_FAILED:5\d\d/.test(error.message))
      ) {
        if (error instanceof Error && error.message.startsWith("OPENBELL_STATE_UPDATE_FAILED:")) throw error;
        if (!isRetryableNetworkError(error)) throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1500;
        console.warn(`[state] network/5xx on attempt ${attempt}/3; retry in ${wait}ms`);
        await doSleep(wait);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("OPENBELL_STATE_UPDATE_FAILED:unknown");
}

/**
 * POST payment-ready with up to 3 attempts.
 * Retries network errors and 5xx with backoff ~500ms then ~1500ms.
 * Never retries HTTP 401.
 */
export async function notifyPaymentReady(
  input: {
    openbellUrl: string;
    workerToken: string;
    sessionId: string;
    url: string;
    seats: string[];
  },
  deps: OpenBellDeps = {},
) {
  const doFetch = deps.fetch ?? fetch;
  const doSleep = deps.sleep ?? sleep;
  const backoffMs = RETRY_BACKOFF_MS;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await doFetch(`${input.openbellUrl}/api/booking/payment-ready`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.workerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: input.sessionId,
          browserAccessUrl: input.url,
          selectedSeats: input.seats,
        }),
      });

      if (response.status === 401) {
        const text = await response.text();
        throw new Error(`OPENBELL_PAYMENT_READY_FAILED:401:${text.slice(0, 500)}`);
      }

      if (response.status >= 500) {
        const text = await response.text();
        lastError = new Error(`OPENBELL_PAYMENT_READY_FAILED:${response.status}:${text.slice(0, 500)}`);
        if (attempt < 3) {
          const wait = backoffMs[attempt - 1] ?? 1500;
          console.warn(`[payment-ready] ${response.status} on attempt ${attempt}/3; retry in ${wait}ms`);
          await doSleep(wait);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OPENBELL_PAYMENT_READY_FAILED:${response.status}:${text.slice(0, 500)}`);
      }

      const data = (await response.json().catch(() => ({}))) as {
        hardStop?: unknown;
        telegram?: unknown;
        ok?: unknown;
      };
      if (data.hardStop !== undefined || data.telegram !== undefined) {
        const tg =
          data.telegram == null
            ? "n/a"
            : typeof data.telegram === "object"
              ? JSON.stringify(data.telegram).slice(0, 120)
              : String(data.telegram).slice(0, 120);
        console.log(`[payment-ready] hardStop=${String(data.hardStop)} telegram=${tg}`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes(":401:")) throw error;
      if (
        !isRetryableNetworkError(error) &&
        !(error instanceof Error && /OPENBELL_PAYMENT_READY_FAILED:5\d\d/.test(error.message))
      ) {
        if (error instanceof Error && error.message.startsWith("OPENBELL_PAYMENT_READY_FAILED:")) throw error;
        if (!isRetryableNetworkError(error)) throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        const wait = backoffMs[attempt - 1] ?? 1500;
        console.warn(`[payment-ready] network/5xx on attempt ${attempt}/3; retry in ${wait}ms`);
        await doSleep(wait);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("OPENBELL_PAYMENT_READY_FAILED:unknown");
}
