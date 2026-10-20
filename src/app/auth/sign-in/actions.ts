"use server";

import { sendMagicLink } from "@/lib/db/auth";
import { requestLink } from "./core";
import type { SignInState } from "./state";

/** Server Action for the sign-in form: it writes the PKCE cookie, so it must run here and not in a Server Component. */
export async function requestSignIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  return requestLink({ email: formData.get("email"), next: formData.get("next") }, sendMagicLink);
}
