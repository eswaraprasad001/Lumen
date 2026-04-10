import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen",
  description:
    "A calm newsletter workspace for Gmail readers who want continuity without pressure.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
