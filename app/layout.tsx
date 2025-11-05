import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UCC Map",
  description: "Interactive campus map experience for the University College Cork.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}