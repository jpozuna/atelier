import { Cormorant_Garamond, Inter, Newsreader } from "next/font/google";

/*
 * Atelier type faces, self-hosted by next/font at build time (all SIL OFL 1.1).
 * Each sets a CSS variable that src/styles/tokens.css reads.
 *
 * - Display: Cormorant Garamond, for the wordmark and large headings only.
 * - Text: Newsreader, for reading text.
 * - UI: Inter, for small labels, buttons and the reasoning trace chrome.
 */

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-atelier-display",
});

const text = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-atelier-text",
});

const ui = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-atelier-ui",
});

/** Put this on <html>. It declares all three font CSS variables. */
export const fontVariables = [display.variable, text.variable, ui.variable].join(" ");
