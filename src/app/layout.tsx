import type { Metadata, Viewport } from "next";

import "@/app/globals.css";
import { PwaProvider } from "@/components/pwa-provider";

export const metadata: Metadata = {
  title: "워크가드 | 노무 리스크 관리 SaaS",
  description: "초과근로, 포괄임금제, 근로시간 분쟁에 대비하는 한국형 노무 리스크 관리 SaaS",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        url: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ],
    apple: "/icon-192.png"
  },
  appleWebApp: {
    capable: true,
    title: "워크가드",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#1e3a8a",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <PwaProvider />
        {children}
      </body>
    </html>
  );
}
