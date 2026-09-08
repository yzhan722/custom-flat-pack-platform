import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Custom Flat-Pack — made-to-measure storage you assemble yourself",
  description:
    "Tell us what you need. We turn it into a low storage cabinet cut, drilled, edged, labelled and packed with hardware and an order-specific assembly guide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
