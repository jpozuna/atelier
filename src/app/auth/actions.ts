"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/lib/db/auth";

/** End the session, then go home. The cookie is cleared through the client's cookie adapter. */
export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/");
}
