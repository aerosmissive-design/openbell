import { createFileRoute, redirect } from "@tanstack/react-router";

const ALLOWED = new Set([
  "www.megabox.co.kr",
  "megabox.co.kr",
  "m.megabox.co.kr",
  "cgv.co.kr",
  "www.cgv.co.kr",
  "m.cgv.co.kr",
  "ticket.cgv.co.kr",
]);

function isBookingUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED.has(url.hostname);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/go")({
  validateSearch: (search: Record<string, unknown>) => ({
    u: typeof search.u === "string" ? search.u : "",
  }),
  beforeLoad: ({ search }) => {
    if (isBookingUrl(search.u)) {
      throw redirect({ href: search.u });
    }
  },
  component: GoFallback,
});

function GoFallback() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center bg-bg px-5">
      <p className="font-display text-2xl italic text-fg">예매 링크가 없습니다</p>
      <a href="/" className="mt-4 text-sm text-muted underline-offset-2 hover:underline">
        오픈벨로 돌아가기
      </a>
    </main>
  );
}
