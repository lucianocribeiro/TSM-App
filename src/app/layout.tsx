import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy/es-AR";
import { parseTheme, THEME_COOKIE } from "@/lib/theme/theme";
import "./globals.css";

// Fonts are self-hosted (src/app/fonts, SIL Open Font License 1.1, OFL.txt
// beside each family): the build never fetches from Google Fonts.
// Both families are variable fonts: one file covers the weight range.

// Cormorant Garamond, subset to latin and latin-ext. Weights 400 and 600.
const headingFont = localFont({
  src: [
    {
      path: "./fonts/cormorant-garamond/CormorantGaramond-latin-latinext.woff2",
      weight: "400 600",
      style: "normal",
    },
  ],
  variable: "--font-heading",
  fallback: ["system-ui", "sans-serif"],
  display: "swap",
});

// Lora, converted to woff2 without subsetting: its licence reserves the name
// "Lora" for unmodified versions. Weights 400 to 600, and italic 400.
const bodyFont = localFont({
  src: [
    { path: "./fonts/lora/Lora.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/lora/Lora-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-body",
  fallback: ["system-ui", "sans-serif"],
  display: "swap",
});

export const metadata: Metadata = {
  title: copy.app.name,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Theme is resolved on the server so the first paint already uses it.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="es-AR"
      data-theme={theme}
      className={`${headingFont.variable} ${bodyFont.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
