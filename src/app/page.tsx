import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <section className={styles.home} aria-labelledby="home-title">
      <p className={styles.label}>Atelier</p>
      <h1 id="home-title" className={styles.statement}>
        Map what you love, then look past its edge.
      </h1>
      <p className={styles.lede}>
        Share what you love and why. See the shape of your taste on an attribute chart, then find things in other
        fields that are unfamiliar but connected.
      </p>
      <Link href="/start" className={styles.begin}>
        Begin
      </Link>
    </section>
  );
}
