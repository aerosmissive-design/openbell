const KEY = "openbell-chunk-reload";

export function isChunkLoadError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    msg,
  );
}

export function reloadIfStaleChunk(err?: unknown) {
  if (typeof window === "undefined") return;
  if (err && !isChunkLoadError(err)) return;
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
  window.location.reload();
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadIfStaleChunk();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      reloadIfStaleChunk(event.reason);
    }
  });
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }, 2500);
  });
}
