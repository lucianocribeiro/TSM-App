import type { Metadata } from "next";
import { Cormorant_Garamond, Lora } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy/es-AR";
import { parseTheme, THEME_COOKIE } from "@/lib/theme/theme";
import "./globals.css";

const headingFont = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-heading",
  fallback: ["system-ui", "sans-serif"],
  display: "swap",
});

// next/font loads every listed weight in every listed style, so italic is also
// available at 500 and 600; only italic 400 is used.
const bodyFont = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
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
