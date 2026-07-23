import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "R-Tale Scraper — Control Panel",
  description: "Start the scraper, review pending titles, watch the catalog grow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
