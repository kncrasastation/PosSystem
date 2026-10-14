import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Food Court POS",
  description: "Multi-branch food court POS and ingredient inventory management",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
