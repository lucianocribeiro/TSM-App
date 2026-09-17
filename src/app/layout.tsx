import type { Metadata } from "next";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy/es-AR";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.app.name,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
