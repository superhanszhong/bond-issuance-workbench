import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "利率债发行工作台",
  description: "地方债日表、利差图、发行小结与周报生成的本地数据工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
