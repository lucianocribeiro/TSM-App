import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/require-role";

// Empleado only (F2-05, decision 8: Admins have no receipts). The check runs
// here, outside the segment's loading boundary, so an Admin gets a plain
// redirect before anything is streamed. The page checks again before reading
// data, and every action checks on its own.
export default async function MisRecibosLayout({ children }: { children: ReactNode }) {
  await requireRole("empleado");
  return children;
}
