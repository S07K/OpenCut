import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cutaway",
  description: "Open-source, local-first video editor for creators.",
};

export const viewport: Viewport = {
  // The editor is a fixed application surface; pinch-zooming the chrome breaks
  // canvas pointer math and helps nobody.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1c1d22",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `data-theme` is set here rather than by a client script: dark is the
    // default, so there is no flash to avoid and no hydration mismatch to risk.
    <html lang="en" data-theme="dark" className={`${inter.variable} h-full`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
