// What the sign-in action does, with the magic-link sender injected so it can be tested without a server.

import type { MagicLinkResult } from "@/lib/db/auth";
import type { SignInState } from "./state";

export type SendLink = (input: { email: string; next?: string | null }) => Promise<MagicLinkResult>;

/**
 * Ask for a link. The result never says whether the address already had an account. A missing or invalid SITE_URL
 * (a configuration problem) is "unavailable", never the raw error.
 */
export async function requestLink(input: { email: unknown; next: unknown }, send: SendLink): Promise<SignInState> {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const next = typeof input.next === "string" && input.next.length > 0 ? input.next : null;
  try {
    const result = await send({ email, next });
    if (result.ok) return { status: "sent", email: email.toLowerCase() };
    return { status: "error", reason: result.reason, email };
  } catch {
    return { status: "error", reason: "unavailable", email };
  }
}
