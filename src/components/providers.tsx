import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { applyTheme, resolveTheme } from "@/lib/theme";
import { useAppStore } from "@/lib/store";

function ThemeSync() {
  const theme = useAppStore((s) => s.config.theme ?? "dark");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");
  useEffect(() => {
    applyTheme(theme);
    setResolved(resolveTheme(theme));
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      applyTheme("system");
      setResolved(resolveTheme("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
  return (
    <Toaster
      theme={resolved}
      position="top-center"
      toastOptions={{
        style: {
          background: "var(--ob-surface)",
          color: "var(--ob-fg)",
          border: "1px solid var(--ob-border)",
        },
      }}
    />
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <ThemeSync />
    </QueryClientProvider>
  );
}