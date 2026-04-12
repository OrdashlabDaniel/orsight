import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Mono, Noto_Sans_SC } from "next/font/google";

import { AppProviders } from "@/components/AppProviders";

import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  display: "swap",
});

const notoSansMono = Noto_Sans_Mono({
  variable: "--font-noto-sans-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OrSight",
  description:
    "OrSight: batch POD screenshots, AI-assisted forms, copy & Excel export. / OrSight：批量上传 POD 签退截图，AI 自动填表，支持复制与导出 Excel。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${notoSans.variable} ${notoSansSC.variable} ${notoSansMono.variable}`}
    >
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
