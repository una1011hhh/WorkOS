import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WorkOS · Personal Work Memory",
  description: "A personal work memory system for tasks, meetings and reflection.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
