import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/require-role";

// Admin only. The check runs here, outside the segment's loading boundary, so
// a non-Admin gets a plain redirect before anything is streamed. The pages
// check again before reading data, and every action checks on its own.
export default async function AprobacionesLayout({ children }: { children: ReactNode }) {
  await requireRole("admin");
  return children;
}
