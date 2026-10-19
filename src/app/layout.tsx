import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atelier",
  description: "Develop your taste, not just feed it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
