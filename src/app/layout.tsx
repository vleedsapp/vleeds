import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Vleeds", template: "%s · Vleeds" },
  description: "Lead discovery and prospecting workspace.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f8f7f4",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full text-[14px] leading-5">{children}</body>
    </html>
  );
}
