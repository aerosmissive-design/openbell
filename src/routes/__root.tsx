import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppProviders } from "@/components/providers";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import "../styles.css";
import appCss from "../styles.css?url";

const APP_NAME = "오픈벨";

const CRITICAL_CSS = `html{background:#0c0c0d;color-scheme:dark;}
html[data-theme="light"]{background:#d6e4f7;color-scheme:light;}
body{margin:0;min-height:100dvh;background:transparent;}
button:not(:disabled),a,[role=button]:not(:disabled){cursor:pointer;}
img{max-width:100%;height:auto;display:block;}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
      },
      { title: APP_NAME },
      {
        name: "description",
        content: "메가박스·CGV 특별관 예매 오픈 알람",
      },
      { name: "theme-color", content: "#0c0c0d" },
      { name: "color-scheme", content: "dark light" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap",
      },
    ],
    styles: [{ children: CRITICAL_CSS }],
    scripts: [{ children: THEME_BOOTSTRAP }],
  }),
  component: () => (
    <html lang="ko" suppressHydrationWarning className="antialiased" data-theme="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          <AppProviders>
            <Outlet />
          </AppProviders>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});