import Link from "next/link";
import styles from "./page.module.css";

export default function NotFound() {
  return (
    <section className={styles.home} aria-labelledby="not-found-title">
      <p className={styles.label}>Not found</p>
      <h1 id="not-found-title" className={styles.statement}>
        Nothing is here.
      </h1>
      <Link href="/" className={styles.begin}>
        Back to the start
      </Link>
    </section>
  );
}
