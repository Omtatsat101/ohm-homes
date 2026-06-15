import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ohm.homes"),
  title: {
    default: "ohm.homes — find your next home",
    template: "%s · ohm.homes",
  },
  description:
    "ohm.homes — find your next home. Browse listings on the map and discover your next place.",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://ohm.homes",
    siteName: "ohm.homes",
    title: "ohm.homes — find your next home",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1f4d3a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
