import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "R-Tale Scraper — Control Panel",
  description: "Start the scraper, review pending titles, watch the catalog grow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: browser extensions (Grammarly, reader/theme modes)
  // inject attributes onto <html>/<body> before React hydrates, which otherwise
  // trips a hydration-mismatch warning. This scopes the suppression to these two
  // tags only — real mismatches inside the app still surface.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint so there's no flash of the wrong
            theme. Defaults to dark when nothing is stored. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('rts-theme')||'dark'}catch(e){document.documentElement.dataset.theme='dark'}",
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
