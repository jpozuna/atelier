import { DM_Mono, DM_Sans } from "next/font/google";
import localFont from "next/font/local";

/*
 * Atelier type faces, from the brand sheet (all SIL OFL 1.1), self-hosted by
 * next/font at build time. Each sets a CSS variable that src/styles/tokens.css reads.
 *
 * - Serif: Instrument Serif, for the wordmark, headings and reading text.
 *   Shipped from the brand files in ./fonts.
 * - Sans: DM Sans, the neutral sans for small labels, buttons and chrome.
 * - Mono: DM Mono, for the reasoning trace and other small technical text. Not preloaded (it sits below the
 *   first paint); the italic serif is its own family for the same reason, see below.
 */

const serif = localFont({
  src: [{ path: "./fonts/InstrumentSerif-Regular.ttf", weight: "400", style: "normal" }],
  display: "swap",
  variable: "--font-atelier-serif",
});

// The italic is not used on any screen yet, so it is not preloaded: it would compete with the first paint for
// bandwidth on every page. It loads on demand when text sets this family (var(--font-atelier-serif-italic)).
const serifItalic = localFont({
  src: [{ path: "./fonts/InstrumentSerif-Italic.ttf", weight: "400", style: "italic" }],
  display: "swap",
  preload: false,
  variable: "--font-atelier-serif-italic",
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
  preload: false, // only the reasoning trace uses it, below the first paint
  variable: "--font-atelier-mono",
});

/** Put this on <html>. It declares all the font CSS variables. */
export const fontVariables = [serif.variable, serifItalic.variable, ui.variable, mono.variable].join(" ");
