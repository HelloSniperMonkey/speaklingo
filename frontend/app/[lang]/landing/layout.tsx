import type { Metadata } from "next";
import { DM_Sans, Outfit } from "next/font/google";

const display = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-sl-display" });
const body = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-sl-body" });

export const metadata: Metadata = {
  metadataBase: new URL("https://speaklingo.xyz"),
  title: "SpeakLingo | Your voice. Without borders.",
  description: "Speak naturally. Hear each other in your own language. Request early access to SpeakLingo's translated video calls.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "SpeakLingo | Your voice. Without borders.",
    description: "Video calls with live voice translation and captions. Request early access.",
    url: "https://speaklingo.xyz",
    siteName: "SpeakLingo",
    type: "website",
  },
};

export default function LandingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={`${display.variable} ${body.variable}`}>{children}</div>;
}
