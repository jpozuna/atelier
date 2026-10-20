// Next 16 proxy (the renamed middleware). Runs on the Node.js runtime before routes render. It does two jobs, both in
// src/lib/guard/: the free-demo guard (per-visitor limits, daily allowance, the "demo is resting" state) and the
// Supabase session refresh with its Cache-Control headers. Static assets and images skip it.

import type { NextRequest } from "next/server";
import { runProxy } from "@/lib/guard/handler";

export function proxy(request: NextRequest) {
  return runProxy(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
