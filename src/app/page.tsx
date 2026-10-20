import Link from "next/link";

export default function Home() {
  return (
    <section className="placeholder">
      <div>
        <h1>Atelier</h1>
        <p>Share what you love and why. See the shape of your taste, then look past its edge.</p>
        <p>
          <Link href="/start">Begin</Link>
        </p>
      </div>
    </section>
  );
}
