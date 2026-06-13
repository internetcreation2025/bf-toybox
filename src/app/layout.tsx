import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { BottomNav } from "@/components/BottomNav";
import { AutoLock } from "@/components/AutoLock";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sole Decider",
  description: "Your private footwear decision-maker.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sole Decider",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AutoLock />
        <TopNav />
        {/* Pad the foot so fixed bottom-nav (mobile) never covers content. */}
        <div className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
          {children}
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
