import type { Metadata } from "next";
import "./globals.css";
import "@/styles/tokens.css";
import { Shell, fontVariables } from "@/components/shell";

export const metadata: Metadata = {
  title: "Atelier",
  description: "Develop your taste, not just feed it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
