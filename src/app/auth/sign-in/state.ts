// The form's state, kept apart from actions.ts because a "use server" file may export only async functions.

export type SignInReason = "invalid_email" | "rate_limited" | "failed" | "unavailable";

export type SignInState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; reason: SignInReason; email: string };

export const INITIAL_SIGN_IN: SignInState = { status: "idle" };
