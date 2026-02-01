import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebRTC Translator | Lingo.dev Demo",
  description:
    "Real-time video chat with AI-powered live translation using Lingo.dev SDK",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="gradient-bg antialiased">{children}</body>
    </html>
  );
}
