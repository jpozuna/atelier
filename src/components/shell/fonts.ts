import { DM_Mono, DM_Sans } from "next/font/google";
import localFont from "next/font/local";

/*
 * Atelier type faces, from the brand sheet (all SIL OFL 1.1), self-hosted by
 * next/font at build time. Each sets a CSS variable that src/styles/tokens.css reads.
 *
 * - Serif: Instrument Serif, for the wordmark, headings and reading text.
 *   Shipped from the brand files in ./fonts.
 * - Sans: DM Sans, the neutral sans for small labels, buttons and chrome.
 * - Mono: DM Mono, for the reasoning trace and other small technical text.
 */

const serif = localFont({
  src: [
    { path: "./fonts/InstrumentSerif-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/InstrumentSerif-Italic.ttf", weight: "400", style: "italic" },
  ],
  display: "swap",
  variable: "--font-atelier-serif",
});

const ui = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-atelier-ui",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-atelier-mono",
});

/** Put this on <html>. It declares all the font CSS variables. */
export const fontVariables = [serif.variable, ui.variable, mono.variable].join(" ");
