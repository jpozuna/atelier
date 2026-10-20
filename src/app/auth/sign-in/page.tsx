import type { Metadata } from "next";
import Link from "next/link";
import { COPY } from "@/components/reactions/copy";
import { SAVED_PATH } from "@/components/reactions/constants";
import { getSessionState, safeNextPath } from "@/lib/db/auth";
import type { SessionState } from "@/lib/db/auth";
import { SignInForm } from "./SignInForm";
import styles from "./SignIn.module.css";

export const metadata: Metadata = {
  title: "Sign in | Atelier",
};

// Reads the visitor's session cookie.
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Only a path on this site, whatever the query says.
  const next = safeNextPath(first(params.next), "");

  let session: SessionState = { kind: "guest" };
  try {
    session = await getSessionState();
  } catch {
    // Supabase is not configured here: the form still shows, and sending a link says it is not switched on.
  }

  if (session.kind === "user") {
    return (
      <section className={styles.panel} aria-labelledby="signed-in-title">
        <h1 id="signed-in-title" className={styles.title}>
          {COPY.alreadySignedIn}
        </h1>
        <p>
          <Link className={styles.link} href={next || SAVED_PATH}>
            {COPY.continue}
          </Link>
        </p>
      </section>
    );
  }

  return <SignInForm next={next} linkFailed={first(params.error) === "link"} />;
}
