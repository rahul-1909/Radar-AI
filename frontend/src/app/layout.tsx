import type { Metadata } from "next";
import "./globals.css";
import ServerStatus from "@/components/ServerStatus";

export const metadata: Metadata = {
  title: "RadarAI — Autonomous Quality & Release Intelligence Platform",
  description: "Next-generation autonomous quality platform. Real browser automation, deep API inspection, security verification, and deterministic release risk gating.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif" }}>
        <ServerStatus />
        {children}
      </body>
    </html>
  );
}
