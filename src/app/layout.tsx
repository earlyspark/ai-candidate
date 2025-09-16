import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://earlyspark.com'),
  title: ".+:*earlyspark*:+.",
  description: "this is where i live",
  openGraph: {
    title: ".+:*earlyspark*:+.",
    description: "this is where i live",
    url: '/',
    siteName: 'earlyspark',
    images: [
      {
        url: '/20250914_diamond.png',
        alt: 'Diamond',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: ".+:*earlyspark*:+.",
    description: "this is where i live",
    images: ['/20250914_diamond.png'],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
