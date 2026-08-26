import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { ToastContainer, ToastProvider } from "@/lib/toast";

// Inter rather than Geist: Geist is a display-leaning face and reads as a headline
// font at 12–14px, which is where most of this app's text lives (form labels,
// placeholders, badges, table rows). Inter was drawn for UI at small sizes — tall
// x-height, open apertures — so labels and placeholders stay legible.
// `latin-ext` covers the diacritics in the European station names.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "The Railway Logbook",
  description: "Log your rail journeys around Europe and Japan",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The layout draws into the notch and home-indicator strips and pads itself back
  // out of them (`safe-area` in globals.css). Without `cover` every
  // `env(safe-area-inset-*)` resolves to 0 and cannot be opted into later.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The init script writes `class="dark"` onto this element, which React would
    // otherwise flag as a hydration mismatch against the server's bare <html>.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before the stylesheet paints anything, so a dark-mode visitor never gets a
            white flash. It has to be inline and synchronous — an external script or
            a `useEffect` both run too late to beat the first paint. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed, self-authored constant with no interpolated input — see THEME_INIT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <ToastProvider>
          {children}
          <ToastContainer />
        </ToastProvider>
      </body>
    </html>
  );
}
